import { beforeEach, describe, expect, it, vi } from "vitest";
import * as assetRepo from "./asset-repo";

const { getPrismaClient } = vi.hoisted(() => ({
  getPrismaClient: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  getPrismaClient,
}));

import {
  findActiveAsset,
  findReadableMemoryAssetsForAiJob,
  lockReadableMemoryAssetsForAiJob,
  softDeleteAsset,
} from "./asset-repo";

describe("asset repo", () => {
  beforeEach(() => {
    getPrismaClient.mockReset();
  });

  it("reads an active asset only inside the caller's galaxy scope", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "asset-1" });
    getPrismaClient.mockReturnValue({ memoryAsset: { findFirst } });

    await findActiveAsset({ userId: "user-1", galaxyId: "galaxy-1", assetId: "asset-1" });

    expect(findFirst).toHaveBeenCalledWith({
      where: { id: "asset-1", userId: "user-1", galaxyId: "galaxy-1", deletedAt: null },
    });
  });

  it("creates an asset with its owner and galaxy scope", async () => {
    const create = vi.fn().mockResolvedValue({ id: "asset-1" });
    getPrismaClient.mockReturnValue({ memoryAsset: { create } });
    const createAsset = (assetRepo as typeof assetRepo & {
      createAsset: (input: {
        id: string;
        userId: string;
        galaxyId: string;
        planetId: string;
        kind: "image";
        visibility: "private";
        storageKey: string;
        mimeType: string;
        sizeBytes: number;
        sha256: string;
        originalName: string;
        status: "processing";
      }) => Promise<{ id: string }>;
    }).createAsset;
    const input = {
      id: "asset-1",
      userId: "user-1",
      galaxyId: "galaxy-1",
      planetId: "planet-1",
      kind: "image" as const,
      visibility: "private" as const,
      storageKey: "user-1/as/asset-1.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 3,
      sha256: "hash",
      originalName: "photo.jpg",
      status: "processing" as const,
    };

    await createAsset(input);

    expect(create).toHaveBeenCalledWith({ data: input });
  });

  it("updates an asset status only inside the owner and galaxy scope", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    getPrismaClient.mockReturnValue({ memoryAsset: { updateMany } });
    const updateAssetStatus = (assetRepo as typeof assetRepo & {
      updateAssetStatus: (input: {
        userId: string;
        galaxyId: string;
        assetId: string;
        status: "stored" | "failed";
      }) => Promise<void>;
    }).updateAssetStatus;

    await updateAssetStatus({
      userId: "user-1",
      galaxyId: "galaxy-1",
      assetId: "asset-1",
      status: "stored",
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "asset-1",
        userId: "user-1",
        galaxyId: "galaxy-1",
        deletedAt: null,
      },
      data: { status: "stored" },
    });
  });

  it("does not update an asset status when the scoped asset is gone", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    getPrismaClient.mockReturnValue({ memoryAsset: { updateMany } });
    const updateAssetStatus = (assetRepo as typeof assetRepo & {
      updateAssetStatus: (input: {
        userId: string;
        galaxyId: string;
        assetId: string;
        status: "stored" | "failed";
      }) => Promise<void>;
    }).updateAssetStatus;

    await expect(updateAssetStatus({
      userId: "user-1",
      galaxyId: "galaxy-1",
      assetId: "asset-1",
      status: "stored",
    })).rejects.toMatchObject({ code: "ASSET_NOT_FOUND", status: 404 });
  });

  it("locks only a readable current-planet cover asset through a parameterized query", async () => {
    const $queryRaw = vi.fn().mockResolvedValue([{ id: "asset-1" }]);
    getPrismaClient.mockReturnValue({ $queryRaw });
    const lockReadableCoverAsset = (assetRepo as typeof assetRepo & {
      lockReadableCoverAsset: (input: {
        userId: string;
        galaxyId: string;
        planetId: string;
        assetId: string;
      }) => Promise<Array<{ id: string }>>;
    }).lockReadableCoverAsset;

    await expect(lockReadableCoverAsset({
      userId: "user-1",
      galaxyId: "galaxy-1",
      planetId: "planet-1",
      assetId: "asset-1",
    })).resolves.toEqual([{ id: "asset-1" }]);

    const query = $queryRaw.mock.calls[0]?.[0] as { strings: string[]; values: unknown[] };
    const sql = query.strings.join("?");
    expect(sql).toContain('FROM "MemoryAsset"');
    expect(sql).toContain('"id" = ?');
    expect(sql).toContain('"userId" = ?');
    expect(sql).toContain('"galaxyId" = ?');
    expect(sql).toContain('"planetId" = ?');
    expect(sql).toContain('"deletedAt" IS NULL');
    expect(sql).toContain('"kind" = ?');
    expect(sql).toContain('"status" = ?');
    expect(sql).toContain("FOR UPDATE");
    expect(query.values).toEqual([
      "asset-1",
      "user-1",
      "galaxy-1",
      "planet-1",
      "image",
      "planet_cover",
      "stored",
      "ready",
    ]);
  });

  it("locks all owner-scoped readable assets already bound to the consented memory", async () => {
    const $queryRaw = vi.fn().mockResolvedValue([{ id: "asset-image", kind: "image" }]);
    const transaction = { $queryRaw };

    await expect(lockReadableMemoryAssetsForAiJob({
      userId: "user-1",
      galaxyId: "galaxy-1",
      planetId: "planet-1",
      memoryId: "memory-1",
    }, transaction as never)).resolves.toEqual([{ id: "asset-image", kind: "image" }]);

    const query = $queryRaw.mock.calls[0]?.[0] as { strings: string[]; values: unknown[] };
    const sql = query.strings.join("?");
    expect(sql).toContain('FROM "MemoryAsset"');
    expect(sql).toContain('"userId" = ?');
    expect(sql).toContain('"galaxyId" = ?');
    expect(sql).toContain('"planetId" = ?');
    expect(sql).toContain('"memoryId" = ?');
    expect(sql).toContain('"deletedAt" IS NULL');
    expect(sql).toContain('"status" = ?');
    expect(sql).toContain("FOR UPDATE");
    expect(query.values).toEqual([
      "user-1",
      "galaxy-1",
      "planet-1",
      "memory-1",
      "stored",
      "ready",
    ]);
  });

  it("reads worker input only through the same owner, galaxy, planet, memory, and readable-state scope", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "asset-document", kind: "document" }]);
    getPrismaClient.mockReturnValue({ memoryAsset: { findMany } });

    await findReadableMemoryAssetsForAiJob({
      userId: "user-1",
      galaxyId: "galaxy-1",
      planetId: "planet-1",
      memoryId: "memory-1",
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        galaxyId: "galaxy-1",
        planetId: "planet-1",
        memoryId: "memory-1",
        deletedAt: null,
        status: { in: ["stored", "ready"] },
      },
      orderBy: { id: "asc" },
    });
  });

  it("rechecks a cover after locking the asset and rejects a reference that appears during the lock wait", async () => {
    const events: string[] = [];
    let assetLockAcquired = false;
    const initialBinding = vi.fn().mockImplementation(async () => {
      events.push("initial-binding");
      return { memoryId: null };
    });
    const $queryRaw = vi.fn().mockImplementation(async () => {
      events.push("asset-lock");
      assetLockAcquired = true;
      return [{ id: "asset-1", memoryId: null }];
    });
    const findFirst = vi.fn().mockImplementation(async () => {
      events.push("cover-check");
      return assetLockAcquired ? { id: "planet-1" } : null;
    });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = {
      $queryRaw,
      planet: { findFirst },
      memoryAsset: { updateMany },
    };
    const $transaction = vi.fn(async (operation) => {
      events.push("transaction");
      return operation(transaction);
    });
    getPrismaClient.mockReturnValue({ $transaction, memoryAsset: { findFirst: initialBinding, updateMany } });

    await expect(softDeleteAsset({
      userId: "user-1",
      galaxyId: "galaxy-1",
      assetId: "asset-1",
      version: 1,
    })).rejects.toMatchObject({ code: "ASSET_IN_USE", status: 409 });

    expect($transaction).toHaveBeenCalledTimes(1);
    const lockQuery = $queryRaw.mock.calls[0]?.[0] as { strings: string[]; values: unknown[] };
    expect(lockQuery.strings.join("?")).toContain('FROM "MemoryAsset"');
    expect(lockQuery.strings.join("?")).toContain('"deletedAt" IS NULL');
    expect(lockQuery.strings.join("?")).toContain("FOR UPDATE");
    expect(lockQuery.values).toEqual(["user-1", "galaxy-1", "asset-1", 1]);
    expect(findFirst).toHaveBeenCalledWith({
      where: { userId: "user-1", galaxyId: "galaxy-1", coverAssetId: "asset-1" },
      select: { id: true },
    });
    expect(events).toEqual(["initial-binding", "transaction", "asset-lock", "cover-check"]);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("rejects deletion of an asset bound to a processing Memory after it locks the asset", async () => {
    const initialBinding = vi.fn().mockResolvedValue({ memoryId: "memory-1" });
    const $queryRaw = vi.fn().mockImplementation(async (query: { strings: string[] }) => (
      query.strings.join("?").includes('FROM "Memory"')
        ? [{ id: "memory-1", status: "processing" }]
        : [{ id: "asset-1", memoryId: "memory-1" }]
    ));
    const findCoverReference = vi.fn().mockResolvedValue(null);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = {
      $queryRaw,
      planet: { findFirst: findCoverReference },
      memoryAsset: { updateMany },
    };
    const $transaction = vi.fn(async (operation) => operation(transaction));
    getPrismaClient.mockReturnValue({ $transaction, memoryAsset: { findFirst: initialBinding, updateMany } });

    await expect(softDeleteAsset({
      userId: "user-1",
      galaxyId: "galaxy-1",
      assetId: "asset-1",
      version: 1,
    })).rejects.toMatchObject({ code: "ASSET_IN_USE", status: 409 });

    expect(initialBinding).toHaveBeenCalledTimes(1);
    expect($queryRaw).toHaveBeenCalledTimes(2);
    expect(findCoverReference).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("locks a bound Memory before its asset and keeps both locks through a soft delete", async () => {
    const events: string[] = [];
    const initialBinding = vi.fn().mockImplementation(async () => {
      events.push("initial-binding");
      return { memoryId: "memory-1" };
    });
    const $queryRaw = vi.fn().mockImplementation(async (query: { strings: string[] }) => {
      const sql = query.strings.join("?");

      if (sql.includes('FROM "Memory"')) {
        events.push("memory-lock");
        return [{ id: "memory-1", status: "draft" }];
      }

      events.push("asset-lock");
      return [{ id: "asset-1", memoryId: "memory-1" }];
    });
    const findCoverReference = vi.fn().mockImplementation(async () => {
      events.push("cover-check");
      return null;
    });
    const updateMany = vi.fn().mockImplementation(async () => {
      events.push("asset-update");
      return { count: 1 };
    });
    const transaction = {
      $queryRaw,
      memory: { findFirst: vi.fn().mockResolvedValue(null) },
      planet: { findFirst: findCoverReference },
      memoryAsset: { updateMany },
    };
    const $transaction = vi.fn(async (operation) => {
      events.push("transaction");
      return operation(transaction);
    });
    getPrismaClient.mockReturnValue({
      $transaction,
      memoryAsset: { findFirst: initialBinding, updateMany },
    });

    await softDeleteAsset({ userId: "user-1", galaxyId: "galaxy-1", assetId: "asset-1", version: 1 });

    expect(events).toEqual([
      "initial-binding",
      "transaction",
      "memory-lock",
      "asset-lock",
      "cover-check",
      "asset-update",
    ]);
    const memoryLockQuery = $queryRaw.mock.calls[0]?.[0] as { strings: string[]; values: unknown[] };
    expect(memoryLockQuery.strings.join("?")).toContain('FROM "Memory"');
    expect(memoryLockQuery.strings.join("?")).toContain("FOR UPDATE");
    expect(memoryLockQuery.values).toEqual(["user-1", "galaxy-1", "memory-1"]);
  });

  it("treats an asset that becomes bound after an unbound initial read as a retryable conflict", async () => {
    const initialBinding = vi.fn().mockResolvedValue({ memoryId: null });
    const $queryRaw = vi.fn().mockResolvedValue([{ id: "asset-1", memoryId: "memory-1" }]);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = {
      $queryRaw,
      memory: { findFirst: vi.fn().mockResolvedValue(null) },
      planet: { findFirst: vi.fn() },
      memoryAsset: { updateMany },
    };
    const $transaction = vi.fn(async (operation) => operation(transaction));
    getPrismaClient.mockReturnValue({
      $transaction,
      memoryAsset: { findFirst: initialBinding, updateMany },
    });

    await expect(softDeleteAsset({
      userId: "user-1",
      galaxyId: "galaxy-1",
      assetId: "asset-1",
      version: 1,
    })).rejects.toMatchObject({ code: "VERSION_CONFLICT", status: 409 });

    expect(initialBinding).toHaveBeenCalledWith({
      where: {
        id: "asset-1",
        userId: "user-1",
        galaxyId: "galaxy-1",
        version: 1,
        deletedAt: null,
      },
      select: { memoryId: true },
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("uses updateMany only after a transactional asset lock and fresh no-cover check", async () => {
    const events: string[] = [];
    const initialBinding = vi.fn().mockImplementation(async () => {
      events.push("initial-binding");
      return { memoryId: null };
    });
    const updateMany = vi.fn().mockImplementation(async () => {
      events.push("asset-update");
      return { count: 1 };
    });
    const $queryRaw = vi.fn().mockImplementation(async () => {
      events.push("asset-lock");
      return [{ id: "asset-1", memoryId: null }];
    });
    const findFirst = vi.fn().mockImplementation(async () => {
      events.push("cover-check");
      return null;
    });
    const transaction = {
      $queryRaw,
      planet: { findFirst },
      memoryAsset: { updateMany },
    };
    const $transaction = vi.fn(async (operation) => {
      events.push("transaction");
      return operation(transaction);
    });
    getPrismaClient.mockReturnValue({ $transaction, memoryAsset: { findFirst: initialBinding, updateMany } });
    const now = new Date("2026-07-16T00:00:00.000Z");

    await softDeleteAsset({ userId: "user-1", galaxyId: "galaxy-1", assetId: "asset-1", version: 1, now });

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["initial-binding", "transaction", "asset-lock", "cover-check", "asset-update"]);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "asset-1",
        userId: "user-1",
        galaxyId: "galaxy-1",
        memoryId: null,
        deletedAt: null,
        version: 1,
      },
      data: {
        deletedAt: now,
        purgeAfter: new Date("2026-08-15T00:00:00.000Z"),
        version: { increment: 1 },
      },
    });
  });
});
