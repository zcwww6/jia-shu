import { Prisma, type PrismaClient } from "@prisma/client";

import { getPrismaClient } from "@/server/db/client";
import { DomainError } from "@/server/domain-error";
import type { MemoryConfirmationPatch, MemoryDraftPatch } from "@/server/validation/domain-schemas";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

type MemoryRepositoryClient = Pick<PrismaClient, "memory" | "memoryAsset" | "$queryRaw">;

export type LockedDraftMemoryForAiJob = {
  id: string;
  planetId: string;
  sourceText: string;
  occurredAtLabel: string | null;
  visibility: "private" | "family" | "selected";
  version: number;
};

export type CreateMemoryWithTextAssetInput = {
  userId: string;
  galaxyId: string;
  planetId: string;
  sourceText: string;
  title?: string;
  visibility: "private" | "family" | "selected";
  allowResonance: boolean;
  allowBook: boolean;
  occurredAtLabel?: string;
  textAsset: {
    storageKey: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    originalName: string;
  };
};

export type CreateMemoryWithAssetsInput = {
  userId: string;
  galaxyId: string;
  planetId: string;
  sourceText: string;
  assetIds: string[];
  title?: string;
  visibility: "private" | "family" | "selected";
  allowResonance: boolean;
  allowBook: boolean;
  occurredAtLabel?: string;
};

export type LockedMemoryAsset = {
  id: string;
  kind: "image" | "audio" | "document" | "planet_cover" | "text";
  visibility: "private" | "family" | "selected";
};

export async function createMemoryWithTextAsset(
  input: CreateMemoryWithTextAssetInput,
  client?: MemoryRepositoryClient,
) {
  const prisma = client ?? getPrismaClient();
  const memory = await prisma.memory.create({
    data: {
      userId: input.userId,
      galaxyId: input.galaxyId,
      planetId: input.planetId,
      sourceText: input.sourceText,
      title: input.title,
      visibility: input.visibility,
      allowResonance: input.allowResonance,
      allowBook: input.allowBook,
      occurredAtLabel: input.occurredAtLabel,
      status: "draft",
      confirmedAt: null,
    },
  });

  await prisma.memoryAsset.create({
    data: {
      userId: input.userId,
      galaxyId: input.galaxyId,
      planetId: input.planetId,
      memoryId: memory.id,
      kind: "text",
      visibility: input.visibility,
      storageKey: input.textAsset.storageKey,
      mimeType: input.textAsset.mimeType,
      sizeBytes: input.textAsset.sizeBytes,
      sha256: input.textAsset.sha256,
      originalName: input.textAsset.originalName,
      status: "stored",
    },
  });

  return memory;
}

function uniqueMemoryAssetIds(assetIds: string[]) {
  const uniqueAssetIds = [...new Set(assetIds)];

  if (uniqueAssetIds.length === 0 || uniqueAssetIds.length !== assetIds.length) {
    throw new DomainError("MEMORY_ASSET_UNAVAILABLE", 422, "素材不可用于创建这条记忆。");
  }

  return uniqueAssetIds;
}

function assertLockedAssetsForMemory(input: CreateMemoryWithAssetsInput, lockedAssets: LockedMemoryAsset[]) {
  const uniqueAssetIds = uniqueMemoryAssetIds(input.assetIds);

  if (
    lockedAssets.length !== uniqueAssetIds.length
    || new Set(lockedAssets.map((asset) => asset.id)).size !== uniqueAssetIds.length
    || lockedAssets.some((asset) => !uniqueAssetIds.includes(asset.id))
  ) {
    throw new DomainError("MEMORY_ASSET_UNAVAILABLE", 422, "素材不可用于创建这条记忆。");
  }

  const sourceKind = lockedAssets[0]?.kind;

  if (
    !sourceKind
    || sourceKind === "text"
    || sourceKind === "planet_cover"
    || lockedAssets.some((asset) => asset.kind !== sourceKind)
  ) {
    throw new DomainError("MEMORY_ASSET_SOURCE_INVALID", 422, "同一条记忆只能使用一种受支持的素材类型。");
  }

  if (lockedAssets.some((asset) => asset.visibility !== input.visibility)) {
    throw new DomainError("MEMORY_ASSET_VISIBILITY_INVALID", 422, "素材可见范围必须与记忆一致。");
  }
}

/**
 * Global lock order for any transaction that needs both resource types is
 * MemoryAsset -> Planet. The service calls this scoped lock before it locks
 * the active Planet, matching the cover-update path and preventing cycles.
 */
export async function lockAssetsForMemory(
  input: CreateMemoryWithAssetsInput,
  client: Pick<PrismaClient, "$queryRaw">,
) {
  const uniqueAssetIds = uniqueMemoryAssetIds(input.assetIds);

  const lockedAssets = await client.$queryRaw<LockedMemoryAsset[]>(Prisma.sql`
    SELECT "id", "kind", "visibility"
    FROM "MemoryAsset"
    WHERE "userId" = ${input.userId}
      AND "galaxyId" = ${input.galaxyId}
      AND "planetId" = ${input.planetId}
      AND "id" IN (${Prisma.join(uniqueAssetIds)})
      AND "memoryId" IS NULL
      AND "deletedAt" IS NULL
      AND ("status" = ${"stored"} OR "status" = ${"ready"})
    ORDER BY "id" ASC
    FOR UPDATE
  `);

  assertLockedAssetsForMemory(input, lockedAssets);

  return lockedAssets;
}

/**
 * The caller owns the surrounding idempotency transaction. Asset rows are
 * locked before the Memory row is created, so an invalid or cross-scoped
 * attachment cannot leave a standalone draft behind.
 */
export async function createMemoryWithAssets(
  input: CreateMemoryWithAssetsInput,
  client: MemoryRepositoryClient,
  lockedAssets?: LockedMemoryAsset[],
) {
  const uniqueAssetIds = uniqueMemoryAssetIds(input.assetIds);
  const assets = lockedAssets ?? await lockAssetsForMemory(input, client);

  // A service-supplied snapshot was locked earlier in this same transaction.
  // Recheck its shape before binding so a mismatched asset/planet is rejected.
  assertLockedAssetsForMemory(input, assets);

  const memory = await client.memory.create({
    data: {
      userId: input.userId,
      galaxyId: input.galaxyId,
      planetId: input.planetId,
      sourceText: input.sourceText,
      title: input.title,
      visibility: input.visibility,
      allowResonance: input.allowResonance,
      allowBook: input.allowBook,
      occurredAtLabel: input.occurredAtLabel,
      status: "draft",
      confirmedAt: null,
    },
  });

  const attached = await client.memoryAsset.updateMany({
    where: {
      id: { in: uniqueAssetIds },
      userId: input.userId,
      galaxyId: input.galaxyId,
      planetId: input.planetId,
      memoryId: null,
      deletedAt: null,
      status: { in: ["stored", "ready"] },
    },
    data: { memoryId: memory.id },
  });

  if (attached.count !== uniqueAssetIds.length) {
    throw new DomainError("MEMORY_ASSET_UNAVAILABLE", 422, "素材不可用于创建这条记忆。");
  }

  return memory;
}

export async function findActiveMemory(input: {
  userId: string;
  galaxyId: string;
  memoryId: string;
}, client?: MemoryRepositoryClient) {
  const prisma = client ?? getPrismaClient();

  return prisma.memory.findFirst({
    where: {
      id: input.memoryId,
      userId: input.userId,
      galaxyId: input.galaxyId,
      deletedAt: null,
    },
  });
}

export async function findMemoryReview(input: { userId: string; galaxyId: string; memoryId: string }) {
  return getPrismaClient().memory.findFirst({
    where: { id: input.memoryId, userId: input.userId, galaxyId: input.galaxyId, deletedAt: null },
    select: { id: true, planetId: true, status: true, version: true, sourceText: true, visibility: true, allowResonance: true, allowBook: true, title: true, occurredAtLabel: true, locationLabel: true, people: true, tags: true, summary: true, uncertainFields: true, assets: { where: { deletedAt: null }, select: { id: true, kind: true, originalName: true, mimeType: true, sizeBytes: true } } },
  });
}

/**
 * Locks the exact draft row while consent is captured. The caller must retain
 * the supplied transaction through both snapshot hashing and AI-job creation.
 */
export async function lockActiveDraftMemoryForAiJob(input: {
  userId: string;
  galaxyId: string;
  memoryId: string;
}, client?: MemoryRepositoryClient) {
  const prisma = client ?? getPrismaClient();

  return prisma.$queryRaw<LockedDraftMemoryForAiJob[]>(Prisma.sql`
    SELECT "id", "planetId", "sourceText", "occurredAtLabel", "visibility", "version"
    FROM "Memory"
    WHERE "userId" = ${input.userId}
      AND "galaxyId" = ${input.galaxyId}
      AND "id" = ${input.memoryId}
      AND "status" = ${"draft"}
      AND "deletedAt" IS NULL
    FOR UPDATE
  `);
}

export async function updateMemoryDraft(input: {
  userId: string;
  galaxyId: string;
  memoryId: string;
  version: number;
  patch: MemoryDraftPatch;
}) {
  const prisma = getPrismaClient();
  const updateDraft = async (client: Pick<PrismaClient, "memory" | "memoryAsset">) => {
    const result = await client.memory.updateMany({
      where: {
        id: input.memoryId,
        userId: input.userId,
        galaxyId: input.galaxyId,
        deletedAt: null,
        status: "draft",
        version: input.version,
      },
      data: {
        ...input.patch,
        version: { increment: 1 },
      },
    });

    if (result.count !== 1) {
      throw new DomainError("VERSION_CONFLICT", 409);
    }

    if (input.patch.visibility !== undefined) {
      await client.memoryAsset.updateMany({
        where: {
          userId: input.userId,
          galaxyId: input.galaxyId,
          memoryId: input.memoryId,
          deletedAt: null,
        },
        data: { visibility: input.patch.visibility },
      });
    }
  };

  if (input.patch.visibility === undefined) {
    return updateDraft(prisma);
  }

  return prisma.$transaction(updateDraft);
}

/**
 * Moves an immutable consent snapshot out of the editable draft state. The
 * caller reads the snapshot first, then this conditional write closes the
 * window before any provider call without holding a database transaction.
 */
export async function handoffActiveDraftMemoryToAiProcessing(input: {
  userId: string;
  galaxyId: string;
  memoryId: string;
  version: number;
}, client?: MemoryRepositoryClient): Promise<boolean> {
  const prisma = client ?? getPrismaClient();
  const result = await prisma.memory.updateMany({
    where: {
      id: input.memoryId,
      userId: input.userId,
      galaxyId: input.galaxyId,
      deletedAt: null,
      status: "draft",
      version: input.version,
    },
    data: {
      status: "processing",
    },
  });

  return result.count === 1;
}

export async function confirmMemory(input: {
  userId: string;
  galaxyId: string;
  memoryId: string;
  version: number;
  patch: MemoryConfirmationPatch;
  confirmedAt: Date;
}, client?: MemoryRepositoryClient) {
  const prisma = client ?? getPrismaClient();
  const result = await prisma.memory.updateMany({
    where: {
      id: input.memoryId,
      userId: input.userId,
      galaxyId: input.galaxyId,
      deletedAt: null,
      status: "needs_confirmation",
      version: input.version,
    },
    data: {
      ...input.patch,
      status: "confirmed",
      confirmedAt: input.confirmedAt,
      version: { increment: 1 },
    },
  });

  if (result.count !== 1) {
    throw new DomainError("VERSION_CONFLICT", 409);
  }
}

export async function softDeleteMemory(input: {
  userId: string;
  galaxyId: string;
  memoryId: string;
  version: number;
  now?: Date;
}) {
  const prisma = getPrismaClient();
  const now = input.now ?? new Date();
  const result = await prisma.memory.updateMany({
    where: {
      id: input.memoryId,
      userId: input.userId,
      galaxyId: input.galaxyId,
      deletedAt: null,
      status: { in: ["draft", "confirmed"] },
      version: input.version,
    },
    data: {
      status: "archived",
      deletedAt: now,
      purgeAfter: new Date(now.getTime() + THIRTY_DAYS_MS),
      version: { increment: 1 },
    },
  });

  if (result.count !== 1) {
    throw new DomainError("VERSION_CONFLICT", 409);
  }
}
