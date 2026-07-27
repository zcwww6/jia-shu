import { beforeEach, describe, expect, it, vi } from "vitest";

const { getPrismaClient } = vi.hoisted(() => ({
  getPrismaClient: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  getPrismaClient,
}));

import {
  confirmMemory,
  createMemoryWithAssets,
  createMemoryWithTextAsset,
  findActiveMemory,
  handoffActiveDraftMemoryToAiProcessing,
  lockActiveDraftMemoryForAiJob,
  softDeleteMemory,
  updateMemoryDraft,
} from "./memory-repo";

describe("memory repo", () => {
  beforeEach(() => {
    getPrismaClient.mockReset();
  });

  it("reads an active memory only inside the caller's galaxy scope", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "memory-1" });
    getPrismaClient.mockReturnValue({ memory: { findFirst } });

    await findActiveMemory({ userId: "user-1", galaxyId: "galaxy-1", memoryId: "memory-1" });

    expect(findFirst).toHaveBeenCalledWith({
      where: { id: "memory-1", userId: "user-1", galaxyId: "galaxy-1", deletedAt: null },
    });
  });

  it("locks exactly one owner-scoped active draft memory before capturing AI consent", async () => {
    const $queryRaw = vi.fn().mockResolvedValue([{ id: "memory-1", version: 4 }]);
    getPrismaClient.mockReturnValue({ $queryRaw });

    await lockActiveDraftMemoryForAiJob({
      userId: "user-1",
      galaxyId: "galaxy-1",
      memoryId: "memory-1",
    });

    expect($queryRaw).toHaveBeenCalledTimes(1);
    const query = $queryRaw.mock.calls[0]?.[0] as { strings: readonly string[]; values: unknown[] };
    expect(query.strings.join(" ")).toContain('FROM "Memory"');
    expect(query.strings.join(" ")).toContain('"visibility"');
    expect(query.strings.join(" ")).toContain('AND "status" =');
    expect(query.strings.join(" ")).toContain("FOR UPDATE");
    expect(query.values).toEqual(["user-1", "galaxy-1", "memory-1", "draft"]);
  });

  it("creates a draft memory and its text metadata asset through the same transaction client", async () => {
    const createMemory = vi.fn().mockResolvedValue({ id: "memory-1" });
    const createAsset = vi.fn().mockResolvedValue({ id: "asset-1" });
    const transaction = { memory: { create: createMemory }, memoryAsset: { create: createAsset } };

    await createMemoryWithTextAsset({
      userId: "user-1",
      galaxyId: "galaxy-1",
      planetId: "planet-1",
      sourceText: "第一次搬进新家的晚上。",
      title: "新家的晚上",
      visibility: "family",
      allowResonance: false,
      allowBook: false,
      occurredAtLabel: "2018 年夏天",
      textAsset: {
        storageKey: "internal/memory-text-meta/7a58f2ea-1fdb-4e57-806c-c7783bf148ab",
        mimeType: "text/plain; charset=utf-8",
        sizeBytes: 31,
        sha256: "a".repeat(64),
        originalName: "memory.txt",
      },
    }, transaction as never);

    expect(createMemory).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        galaxyId: "galaxy-1",
        planetId: "planet-1",
        sourceText: "第一次搬进新家的晚上。",
        title: "新家的晚上",
        visibility: "family",
        allowResonance: false,
        allowBook: false,
        occurredAtLabel: "2018 年夏天",
        status: "draft",
        confirmedAt: null,
      },
    });
    expect(createAsset).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        galaxyId: "galaxy-1",
        planetId: "planet-1",
        memoryId: "memory-1",
        kind: "text",
        visibility: "family",
        storageKey: "internal/memory-text-meta/7a58f2ea-1fdb-4e57-806c-c7783bf148ab",
        mimeType: "text/plain; charset=utf-8",
        sizeBytes: 31,
        sha256: "a".repeat(64),
        originalName: "memory.txt",
        status: "stored",
      },
    });
  });

  it("creates a draft and atomically binds only locked scoped readable assets", async () => {
    const createMemory = vi.fn().mockResolvedValue({ id: "memory-1" });
    const $queryRaw = vi.fn().mockResolvedValue([{ id: "asset-image", kind: "image", visibility: "private" }]);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = {
      memory: { create: createMemory },
      memoryAsset: { updateMany },
      $queryRaw,
    };

    await createMemoryWithAssets({
      userId: "user-1",
      galaxyId: "galaxy-1",
      planetId: "planet-1",
      sourceText: "这是照片的补充说明。",
      assetIds: ["asset-image"],
      visibility: "private",
      allowResonance: false,
      allowBook: false,
    }, transaction as never);

    expect(createMemory).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        galaxyId: "galaxy-1",
        planetId: "planet-1",
        sourceText: "这是照片的补充说明。",
        title: undefined,
        visibility: "private",
        allowResonance: false,
        allowBook: false,
        occurredAtLabel: undefined,
        status: "draft",
        confirmedAt: null,
      },
    });
    const query = $queryRaw.mock.calls[0]?.[0] as { strings: readonly string[]; values: unknown[] };
    expect(query.strings.join(" ")).toContain('FROM "MemoryAsset"');
    expect(query.strings.join(" ")).toContain('"userId" =');
    expect(query.strings.join(" ")).toContain('"galaxyId" =');
    expect(query.strings.join(" ")).toContain('"planetId" =');
    expect(query.strings.join(" ")).toContain('"memoryId" IS NULL');
    expect(query.strings.join(" ")).toContain('"deletedAt" IS NULL');
    expect(query.strings.join(" ")).toContain("FOR UPDATE");
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["asset-image"] },
        userId: "user-1",
        galaxyId: "galaxy-1",
        planetId: "planet-1",
        memoryId: null,
        deletedAt: null,
        status: { in: ["stored", "ready"] },
      },
      data: { memoryId: "memory-1" },
    });
  });

  it("locks reversed asset IDs in stable ascending database order before binding them", async () => {
    const createMemory = vi.fn().mockResolvedValue({ id: "memory-1" });
    const $queryRaw = vi.fn().mockResolvedValue([
      { id: "asset-a", kind: "image", visibility: "private" },
      { id: "asset-z", kind: "image", visibility: "private" },
    ]);
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const transaction = {
      memory: { create: createMemory },
      memoryAsset: { updateMany },
      $queryRaw,
    };

    await createMemoryWithAssets({
      userId: "user-1",
      galaxyId: "galaxy-1",
      planetId: "planet-1",
      sourceText: "两张照片的补充说明。",
      assetIds: ["asset-z", "asset-a"],
      visibility: "private",
      allowResonance: false,
      allowBook: false,
    }, transaction as never);

    const query = $queryRaw.mock.calls[0]?.[0] as { strings: readonly string[] };
    expect(query.strings.join(" ")).toContain('ORDER BY "id" ASC');
    expect(query.strings.join(" ")).toContain("FOR UPDATE");
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: ["asset-z", "asset-a"] } }),
    }));
  });

  it("rejects a mixed or inaccessible asset source before it can be attached to a memory", async () => {
    const createMemory = vi.fn().mockResolvedValue({ id: "memory-1" });
    const $queryRaw = vi.fn().mockResolvedValue([
      { id: "asset-image", kind: "image", visibility: "private" },
      { id: "asset-audio", kind: "audio", visibility: "private" },
    ]);
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const transaction = {
      memory: { create: createMemory },
      memoryAsset: { updateMany },
      $queryRaw,
    };

    await expect(createMemoryWithAssets({
      userId: "user-1",
      galaxyId: "galaxy-1",
      planetId: "planet-1",
      sourceText: "",
      assetIds: ["asset-image", "asset-audio"],
      visibility: "private",
      allowResonance: false,
      allowBook: false,
    }, transaction as never)).rejects.toMatchObject({
      code: "MEMORY_ASSET_SOURCE_INVALID",
      status: 422,
    });

    expect(updateMany).not.toHaveBeenCalled();
  });

  it("updates a draft through a scoped optimistic version guard", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    getPrismaClient.mockReturnValue({ memory: { updateMany } });

    await updateMemoryDraft({
      userId: "user-1",
      galaxyId: "galaxy-1",
      memoryId: "memory-1",
      version: 2,
      patch: { title: "更新后的标题" },
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "memory-1",
        userId: "user-1",
        galaxyId: "galaxy-1",
        deletedAt: null,
        status: "draft",
        version: 2,
      },
      data: { title: "更新后的标题", version: { increment: 1 } },
    });
  });

  it.each(["text", "image", "audio", "document"] as const)(
    "atomically synchronizes %s assets when a draft visibility patch succeeds",
    async () => {
      const updateMemory = vi.fn().mockResolvedValue({ count: 1 });
      const updateAssets = vi.fn().mockResolvedValue({ count: 1 });
      const transaction = {
        memory: { updateMany: updateMemory },
        memoryAsset: { updateMany: updateAssets },
      };
      const $transaction = vi.fn(async (operation) => operation(transaction));
      getPrismaClient.mockReturnValue({
        $transaction,
        memory: { updateMany: updateMemory },
        memoryAsset: { updateMany: updateAssets },
      });

      await updateMemoryDraft({
        userId: "user-1",
        galaxyId: "galaxy-1",
        memoryId: "memory-1",
        version: 2,
        patch: { visibility: "family" },
      });

      expect($transaction).toHaveBeenCalledTimes(1);
      expect(updateMemory).toHaveBeenCalledWith({
        where: {
          id: "memory-1",
          userId: "user-1",
          galaxyId: "galaxy-1",
          deletedAt: null,
          status: "draft",
          version: 2,
        },
        data: { visibility: "family", version: { increment: 1 } },
      });
      expect(updateAssets).toHaveBeenCalledWith({
        where: {
          userId: "user-1",
          galaxyId: "galaxy-1",
          memoryId: "memory-1",
          deletedAt: null,
        },
        data: { visibility: "family" },
      });
    },
  );

  it("rolls back a visibility patch when its bound-asset synchronization fails", async () => {
    const updateMemory = vi.fn().mockResolvedValue({ count: 1 });
    const syncFailure = new Error("asset visibility synchronization failed");
    const updateAssets = vi.fn().mockRejectedValue(syncFailure);
    const transaction = {
      memory: { updateMany: updateMemory },
      memoryAsset: { updateMany: updateAssets },
    };
    const $transaction = vi.fn(async (operation) => operation(transaction));
    getPrismaClient.mockReturnValue({
      $transaction,
      memory: { updateMany: updateMemory },
      memoryAsset: { updateMany: updateAssets },
    });

    await expect(updateMemoryDraft({
      userId: "user-1",
      galaxyId: "galaxy-1",
      memoryId: "memory-1",
      version: 2,
      patch: { visibility: "family" },
    })).rejects.toBe(syncFailure);

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(updateAssets).toHaveBeenCalledTimes(1);
  });

  it("raises VERSION_CONFLICT instead of overwriting a changed draft", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    getPrismaClient.mockReturnValue({ memory: { updateMany } });

    await expect(
      updateMemoryDraft({
        userId: "user-1",
        galaxyId: "galaxy-1",
        memoryId: "memory-1",
        version: 2,
        patch: { title: "更新后的标题" },
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT", status: 409 });
  });

  it("keeps a handed-off processing snapshot immutable without changing its consent version", async () => {
    const updateMany = vi.fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    getPrismaClient.mockReturnValue({ memory: { updateMany } });

    await expect(handoffActiveDraftMemoryToAiProcessing({
      userId: "user-1",
      galaxyId: "galaxy-1",
      memoryId: "memory-1",
      version: 4,
    })).resolves.toBe(true);

    await expect(updateMemoryDraft({
      userId: "user-1",
      galaxyId: "galaxy-1",
      memoryId: "memory-1",
      version: 4,
      patch: { sourceText: "PATCH 后的新内容。" },
    })).rejects.toMatchObject({ code: "VERSION_CONFLICT", status: 409 });

    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: "memory-1",
        userId: "user-1",
        galaxyId: "galaxy-1",
        deletedAt: null,
        status: "draft",
        version: 4,
      },
      data: { status: "processing" },
    });
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: "memory-1",
        userId: "user-1",
        galaxyId: "galaxy-1",
        deletedAt: null,
        status: "draft",
        version: 4,
      },
      data: { sourceText: "PATCH 后的新内容。", version: { increment: 1 } },
    });
  });

  it("confirms only a scoped needs-confirmation memory through the optimistic version guard", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    getPrismaClient.mockReturnValue({ memory: { updateMany } });
    const confirmedAt = new Date("2026-07-17T00:00:00.000Z");

    await confirmMemory({
      userId: "user-1",
      galaxyId: "galaxy-1",
      memoryId: "memory-1",
      version: 2,
      patch: {
        title: "新家的晚上",
        summary: "全家第一次在新家吃晚饭。",
        tags: ["新家", "晚饭"],
        occurredAtLabel: "2018 年夏天",
      },
      confirmedAt,
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "memory-1",
        userId: "user-1",
        galaxyId: "galaxy-1",
        deletedAt: null,
        status: "needs_confirmation",
        version: 2,
      },
      data: {
        title: "新家的晚上",
        summary: "全家第一次在新家吃晚饭。",
        tags: ["新家", "晚饭"],
        occurredAtLabel: "2018 年夏天",
        status: "confirmed",
        confirmedAt,
        version: { increment: 1 },
      },
    });
  });

  it("raises VERSION_CONFLICT when confirmation cannot update the exact scoped review version", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    getPrismaClient.mockReturnValue({ memory: { updateMany } });

    await expect(confirmMemory({
      userId: "user-1",
      galaxyId: "galaxy-1",
      memoryId: "memory-1",
      version: 2,
      patch: {},
      confirmedAt: new Date("2026-07-17T00:00:00.000Z"),
    })).rejects.toMatchObject({ code: "VERSION_CONFLICT", status: 409 });
  });

  it("moves an archivable memory into archived before its soft-delete retention window", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    getPrismaClient.mockReturnValue({ memory: { updateMany } });
    const now = new Date("2026-07-16T00:00:00.000Z");

    await softDeleteMemory({ userId: "user-1", galaxyId: "galaxy-1", memoryId: "memory-1", version: 2, now });

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "memory-1",
        userId: "user-1",
        galaxyId: "galaxy-1",
        deletedAt: null,
        status: { in: ["draft", "confirmed"] },
        version: 2,
      },
      data: {
        status: "archived",
        deletedAt: now,
        purgeAfter: new Date("2026-08-15T00:00:00.000Z"),
        version: { increment: 1 },
      },
    });
  });
});
