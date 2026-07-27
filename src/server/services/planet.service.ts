import { createHash } from "node:crypto";

import type { Planet as PrismaPlanet } from "@prisma/client";

import { lockReadableCoverAsset } from "@/server/db/asset-repo";
import { getPrismaClient } from "@/server/db/client";
import { prismaIdempotencyRepository } from "@/server/db/idempotency-repo";
import {
  archivePlanet,
  createPlanet,
  createPlanetRelationship,
  findActivePlanet,
  findActiveRelationship,
  findScopedPlanet,
  isPlanetUniqueConstraintError,
  lockActivePlanetsForRelationship,
  restorePlanet,
  type ActivePlanetPatch,
  updateActivePlanet,
} from "@/server/db/planet-repo";
import { DomainError } from "@/server/domain-error";
import {
  executeIdempotentDbOperation,
  type IdempotencyStatus,
} from "@/server/services/idempotency.service";

type PersistedPlanetType = "self" | "parent" | "child" | "public" | "partner" | "other";
type PlanetLifeState = "active" | "memorial";
type PlanetVisibility = "private" | "family" | "selected" | "public";
type ContentVisibility = "private" | "family" | "selected";
type PlanetRelationshipType = "self" | "parent" | "child" | "partner" | "ancestor" | "other";

export type PlanetScope = {
  userId: string;
  galaxyId: string;
};

export type CreateFamilyPlanetInput = {
  name: string;
  type: PersistedPlanetType;
  lifeState?: PlanetLifeState;
  visibility: PlanetVisibility;
  role?: string | null;
  theme?: string | null;
  summary?: string | null;
  position?: { x: number; y: number };
  idempotencyKey: string;
};

export type UpdateFamilyPlanetInput = {
  version: number;
  name?: string;
  type?: PersistedPlanetType;
  lifeState?: PlanetLifeState;
  visibility?: PlanetVisibility;
  role?: string | null;
  theme?: string | null;
  summary?: string | null;
  position?: { x: number; y: number };
  positionX?: number;
  positionY?: number;
  coverAssetId?: string | null;
};

export type CreateFamilyRelationshipInput = {
  targetPlanetId: string;
  relationshipType: PlanetRelationshipType;
  label?: string | null;
  visibility: ContentVisibility;
  idempotencyKey: string;
};

export type PlanetManagementResponse = {
  id: string;
  name: string;
  type: string;
  lifeState: string;
  visibility: string;
  role: string | null;
  theme: string | null;
  summary: string | null;
  position: { x: number | null; y: number | null };
  coverAssetId: string | null;
  version: number;
  archivedAt: string | null;
  deletedAt: string | null;
};

export async function createFamilyPlanet(
  scope: PlanetScope,
  input: CreateFamilyPlanetInput,
): Promise<IdempotencyStatus> {
  assertPersistedPlanetType(input.type);
  const { idempotencyKey, ...payload } = input;

  return executeIdempotentDbOperation(
    getPrismaClient(),
    prismaIdempotencyRepository,
    {
      ...scope,
      scope: "planet:create",
      key: idempotencyKey,
      requestHash: hashRequest(payload),
    },
    async (transaction) => {
      const created = await createPlanet({
        userId: scope.userId,
        galaxyId: scope.galaxyId,
        name: input.name,
        type: input.type,
        lifeState: input.lifeState ?? "active",
        visibility: input.visibility,
        role: input.role,
        theme: input.theme,
        summary: input.summary,
        positionX: input.position?.x,
        positionY: input.position?.y,
      }, transaction);
      const response = toPlanetResponse(created);

      return {
        resourceType: "planet",
        resourceId: created.id,
        result: response,
        response,
        responseStatus: 201,
      };
    },
  );
}

export async function updateFamilyPlanet(
  scope: PlanetScope,
  planetId: string,
  input: UpdateFamilyPlanetInput,
) {
  await requireActivePlanet(scope, planetId);

  if (input.type !== undefined) {
    assertPersistedPlanetType(input.type);
  }

  const data = toPlanetPatch(input);
  const coverAssetId = input.coverAssetId;

  try {
    const updated = coverAssetId !== undefined && coverAssetId !== null
      ? await getPrismaClient().$transaction(async (transaction) => {
        const lockedAssets = await lockReadableCoverAsset({
          ...scope,
          planetId,
          assetId: coverAssetId,
        }, transaction);

        if (lockedAssets.length !== 1) {
          throw coverAssetInvalid();
        }

        return updateActivePlanet({
          ...scope,
          planetId,
          version: input.version,
          data,
        }, transaction);
      })
      : await updateActivePlanet({
        ...scope,
        planetId,
        version: input.version,
        data,
      });

    return toPlanetResponse(updated);
  } catch (error) {
    if (isPlanetUniqueConstraintError(error)) {
      throw new DomainError("PLANET_COVER_IN_USE", 409, "该封面已被另一颗星球使用，请重新选择。");
    }

    throw error;
  }
}

export async function archiveFamilyPlanet(scope: PlanetScope, planetId: string, version: number) {
  const planet = await requireActivePlanet(scope, planetId);
  await archivePlanet({ ...scope, planetId, version });

  return {
    id: planet.id,
    version: version + 1,
    archived: true,
  };
}

export async function restoreFamilyPlanet(scope: PlanetScope, planetId: string, version: number) {
  const planet = await findScopedPlanet({ ...scope, planetId });

  if (!planet || !planet.deletedAt) {
    throw planetNotFound();
  }

  await restorePlanet({ ...scope, planetId, version });

  return {
    id: planet.id,
    version: version + 1,
    archived: false,
  };
}

export async function createFamilyRelationship(
  scope: PlanetScope,
  sourcePlanetId: string,
  input: CreateFamilyRelationshipInput,
): Promise<IdempotencyStatus> {
  if (sourcePlanetId === input.targetPlanetId) {
    throw new DomainError("RELATIONSHIP_SELF_LINK", 400, "不能将星球与自身建立关系。");
  }

  const { idempotencyKey, ...payload } = input;

  return executeIdempotentDbOperation(
    getPrismaClient(),
    prismaIdempotencyRepository,
    {
      ...scope,
      scope: `planet:${sourcePlanetId}:relationship:create`,
      key: idempotencyKey,
      requestHash: hashRequest({ sourcePlanetId, ...payload }),
    },
    async (transaction) => {
      try {
        const lockedPlanets = await lockActivePlanetsForRelationship({
          ...scope,
          sourcePlanetId,
          targetPlanetId: input.targetPlanetId,
        }, transaction);

        if (lockedPlanets.length !== 2) {
          throw planetNotFound();
        }

        const existing = await findActiveRelationship({
          ...scope,
          sourcePlanetId,
          targetPlanetId: input.targetPlanetId,
          relationshipType: input.relationshipType,
        }, transaction);

        if (existing) {
          throw relationshipExists();
        }

        const relationship = await createPlanetRelationship({
          ...scope,
          sourcePlanetId,
          targetPlanetId: input.targetPlanetId,
          relationshipType: input.relationshipType,
          visibility: input.visibility,
          label: input.label,
        }, transaction);
        const response = {
          id: relationship.id,
          sourcePlanetId,
          targetPlanetId: input.targetPlanetId,
          relationshipType: input.relationshipType,
          visibility: input.visibility,
          label: input.label ?? null,
        };

        return {
          resourceType: "planet_relationship",
          resourceId: relationship.id,
          result: response,
          response,
          responseStatus: 201,
        };
      } catch (error) {
        if (isPlanetUniqueConstraintError(error)) {
          throw relationshipExists();
        }

        throw error;
      }
    },
  );
}

function toPlanetPatch(input: UpdateFamilyPlanetInput): ActivePlanetPatch {
  const data: ActivePlanetPatch = {};

  if (input.name !== undefined) data.name = input.name;
  if (input.type !== undefined) data.type = input.type;
  if (input.lifeState !== undefined) data.lifeState = input.lifeState;
  if (input.visibility !== undefined) data.visibility = input.visibility;
  if (input.role !== undefined) data.role = input.role;
  if (input.theme !== undefined) data.theme = input.theme;
  if (input.summary !== undefined) data.summary = input.summary;
  if (input.coverAssetId !== undefined) data.coverAssetId = input.coverAssetId;

  if (input.position) {
    data.positionX = input.position.x;
    data.positionY = input.position.y;
  } else {
    if (input.positionX !== undefined) data.positionX = input.positionX;
    if (input.positionY !== undefined) data.positionY = input.positionY;
  }

  if (input.lifeState === "memorial" && input.visibility === undefined) {
    data.visibility = "private";
  }

  return data;
}

async function requireActivePlanet(scope: PlanetScope, planetId: string) {
  const planet = await findActivePlanet({ ...scope, planetId });

  if (!planet) {
    throw planetNotFound();
  }

  return planet;
}

function toPlanetResponse(planet: PrismaPlanet): PlanetManagementResponse {
  return {
    id: planet.id,
    name: planet.name,
    type: planet.type,
    lifeState: planet.type === "memorial" ? "memorial" : planet.lifeState,
    visibility: planet.visibility,
    role: planet.role,
    theme: planet.theme,
    summary: planet.summary,
    position: { x: planet.positionX, y: planet.positionY },
    coverAssetId: planet.coverAssetId,
    version: planet.version,
    archivedAt: planet.archivedAt?.toISOString() ?? null,
    deletedAt: planet.deletedAt?.toISOString() ?? null,
  };
}

function assertPersistedPlanetType(type: string) {
  if (type === "memorial") {
    throw new DomainError("PLANET_TYPE_INVALID", 400, "纪念状态必须通过 lifeState 设置。");
  }
}

function planetNotFound() {
  return new DomainError("PLANET_NOT_FOUND", 404, "星球不存在或无权访问。");
}

function relationshipExists() {
  return new DomainError("RELATIONSHIP_EXISTS", 409, "该星球关系已存在。");
}

function coverAssetInvalid() {
  return new DomainError("PLANET_COVER_INVALID", 400, "封面必须是当前星球的图片资源。");
}

function hashRequest(payload: unknown) {
  return createHash("sha256").update(stableJson(payload)).digest("hex");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  const fields = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`);

  return `{${fields.join(",")}}`;
}
