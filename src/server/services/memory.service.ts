import { createHash, randomUUID } from "node:crypto";

import type { Memory as PrismaMemory } from "@prisma/client";

import { getPrismaClient } from "@/server/db/client";
import { prismaIdempotencyRepository } from "@/server/db/idempotency-repo";
import {
  confirmMemory,
  createMemoryWithAssets,
  createMemoryWithTextAsset,
  findActiveMemory,
  findMemoryReview,
  lockAssetsForMemory,
  updateMemoryDraft,
} from "@/server/db/memory-repo";
import { lockActivePlanetForMemory } from "@/server/db/planet-repo";
import { DomainError } from "@/server/domain-error";
import {
  executeIdempotentDbOperation,
  type IdempotencyStatus,
} from "@/server/services/idempotency.service";
import type { MemoryConfirmationPatch, MemoryDraftPatch } from "@/server/validation/domain-schemas";

export type MemoryScope = {
  userId: string;
  galaxyId: string;
};

export type CreateTextMemoryInput = {
  planetId: string;
  sourceText: string;
  title?: string;
  visibility: "private" | "family" | "selected";
  allowResonance?: boolean;
  allowBook?: boolean;
  occurredAtLabel?: string;
  idempotencyKey: string;
};

export type CreateAssetBackedMemoryInput = {
  planetId: string;
  assetIds: string[];
  sourceText?: string;
  title?: string;
  visibility: "private" | "family" | "selected";
  allowResonance?: boolean;
  allowBook?: boolean;
  occurredAtLabel?: string;
  idempotencyKey: string;
};

type NormalizedCreateTextMemoryPayload = Omit<
  CreateTextMemoryInput,
  "idempotencyKey" | "allowResonance" | "allowBook"
> & {
  allowResonance: boolean;
  allowBook: boolean;
};

export type ConfirmTextMemoryInput = MemoryConfirmationPatch & {
  version: number;
};

export type UpdateTextMemoryDraftInput = MemoryDraftPatch & {
  version: number;
};

export type MemoryResponse = {
  id: string;
  planetId: string;
  sourceText: string;
  title: string | null;
  summary: string | null;
  tags: string[] | null;
  occurredAtLabel: string | null;
  locationLabel: string | null;
  people: string[] | null;
  visibility: "private" | "family" | "selected";
  allowResonance: boolean;
  allowBook: boolean;
  status: PrismaMemory["status"];
  confirmedAt: string | null;
  version: number;
};

export async function getMemoryReview(scope: MemoryScope, memoryId: string) {
  const memory = await findMemoryReview({ ...scope, memoryId });
  if (!memory) throw memoryNotFound();
  const strings = (value: unknown) => Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
  return { id: memory.id, planetId: memory.planetId, status: memory.status, version: memory.version, sourceType: memory.assets[0]?.kind ?? "text", visibility: memory.visibility, allowResonance: memory.allowResonance, allowBook: memory.allowBook, title: memory.title, occurredAtLabel: memory.occurredAtLabel, locationLabel: memory.locationLabel, people: strings(memory.people), tags: strings(memory.tags), summary: memory.summary, uncertainFields: strings(memory.uncertainFields), assets: memory.assets };
}

type MemoryResponsePatch = {
  sourceText?: string;
  title?: string;
  summary?: string;
  tags?: string[];
  occurredAtLabel?: string | null;
  locationLabel?: string | null;
  people?: string[];
  visibility?: MemoryResponse["visibility"];
  allowResonance?: boolean;
  allowBook?: boolean;
  status?: PrismaMemory["status"];
  confirmedAt?: Date;
  version?: number;
};

export async function createTextMemory(
  scope: MemoryScope,
  input: CreateTextMemoryInput,
): Promise<IdempotencyStatus> {
  const { idempotencyKey, ...rawPayload } = input;
  const payload = normalizeCreateTextMemoryPayload(rawPayload);

  return executeIdempotentDbOperation(
    getPrismaClient(),
    prismaIdempotencyRepository,
    {
      ...scope,
      scope: "memory:text:create",
      key: idempotencyKey,
      requestHash: hashRequest(payload),
    },
    async (transaction) => {
      const lockedPlanets = await lockActivePlanetForMemory({ ...scope, planetId: payload.planetId }, transaction);

      if (lockedPlanets.length !== 1) {
        throw memoryPlanetNotFound();
      }

      const created = await createMemoryWithTextAsset({
        ...scope,
        ...payload,
        textAsset: textAssetMetadata(payload.sourceText),
      }, transaction);
      const response = toMemoryResponse(created);

      return {
        resourceType: "memory",
        resourceId: created.id,
        result: response,
        response,
        responseStatus: 201,
      };
    },
  );
}

/**
 * A Memory remains an editable draft after local originals are associated.
 * Enqueuing any AI work is deliberately a separate, consent-bound operation.
 */
export async function createAssetBackedMemory(
  scope: MemoryScope,
  input: CreateAssetBackedMemoryInput,
): Promise<IdempotencyStatus> {
  const { idempotencyKey, assetIds, sourceText, ...rest } = input;
  const normalizedSourceText = sourceText?.trim() ?? "";

  if (assetIds.length === 0) {
    if (!normalizedSourceText) {
      throw new DomainError("MEMORY_SOURCE_REQUIRED", 422, "请提供文字或已存储的素材。");
    }

    return createTextMemory(scope, {
      ...rest,
      sourceText: normalizedSourceText,
      idempotencyKey,
    });
  }

  const payload = normalizeCreateAssetBackedMemoryPayload({
    ...rest,
    assetIds,
    sourceText: normalizedSourceText,
  });

  return executeIdempotentDbOperation(
    getPrismaClient(),
    prismaIdempotencyRepository,
    {
      ...scope,
      scope: "memory:asset:create",
      key: idempotencyKey,
      requestHash: hashRequest(payload),
    },
    async (transaction) => {
      // Global cross-resource order is MemoryAsset -> Planet, matching cover
      // updates. Keep both scoped locks in this idempotency transaction.
      const lockedAssets = await lockAssetsForMemory({
        ...scope,
        ...payload,
      }, transaction);
      const lockedPlanets = await lockActivePlanetForMemory({ ...scope, planetId: payload.planetId }, transaction);

      if (lockedPlanets.length !== 1) {
        throw memoryPlanetNotFound();
      }

      const created = await createMemoryWithAssets({
        ...scope,
        ...payload,
      }, transaction, lockedAssets);
      const response = toMemoryResponse(created);

      return {
        resourceType: "memory",
        resourceId: created.id,
        result: response,
        response,
        responseStatus: 201,
      };
    },
  );
}

function normalizeCreateTextMemoryPayload(
  input: Omit<CreateTextMemoryInput, "idempotencyKey">,
): NormalizedCreateTextMemoryPayload {
  return {
    ...input,
    allowResonance: input.allowResonance ?? false,
    allowBook: input.allowBook ?? false,
  };
}

function normalizeCreateAssetBackedMemoryPayload(
  input: Omit<CreateAssetBackedMemoryInput, "idempotencyKey" | "allowResonance" | "allowBook"> & {
    allowResonance?: boolean;
    allowBook?: boolean;
  },
) {
  return {
    ...input,
    sourceText: input.sourceText ?? "",
    allowResonance: input.allowResonance ?? false,
    allowBook: input.allowBook ?? false,
  };
}

export async function confirmTextMemory(
  scope: MemoryScope,
  memoryId: string,
  input: ConfirmTextMemoryInput,
  confirmedAt = new Date(),
): Promise<MemoryResponse> {
  const memory = await requireActiveMemory(scope, memoryId);

  if (memory.status !== "needs_confirmation") {
    throw memoryConfirmationNotReady();
  }

  const { version, ...patch } = input;
  await confirmMemory({ ...scope, memoryId, version, patch, confirmedAt });

  return memoryResponseWith(memory, {
    ...patch,
    status: "confirmed",
    confirmedAt,
    version: version + 1,
  });
}

export async function updateTextMemoryDraft(
  scope: MemoryScope,
  memoryId: string,
  input: UpdateTextMemoryDraftInput,
): Promise<MemoryResponse> {
  const memory = await requireActiveMemory(scope, memoryId);

  if (memory.status !== "draft") {
    throw memoryDraftNotEditable();
  }

  const { version, ...patch } = input;
  await updateMemoryDraft({ ...scope, memoryId, version, patch });

  return memoryResponseWith(memory, { ...patch, version: version + 1 });
}

function textAssetMetadata(sourceText: string) {
  return {
    storageKey: `internal/memory-text-meta/${randomUUID()}`,
    mimeType: "text/plain; charset=utf-8",
    sizeBytes: Buffer.byteLength(sourceText, "utf8"),
    sha256: createHash("sha256").update(sourceText).digest("hex"),
    originalName: "memory.txt",
  };
}

export function toMemoryResponse(memory: PrismaMemory): MemoryResponse {
  return {
    id: memory.id,
    planetId: memory.planetId,
    sourceText: memory.sourceText,
    title: memory.title,
    summary: memory.summary,
    tags: stringTags(memory.tags),
    occurredAtLabel: memory.occurredAtLabel,
    locationLabel: memory.locationLabel,
    people: stringPeople(memory.people),
    visibility: memory.visibility,
    allowResonance: memory.allowResonance,
    allowBook: memory.allowBook,
    status: memory.status,
    confirmedAt: memory.confirmedAt?.toISOString() ?? null,
    version: memory.version,
  };
}

function memoryResponseWith(
  memory: PrismaMemory,
  patch: MemoryResponsePatch,
): MemoryResponse {
  const response = toMemoryResponse(memory);

  return {
    ...response,
    sourceText: patch.sourceText ?? response.sourceText,
    title: patch.title ?? response.title,
    summary: patch.summary ?? response.summary,
    tags: patch.tags ?? response.tags,
    occurredAtLabel: patch.occurredAtLabel === undefined ? response.occurredAtLabel : patch.occurredAtLabel,
    locationLabel: patch.locationLabel === undefined ? response.locationLabel : patch.locationLabel,
    people: patch.people === undefined ? response.people : patch.people,
    visibility: patch.visibility ?? response.visibility,
    allowResonance: patch.allowResonance ?? response.allowResonance,
    allowBook: patch.allowBook ?? response.allowBook,
    status: patch.status ?? response.status,
    confirmedAt: patch.confirmedAt?.toISOString() ?? response.confirmedAt,
    version: patch.version ?? response.version,
  };
}

function stringTags(value: PrismaMemory["tags"]): string[] | null {
  return stringPeople(value);
}

function stringPeople(value: PrismaMemory["people"]): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;
}

function memoryPlanetNotFound() {
  return new DomainError("PLANET_NOT_FOUND", 404, "星球不存在或无权访问。");
}

async function requireActiveMemory(scope: MemoryScope, memoryId: string) {
  const memory = await findActiveMemory({ ...scope, memoryId });

  if (!memory) {
    throw memoryNotFound();
  }

  return memory;
}

function memoryNotFound() {
  return new DomainError("MEMORY_NOT_FOUND", 404, "记忆不存在或无权访问。");
}

function memoryConfirmationNotReady() {
  return new DomainError("MEMORY_CONFIRMATION_NOT_READY", 409, "记忆尚未进入待确认状态。");
}

function memoryDraftNotEditable() {
  return new DomainError("MEMORY_DRAFT_NOT_EDITABLE", 409, "只有草稿状态的记忆可以修改。");
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
