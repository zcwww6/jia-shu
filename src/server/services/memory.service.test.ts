import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/server/domain-error";

const { getPrismaClient } = vi.hoisted(() => ({ getPrismaClient: vi.fn() }));
const { findActivePlanet, lockActivePlanetForMemory } = vi.hoisted(() => ({
  findActivePlanet: vi.fn(),
  lockActivePlanetForMemory: vi.fn(),
}));
const {
  createMemoryWithTextAsset,
  createMemoryWithAssets,
  lockAssetsForMemory,
  confirmMemory,
  findActiveMemory,
  findMemoryReview,
  updateMemoryDraft,
} = vi.hoisted(() => ({
  createMemoryWithTextAsset: vi.fn(),
  createMemoryWithAssets: vi.fn(),
  lockAssetsForMemory: vi.fn(),
  confirmMemory: vi.fn(),
  findActiveMemory: vi.fn(),
  findMemoryReview: vi.fn(),
  updateMemoryDraft: vi.fn(),
}));
const { executeIdempotentDbOperation } = vi.hoisted(() => ({ executeIdempotentDbOperation: vi.fn() }));

vi.mock("@/server/db/client", () => ({ getPrismaClient }));
vi.mock("@/server/db/planet-repo", () => ({ findActivePlanet, lockActivePlanetForMemory }));
vi.mock("@/server/db/memory-repo", () => ({
  createMemoryWithTextAsset,
  createMemoryWithAssets,
  lockAssetsForMemory,
  confirmMemory,
  findActiveMemory,
  findMemoryReview,
  updateMemoryDraft,
}));
vi.mock("@/server/db/idempotency-repo", () => ({ prismaIdempotencyRepository: {} }));
vi.mock("@/server/services/idempotency.service", () => ({ executeIdempotentDbOperation }));

import {
  confirmTextMemory,
  createAssetBackedMemory,
  createTextMemory,
  getMemoryReview,
  updateTextMemoryDraft,
} from "./memory.service";

const scope = { userId: "user-1", galaxyId: "galaxy-1" };
const planetId = "ck8m3x8xy000000000000000";

function memory(overrides: Record<string, unknown> = {}) {
  return {
    id: "ck8m3x8xy000000000000001",
    userId: scope.userId,
    galaxyId: scope.galaxyId,
    planetId,
    sourceText: "第一次搬进新家的晚上。",
    title: "新家的晚上",
    summary: null,
    tags: null,
    uncertainFields: null,
    occurredAtLabel: "2018 年夏天",
    occurredAt: null,
    locationLabel: null,
    people: null,
    visibility: "family",
    allowResonance: false,
    allowBook: false,
    status: "draft",
    confirmedAt: null,
    version: 1,
    embedding: null,
    embeddingModel: null,
    deletedAt: null,
    purgeAfter: null,
    createdAt: new Date("2026-07-17T00:00:00.000Z"),
    updatedAt: new Date("2026-07-17T00:00:00.000Z"),
    ...overrides,
  };
}

describe("memory service", () => {
  beforeEach(() => {
    getPrismaClient.mockReset();
    findActivePlanet.mockReset();
    lockActivePlanetForMemory.mockReset();
    createMemoryWithTextAsset.mockReset();
    createMemoryWithAssets.mockReset();
    lockAssetsForMemory.mockReset();
    confirmMemory.mockReset();
    findActiveMemory.mockReset();
    findMemoryReview.mockReset();
    updateMemoryDraft.mockReset();
    executeIdempotentDbOperation.mockReset();
  });

  it("returns AI emotion labels as editable tags in the safe review DTO", async () => {
    findMemoryReview.mockResolvedValue({
      ...memory({ tags: ["安心", "团圆"], uncertainFields: ["occurredAtLabel"] }),
      assets: [{ id: "asset-1", kind: "text", originalName: "memory.txt", mimeType: "text/plain", sizeBytes: 10 }],
    });

    await expect(getMemoryReview(scope, "ck8m3x8xy000000000000001")).resolves.toMatchObject({
      tags: ["安心", "团圆"],
    });
  });

  it("creates a safe draft text memory only after its active owner planet is checked inside the idempotent transaction", async () => {
    const transaction = {};
    const callOrder: string[] = [];
    getPrismaClient.mockReturnValue({ $transaction: vi.fn() });
    findActivePlanet.mockResolvedValue({ id: planetId, archivedAt: null });
    lockActivePlanetForMemory.mockImplementation(async (_input, client) => {
      expect(client).toBe(transaction);
      callOrder.push("lock");
      return [{ id: planetId }];
    });
    createMemoryWithTextAsset.mockImplementation(async (_input, client) => {
      expect(client).toBe(transaction);
      callOrder.push("create");
      return memory();
    });
    executeIdempotentDbOperation.mockImplementation(async (_database, _repository, _input, operation) => {
      const completion = await operation(transaction, "operation-1");
      return {
        kind: "completed",
        operationId: "operation-1",
        response: completion.response,
        status: completion.responseStatus,
      };
    });

    const result = await createTextMemory(scope, {
      planetId,
      sourceText: "第一次搬进新家的晚上。",
      title: "新家的晚上",
      visibility: "family",
      idempotencyKey: "memory-create-key-00001",
      occurredAtLabel: "2018 年夏天",
    });

    expect(lockActivePlanetForMemory).toHaveBeenCalledWith({ ...scope, planetId }, transaction);
    expect(findActivePlanet).not.toHaveBeenCalled();
    expect(callOrder).toEqual(["lock", "create"]);
    expect(createMemoryWithTextAsset).toHaveBeenCalledWith(expect.objectContaining({
      ...scope,
      planetId,
      sourceText: "第一次搬进新家的晚上。",
      title: "新家的晚上",
      visibility: "family",
      allowResonance: false,
      allowBook: false,
      occurredAtLabel: "2018 年夏天",
      textAsset: expect.objectContaining({
        storageKey: expect.stringMatching(/^internal\/memory-text-meta\//),
        mimeType: "text/plain; charset=utf-8",
        originalName: "memory.txt",
      }),
    }), transaction);
    expect(result).toMatchObject({
      kind: "completed",
      status: 201,
      response: {
        id: "ck8m3x8xy000000000000001",
        status: "draft",
        confirmedAt: null,
        sourceText: "第一次搬进新家的晚上。",
      },
    });

    if (result.kind !== "completed") throw new Error("expected a completed idempotent result");
    expect(result.response).not.toHaveProperty("storageKey");
    expect(result.response).not.toHaveProperty("sha256");
    expect(result.response).not.toHaveProperty("internalPath");
  });

  it("locks asset-backed memory assets before its planet and binding in one transaction", async () => {
    const transaction = {};
    const callOrder: string[] = [];
    const lockedAssets = [{ id: "asset-image", kind: "image", visibility: "private" }];
    getPrismaClient.mockReturnValue({ $transaction: vi.fn() });
    lockAssetsForMemory.mockImplementation(async (_input, client) => {
      expect(client).toBe(transaction);
      callOrder.push("asset");
      return lockedAssets;
    });
    lockActivePlanetForMemory.mockImplementation(async (_input, client) => {
      expect(client).toBe(transaction);
      callOrder.push("planet");
      return [{ id: planetId }];
    });
    createMemoryWithAssets.mockImplementation(async (_input, client) => {
      expect(client).toBe(transaction);
      callOrder.push("create");
      return memory();
    });
    executeIdempotentDbOperation.mockImplementation(async (_database, _repository, _input, operation) => {
      const completion = await operation(transaction, "operation-1");
      return {
        kind: "completed",
        operationId: "operation-1",
        response: completion.response,
        status: completion.responseStatus,
      };
    });

    await expect(createAssetBackedMemory(scope, {
      planetId,
      assetIds: ["asset-image"],
      sourceText: "照片旁的家庭说明。",
      visibility: "private",
      idempotencyKey: "memory-asset-lock-order-001",
    })).resolves.toMatchObject({ kind: "completed", status: 201 });

    expect(lockAssetsForMemory).toHaveBeenCalledWith(expect.objectContaining({
      ...scope,
      planetId,
      assetIds: ["asset-image"],
      visibility: "private",
    }), transaction);
    expect(lockActivePlanetForMemory).toHaveBeenCalledWith({ ...scope, planetId }, transaction);
    expect(callOrder).toEqual(["asset", "planet", "create"]);
    expect(createMemoryWithAssets).toHaveBeenCalledWith(expect.anything(), transaction, lockedAssets);
  });

  const fixtureFor = (kind: "text" | "image" | "audio" | "document") => ({
    planetId,
    visibility: "private" as const,
    sourceText: kind === "text" ? "妈妈在除夕包饺子。" : "这是当时的一点补充。",
    assetIds: kind === "text" ? [] : [`asset-${kind}`],
    idempotencyKey: `memory-${kind}-create-key-001`,
  });

  it.each(["text", "image", "audio", "document"] as const)(
    "creates a %s memory as a draft before any AI job is consented",
    async (kind) => {
      const transaction = {};
      const fixture = fixtureFor(kind);
      const created = memory({
        sourceText: fixture.sourceText,
        visibility: fixture.visibility,
        status: "draft",
        confirmedAt: null,
      });

      getPrismaClient.mockReturnValue({ $transaction: vi.fn() });
      lockActivePlanetForMemory.mockResolvedValue([{ id: planetId }]);
      const lockedAssets = [{ id: `asset-${kind}` }];
      lockAssetsForMemory.mockResolvedValue(lockedAssets);
      createMemoryWithTextAsset.mockResolvedValue(created);
      createMemoryWithAssets.mockResolvedValue(created);
      executeIdempotentDbOperation.mockImplementation(async (_database, _repository, _input, operation) => {
        const completion = await operation(transaction, "operation-1");
        return {
          kind: "completed",
          operationId: "operation-1",
          response: completion.response,
          status: completion.responseStatus,
        };
      });

      const result = await createAssetBackedMemory(scope, fixture);

      expect(result).toMatchObject({
        kind: "completed",
        status: 201,
        response: {
          status: "draft",
          confirmedAt: null,
        },
      });
      expect(lockActivePlanetForMemory).toHaveBeenCalledWith({ ...scope, planetId }, transaction);

      if (kind === "text") {
        expect(lockAssetsForMemory).not.toHaveBeenCalled();
        expect(createMemoryWithTextAsset).toHaveBeenCalledWith(expect.objectContaining({
          ...scope,
          planetId,
          sourceText: fixture.sourceText,
          visibility: "private",
        }), transaction);
        expect(createMemoryWithAssets).not.toHaveBeenCalled();
      } else {
        expect(lockAssetsForMemory).toHaveBeenCalledWith(expect.objectContaining({
          ...scope,
          planetId,
          assetIds: [`asset-${kind}`],
        }), transaction);
        expect(createMemoryWithAssets).toHaveBeenCalledWith(expect.objectContaining({
          ...scope,
          planetId,
          sourceText: fixture.sourceText,
          assetIds: [`asset-${kind}`],
          visibility: "private",
        }), transaction, lockedAssets);
      }
    },
  );

  it("replays the original draft when omitted and explicit-false boolean defaults share an idempotency key", async () => {
    const transaction = {};
    const replayByKey = new Map<string, { requestHash: string; result: unknown }>();
    getPrismaClient.mockReturnValue({ $transaction: vi.fn() });
    findActivePlanet.mockResolvedValue({ id: planetId, archivedAt: null });
    lockActivePlanetForMemory.mockResolvedValue([{ id: planetId }]);
    createMemoryWithTextAsset.mockResolvedValue(memory());
    executeIdempotentDbOperation.mockImplementation(async (_database, _repository, input, operation) => {
      const existing = replayByKey.get(input.key);

      if (existing) {
        expect(input.requestHash).toBe(existing.requestHash);
        return existing.result;
      }

      const completion = await operation(transaction, "operation-1");
      const result = {
        kind: "completed",
        operationId: "operation-1",
        response: completion.response,
        status: completion.responseStatus,
      };
      replayByKey.set(input.key, { requestHash: input.requestHash, result });
      return result;
    });

    const first = await createTextMemory(scope, {
      planetId,
      sourceText: "第一次搬进新家的晚上。",
      title: "新家的晚上",
      visibility: "family",
      occurredAtLabel: "2018 年夏天",
      idempotencyKey: "memory-replay-key-00001",
    });
    const replay = await createTextMemory(scope, {
      visibility: "family",
      occurredAtLabel: "2018 年夏天",
      title: "新家的晚上",
      sourceText: "第一次搬进新家的晚上。",
      planetId,
      allowResonance: false,
      allowBook: false,
      idempotencyKey: "memory-replay-key-00001",
    });

    expect(replay).toEqual(first);
    expect(createMemoryWithTextAsset).toHaveBeenCalledTimes(1);
    expect(lockActivePlanetForMemory).toHaveBeenCalledTimes(1);
    expect(findActivePlanet).not.toHaveBeenCalled();
  });

  it("rejects a planet outside the caller's active personal galaxy when its transaction lock finds no active row", async () => {
    const transaction = {};
    getPrismaClient.mockReturnValue({ $transaction: vi.fn() });
    findActivePlanet.mockResolvedValue({ id: planetId, archivedAt: null });
    lockActivePlanetForMemory.mockResolvedValue([]);
    executeIdempotentDbOperation.mockImplementation(async (_database, _repository, _input, operation) => {
      return operation(transaction, "operation-1");
    });

    await expect(createTextMemory(scope, {
      planetId,
      sourceText: "不应写入其他星系。",
      visibility: "private",
      idempotencyKey: "memory-cross-planet-key1",
    })).rejects.toMatchObject({ code: "PLANET_NOT_FOUND", status: 404 });
    expect(createMemoryWithTextAsset).not.toHaveBeenCalled();
  });

  it("confirms only an owner-scoped needs-confirmation memory with an optimistic version", async () => {
    const confirmedAt = new Date("2026-07-17T00:00:00.000Z");
    findActiveMemory.mockResolvedValue(memory({
      status: "needs_confirmation",
      version: 2,
      title: null,
      occurredAtLabel: null,
    }));
    confirmMemory.mockResolvedValue(undefined);

    const result = await confirmTextMemory(scope, "ck8m3x8xy000000000000001", {
      version: 2,
      title: "新家的晚上",
      summary: "全家第一次在新家吃晚饭。",
      tags: ["新家", "晚饭"],
      occurredAtLabel: "2018 年夏天",
      locationLabel: "老家厨房",
      people: ["妈妈", "我"],
    }, confirmedAt);

    expect(confirmMemory).toHaveBeenCalledWith({
      ...scope,
      memoryId: "ck8m3x8xy000000000000001",
      version: 2,
      patch: {
        title: "新家的晚上",
        summary: "全家第一次在新家吃晚饭。",
        tags: ["新家", "晚饭"],
        occurredAtLabel: "2018 年夏天",
        locationLabel: "老家厨房",
        people: ["妈妈", "我"],
      },
      confirmedAt,
    });
    expect(result).toMatchObject({
      id: "ck8m3x8xy000000000000001",
      status: "confirmed",
      confirmedAt: "2026-07-17T00:00:00.000Z",
      version: 3,
      tags: ["新家", "晚饭"],
      locationLabel: "老家厨房",
      people: ["妈妈", "我"],
    });
  });

  it.each(["draft", "processing", "confirmed"] as const)("does not allow a %s memory to be auto-confirmed", async (status) => {
    findActiveMemory.mockResolvedValue(memory({ status }));

    await expect(confirmTextMemory(scope, "ck8m3x8xy000000000000001", { version: 1 }))
      .rejects.toMatchObject({ code: "MEMORY_CONFIRMATION_NOT_READY", status: 409 });
    expect(confirmMemory).not.toHaveBeenCalled();
  });

  it("returns the same not-found error for another owner's memory and a soft-deleted memory", async () => {
    findActiveMemory.mockResolvedValue(null);

    await expect(confirmTextMemory(scope, "foreign-memory", { version: 1 }))
      .rejects.toMatchObject({ code: "MEMORY_NOT_FOUND", status: 404 });

    findActiveMemory.mockResolvedValue(null);
    await expect(confirmTextMemory(scope, "soft-deleted-memory", { version: 1 }))
      .rejects.toMatchObject({ code: "MEMORY_NOT_FOUND", status: 404 });
    expect(confirmMemory).not.toHaveBeenCalled();
  });

  it("preserves the repository version conflict instead of confirming a stale review", async () => {
    findActiveMemory.mockResolvedValue(memory({ status: "needs_confirmation", version: 3 }));
    confirmMemory.mockRejectedValue(new DomainError("VERSION_CONFLICT", 409, "这条记忆已在另一处更新，请刷新后重试。"));

    await expect(confirmTextMemory(scope, "ck8m3x8xy000000000000001", { version: 2 }))
      .rejects.toMatchObject({ code: "VERSION_CONFLICT", status: 409 });
  });

  it("updates only an owner-scoped draft and returns its incremented version", async () => {
    findActiveMemory.mockResolvedValue(memory({ version: 2 }));
    updateMemoryDraft.mockResolvedValue(undefined);

    const result = await updateTextMemoryDraft(scope, "ck8m3x8xy000000000000001", {
      version: 2,
      sourceText: "第一次搬进新家的那个晚上。",
      title: "新家的第一晚",
    });

    expect(updateMemoryDraft).toHaveBeenCalledWith({
      ...scope,
      memoryId: "ck8m3x8xy000000000000001",
      version: 2,
      patch: {
        sourceText: "第一次搬进新家的那个晚上。",
        title: "新家的第一晚",
      },
    });
    expect(result).toMatchObject({
      sourceText: "第一次搬进新家的那个晚上。",
      title: "新家的第一晚",
      status: "draft",
      version: 3,
    });
  });

  it("allows a draft author to clear an unconfirmed occurred label", async () => {
    findActiveMemory.mockResolvedValue(memory({ version: 2, occurredAtLabel: "2018 年夏天" }));
    updateMemoryDraft.mockResolvedValue(undefined);

    const result = await updateTextMemoryDraft(scope, "ck8m3x8xy000000000000001", {
      version: 2,
      occurredAtLabel: null,
    });

    expect(updateMemoryDraft).toHaveBeenCalledWith(expect.objectContaining({
      patch: { occurredAtLabel: null },
    }));
    expect(result).toMatchObject({ occurredAtLabel: null, version: 3 });
  });

  it("returns administrator-edited location and people on a draft update", async () => {
    findActiveMemory.mockResolvedValue(memory({
      version: 2,
      locationLabel: null,
      people: null,
    }));
    updateMemoryDraft.mockResolvedValue(undefined);

    const result = await updateTextMemoryDraft(scope, "ck8m3x8xy000000000000001", {
      version: 2,
      locationLabel: "老家厨房",
      people: ["妈妈", "外婆"],
    });

    expect(updateMemoryDraft).toHaveBeenCalledWith(expect.objectContaining({
      patch: { locationLabel: "老家厨房", people: ["妈妈", "外婆"] },
    }));
    expect(result).toMatchObject({
      locationLabel: "老家厨房",
      people: ["妈妈", "外婆"],
      version: 3,
    });
  });

  it.each(["processing", "needs_confirmation", "confirmed"] as const)(
    "does not let a %s memory masquerade as a draft patch",
    async (status) => {
      findActiveMemory.mockResolvedValue(memory({ status }));

      await expect(updateTextMemoryDraft(scope, "ck8m3x8xy000000000000001", {
        version: 1,
        title: "不应写入",
      })).rejects.toMatchObject({ code: "MEMORY_DRAFT_NOT_EDITABLE", status: 409 });
      expect(updateMemoryDraft).not.toHaveBeenCalled();
    },
  );
});
