import { Prisma, type PrismaClient } from "@prisma/client";

import { getPrismaClient } from "@/server/db/client";
import { DomainError } from "@/server/domain-error";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
export const PLANET_VERSION_CONFLICT_MESSAGE = "这颗星球已在另一处更新，请刷新后重试。";

type PlanetRepositoryClient = Pick<PrismaClient, "planet" | "planetRelationship" | "$queryRaw">;
type PersistedPlanetType = "self" | "parent" | "child" | "public" | "partner" | "other";
type PlanetLifeState = "active" | "memorial";
type PlanetVisibility = "private" | "family" | "selected" | "public";
type ContentVisibility = "private" | "family" | "selected";
type PlanetRelationshipType = "self" | "parent" | "child" | "partner" | "ancestor" | "other";

export type CreatePlanetInput = {
  userId: string;
  galaxyId: string;
  name: string;
  type: PersistedPlanetType;
  lifeState?: PlanetLifeState;
  visibility: PlanetVisibility;
  role?: string | null;
  theme?: string | null;
  summary?: string | null;
  positionX?: number | null;
  positionY?: number | null;
  coverAssetId?: string | null;
};

export type ActivePlanetPatch = Partial<Omit<CreatePlanetInput, "userId" | "galaxyId">>;

export async function findActivePlanet(input: {
  userId: string;
  galaxyId: string;
  planetId: string;
}, client?: PlanetRepositoryClient) {
  const prisma = client ?? getPrismaClient();

  return prisma.planet.findFirst({
    where: {
      id: input.planetId,
      userId: input.userId,
      galaxyId: input.galaxyId,
      deletedAt: null,
    },
  });
}

export async function findScopedPlanet(input: {
  userId: string;
  galaxyId: string;
  planetId: string;
}, client?: PlanetRepositoryClient) {
  const prisma = client ?? getPrismaClient();

  return prisma.planet.findFirst({
    where: {
      id: input.planetId,
      userId: input.userId,
      galaxyId: input.galaxyId,
    },
  });
}

export async function createPlanet(input: CreatePlanetInput, client?: PlanetRepositoryClient) {
  const prisma = client ?? getPrismaClient();
  assertPersistedPlanetType(input.type);

  return prisma.planet.create({ data: input });
}

export async function updateActivePlanet(input: {
  userId: string;
  galaxyId: string;
  planetId: string;
  version: number;
  data: ActivePlanetPatch;
}, client?: PlanetRepositoryClient) {
  const prisma = client ?? getPrismaClient();
  if (input.data.type !== undefined) {
    assertPersistedPlanetType(input.data.type);
  }
  const result = await prisma.planet.updateMany({
    where: {
      id: input.planetId,
      userId: input.userId,
      galaxyId: input.galaxyId,
      deletedAt: null,
      version: input.version,
    },
    data: {
      ...input.data,
      version: { increment: 1 },
    },
  });

  if (result.count !== 1) {
    throw versionConflict();
  }

  const updated = await findActivePlanet(input, prisma);

  if (!updated) {
    throw new DomainError("PLANET_NOT_FOUND", 404, "星球不存在或无权访问。");
  }

  return updated;
}

export async function softDeletePlanet(input: {
  userId: string;
  galaxyId: string;
  planetId: string;
  version: number;
  now?: Date;
}, client?: PlanetRepositoryClient) {
  return archivePlanet(input, client);
}

export async function archivePlanet(input: {
  userId: string;
  galaxyId: string;
  planetId: string;
  version: number;
  now?: Date;
}, client?: PlanetRepositoryClient) {
  const prisma = client ?? getPrismaClient();
  const now = input.now ?? new Date();
  const result = await prisma.planet.updateMany({
    where: {
      id: input.planetId,
      userId: input.userId,
      galaxyId: input.galaxyId,
      deletedAt: null,
      version: input.version,
    },
    data: {
      archivedAt: now,
      deletedAt: now,
      purgeAfter: new Date(now.getTime() + THIRTY_DAYS_MS),
      version: { increment: 1 },
    },
  });

  if (result.count !== 1) {
    throw versionConflict();
  }
}

export async function restorePlanet(input: {
  userId: string;
  galaxyId: string;
  planetId: string;
  version: number;
}, client?: PlanetRepositoryClient) {
  const prisma = client ?? getPrismaClient();
  const result = await prisma.planet.updateMany({
    where: {
      id: input.planetId,
      userId: input.userId,
      galaxyId: input.galaxyId,
      deletedAt: { not: null },
      version: input.version,
    },
    data: {
      archivedAt: null,
      deletedAt: null,
      purgeAfter: null,
      version: { increment: 1 },
    },
  });

  if (result.count !== 1) {
    throw versionConflict();
  }
}

export async function findActiveRelationship(input: {
  userId: string;
  galaxyId: string;
  sourcePlanetId: string;
  targetPlanetId: string;
  relationshipType: PlanetRelationshipType;
}, client?: PlanetRepositoryClient) {
  const prisma = client ?? getPrismaClient();

  return prisma.planetRelationship.findFirst({
    where: {
      userId: input.userId,
      galaxyId: input.galaxyId,
      sourcePlanetId: input.sourcePlanetId,
      targetPlanetId: input.targetPlanetId,
      relationshipType: input.relationshipType,
      deletedAt: null,
    },
  });
}

/**
 * Locks the two relationship endpoints in a deterministic order. PostgreSQL
 * holds these row locks until the enclosing idempotency transaction completes,
 * which serializes this operation with archive updates on either planet.
 */
export async function lockActivePlanetsForRelationship(input: {
  userId: string;
  galaxyId: string;
  sourcePlanetId: string;
  targetPlanetId: string;
}, client?: PlanetRepositoryClient) {
  const prisma = client ?? getPrismaClient();
  const [firstPlanetId, secondPlanetId] = [input.sourcePlanetId, input.targetPlanetId].sort();

  return prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "Planet"
    WHERE "userId" = ${input.userId}
      AND "galaxyId" = ${input.galaxyId}
      AND ("id" = ${firstPlanetId} OR "id" = ${secondPlanetId})
      AND "archivedAt" IS NULL
      AND "deletedAt" IS NULL
    ORDER BY "id" ASC
    FOR UPDATE
  `);
}

/**
 * Serializes a text-memory creation with archive/delete operations on its
 * single planet. The caller must hold this lock for the entire creation
 * transaction, so checking activity and writing the memory are one operation.
 */
export async function lockActivePlanetForMemory(input: {
  userId: string;
  galaxyId: string;
  planetId: string;
}, client?: PlanetRepositoryClient) {
  const prisma = client ?? getPrismaClient();

  return prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "Planet"
    WHERE "userId" = ${input.userId}
      AND "galaxyId" = ${input.galaxyId}
      AND "id" = ${input.planetId}
      AND "archivedAt" IS NULL
      AND "deletedAt" IS NULL
    FOR UPDATE
  `);
}

export async function createPlanetRelationship(input: {
  userId: string;
  galaxyId: string;
  sourcePlanetId: string;
  targetPlanetId: string;
  relationshipType: PlanetRelationshipType;
  label?: string | null;
  visibility: ContentVisibility;
}, client?: PlanetRepositoryClient) {
  const prisma = client ?? getPrismaClient();

  return prisma.planetRelationship.create({ data: input });
}

export function isPlanetUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function versionConflict() {
  return new DomainError("VERSION_CONFLICT", 409, PLANET_VERSION_CONFLICT_MESSAGE);
}

function assertPersistedPlanetType(type: string) {
  if (type === "memorial") {
    throw new DomainError("PLANET_TYPE_INVALID", 400, "纪念状态必须通过 lifeState 设置。");
  }
}
