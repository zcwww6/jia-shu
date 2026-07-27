import { Prisma, type PrismaClient } from "@prisma/client";

import { getPrismaClient } from "@/server/db/client";
import { DomainError } from "@/server/domain-error";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
type AssetTransactionClient = Pick<PrismaClient, "memory" | "memoryAsset" | "planet" | "$queryRaw">;
type AssetRepositoryClient = AssetTransactionClient & Pick<PrismaClient, "$transaction">;

export type ReadableMemoryAiAsset = {
  id: string;
  kind: "text" | "image" | "audio" | "document" | "planet_cover";
  visibility: "private" | "family" | "selected";
  sha256: string;
  storageKey: string;
  normalizedStorageKey: string | null;
  thumbnailStorageKey: string | null;
  mimeType: string;
  originalName: string;
  sizeBytes: number;
  extractedText: string | null;
  transcript: string | null;
};

export type CreateAssetInput = {
  id: string;
  userId: string;
  galaxyId: string;
  planetId: string;
  kind: "image" | "audio" | "document" | "planet_cover";
  visibility: "private" | "family" | "selected";
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  originalName: string;
  width?: number;
  height?: number;
  durationMs?: number;
  extractedText?: string;
  thumbnailStorageKey?: string;
  normalizedStorageKey?: string;
  status: "processing" | "stored" | "failed";
};

export async function createAsset(input: CreateAssetInput) {
  const prisma = getPrismaClient();

  return prisma.memoryAsset.create({ data: input });
}

export async function updateAssetStatus(input: {
  userId: string;
  galaxyId: string;
  assetId: string;
  status: "stored" | "failed";
}) {
  const prisma = getPrismaClient();

  const result = await prisma.memoryAsset.updateMany({
    where: {
      id: input.assetId,
      userId: input.userId,
      galaxyId: input.galaxyId,
      deletedAt: null,
    },
    data: { status: input.status },
  });

  if (result.count !== 1) {
    throw new DomainError("ASSET_NOT_FOUND", 404);
  }
}

export async function findActiveAsset(input: {
  userId: string;
  galaxyId: string;
  assetId: string;
}) {
  const prisma = getPrismaClient();

  return prisma.memoryAsset.findFirst({
    where: {
      id: input.assetId,
      userId: input.userId,
      galaxyId: input.galaxyId,
      deletedAt: null,
    },
  });
}

export async function lockReadableMemoryAssetsForAiJob(input: {
  userId: string;
  galaxyId: string;
  planetId: string;
  memoryId: string;
}, client: Pick<PrismaClient, "$queryRaw">) {
  return client.$queryRaw<ReadableMemoryAiAsset[]>(Prisma.sql`
    SELECT "id", "kind", "visibility", "sha256", "storageKey",
           "normalizedStorageKey", "thumbnailStorageKey", "mimeType",
           "originalName", "sizeBytes", "extractedText", "transcript"
    FROM "MemoryAsset"
    WHERE "userId" = ${input.userId}
      AND "galaxyId" = ${input.galaxyId}
      AND "planetId" = ${input.planetId}
      AND "memoryId" = ${input.memoryId}
      AND "deletedAt" IS NULL
      AND ("status" = ${"stored"} OR "status" = ${"ready"})
    ORDER BY "id" ASC
    FOR UPDATE
  `);
}

export async function findReadableMemoryAssetsForAiJob(input: {
  userId: string;
  galaxyId: string;
  planetId: string;
  memoryId: string;
}) {
  const prisma = getPrismaClient();

  return prisma.memoryAsset.findMany({
    where: {
      userId: input.userId,
      galaxyId: input.galaxyId,
      planetId: input.planetId,
      memoryId: input.memoryId,
      deletedAt: null,
      status: { in: ["stored", "ready"] },
    },
    orderBy: { id: "asc" },
  });
}

/**
 * Locks one readable cover candidate until its enclosing planet update commits.
 * The filter deliberately rejects processing/failed files and assets that do
 * not belong to the planet being updated.
 */
export async function lockReadableCoverAsset(input: {
  userId: string;
  galaxyId: string;
  planetId: string;
  assetId: string;
}, client?: AssetTransactionClient) {
  const prisma = client ?? getPrismaClient();

  return prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "MemoryAsset"
    WHERE "id" = ${input.assetId}
      AND "userId" = ${input.userId}
      AND "galaxyId" = ${input.galaxyId}
      AND "planetId" = ${input.planetId}
      AND "deletedAt" IS NULL
      AND ("kind" = ${"image"} OR "kind" = ${"planet_cover"})
      AND ("status" = ${"stored"} OR "status" = ${"ready"})
    FOR UPDATE
  `);
}

/**
 * Captures the binding without holding a lock. A bound asset is later locked
 * in Memory -> Asset order; an unbound asset is rechecked under its own lock.
 */
async function findAssetMemoryBindingForSoftDelete(input: {
  userId: string;
  galaxyId: string;
  assetId: string;
  version: number;
}, client?: Pick<PrismaClient, "memoryAsset">) {
  const prisma = client ?? getPrismaClient();

  return prisma.memoryAsset.findFirst({
    where: {
      id: input.assetId,
      userId: input.userId,
      galaxyId: input.galaxyId,
      version: input.version,
      deletedAt: null,
    },
    select: { memoryId: true },
  });
}

/**
 * Takes the parent Memory lock before an associated asset lock. This matches
 * AI-job creation's Memory -> Asset order and keeps a draft->processing CAS
 * from interleaving with a delete that would otherwise race a provider call.
 */
async function lockActiveMemoryForAssetSoftDelete(input: {
  userId: string;
  galaxyId: string;
  memoryId: string;
}, client: AssetTransactionClient) {
  return client.$queryRaw<Array<{ id: string; status: string }>>(Prisma.sql`
    SELECT "id", "status"
    FROM "Memory"
    WHERE "userId" = ${input.userId}
      AND "galaxyId" = ${input.galaxyId}
      AND "id" = ${input.memoryId}
      AND "deletedAt" IS NULL
    FOR UPDATE
  `);
}

/**
 * Locks the deletion candidate only after its expected binding has been
 * established. An initially-unbound asset is never followed by a Memory lock:
 * if it became bound while waiting, the caller receives a retryable conflict.
 */
export async function lockActiveAssetForSoftDelete(input: {
  userId: string;
  galaxyId: string;
  assetId: string;
  version: number;
  expectedMemoryId: string | null;
}, client: AssetTransactionClient) {
  const common = Prisma.sql`
    SELECT "id", "memoryId"
    FROM "MemoryAsset"
    WHERE "userId" = ${input.userId}
      AND "galaxyId" = ${input.galaxyId}
      AND "id" = ${input.assetId}
      AND "version" = ${input.version}
      AND "deletedAt" IS NULL
  `;

  if (input.expectedMemoryId === null) {
    return client.$queryRaw<Array<{ id: string; memoryId: string | null }>>(Prisma.sql`
      ${common}
      AND "memoryId" IS NULL
      FOR UPDATE
    `);
  }

  return client.$queryRaw<Array<{ id: string; memoryId: string | null }>>(Prisma.sql`
    ${common}
      AND "memoryId" = ${input.expectedMemoryId}
    FOR UPDATE
  `);
}

export async function softDeleteAsset(input: {
  userId: string;
  galaxyId: string;
  assetId: string;
  version: number;
  now?: Date;
}) {
  const prisma: AssetRepositoryClient = getPrismaClient();
  const now = input.now ?? new Date();
  const initialBinding = await findAssetMemoryBindingForSoftDelete(input, prisma);

  if (!initialBinding) {
    throw new DomainError("VERSION_CONFLICT", 409);
  }

  await prisma.$transaction(async (transaction) => {
    const lockedMemory = initialBinding.memoryId
      ? await lockActiveMemoryForAssetSoftDelete({
        userId: input.userId,
        galaxyId: input.galaxyId,
        memoryId: initialBinding.memoryId,
      }, transaction)
      : [];

    if (initialBinding.memoryId && lockedMemory.length !== 1) {
      throw new DomainError("VERSION_CONFLICT", 409);
    }

    const lockedAssets = await lockActiveAssetForSoftDelete({
      ...input,
      expectedMemoryId: initialBinding.memoryId,
    }, transaction);

    if (lockedAssets.length !== 1 || lockedAssets[0]?.memoryId !== initialBinding.memoryId) {
      throw new DomainError("VERSION_CONFLICT", 409);
    }

    if (lockedMemory[0]?.status === "processing") {
      throw new DomainError("ASSET_IN_USE", 409, "该资源正在由 AI 处理，无法删除。");
    }

    const coverReference = await transaction.planet.findFirst({
      where: {
        userId: input.userId,
        galaxyId: input.galaxyId,
        coverAssetId: input.assetId,
      },
      select: { id: true },
    });

    if (coverReference) {
      throw new DomainError("ASSET_IN_USE", 409, "该资源正在被星球用作封面，无法删除。");
    }

    const result = await transaction.memoryAsset.updateMany({
      where: {
        id: input.assetId,
        userId: input.userId,
        galaxyId: input.galaxyId,
        memoryId: initialBinding.memoryId,
        deletedAt: null,
        version: input.version,
      },
      data: {
        deletedAt: now,
        purgeAfter: new Date(now.getTime() + THIRTY_DAYS_MS),
        version: { increment: 1 },
      },
    });

    if (result.count !== 1) {
      throw new DomainError("VERSION_CONFLICT", 409);
    }
  });
}
