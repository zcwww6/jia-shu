import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/server/domain-error";
import {
  MEMORY_EXTRACTION_PURPOSE,
  memoryAiIdempotencyRequestHash,
  memoryAiSnapshotHash,
} from "@/server/ai/memory-ai-contract";

const { getPrismaClient } = vi.hoisted(() => ({ getPrismaClient: vi.fn() }));
const { findActiveMemory, lockActiveDraftMemoryForAiJob } = vi.hoisted(() => ({
  findActiveMemory: vi.fn(),
  lockActiveDraftMemoryForAiJob: vi.fn(),
}));
const { lockReadableMemoryAssetsForAiJob } = vi.hoisted(() => ({ lockReadableMemoryAssetsForAiJob: vi.fn() }));
const { createAiJob, findScopedAiJob, findActiveMemoryAiJobsForMemory, findActiveTextExtractionAiJobsForMemory } = vi.hoisted(() => ({
  createAiJob: vi.fn(),
  findScopedAiJob: vi.fn(),
  findActiveMemoryAiJobsForMemory: vi.fn(),
  findActiveTextExtractionAiJobsForMemory: vi.fn(),
}));
const { executeIdempotentDbOperation } = vi.hoisted(() => ({ executeIdempotentDbOperation: vi.fn() }));
const { assertMemoryAiCapabilitiesConfigured, assertTextAiConfigured } = vi.hoisted(() => ({
  assertMemoryAiCapabilitiesConfigured: vi.fn(),
  assertTextAiConfigured: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({ getPrismaClient }));
vi.mock("@/server/db/memory-repo", () => ({ findActiveMemory, lockActiveDraftMemoryForAiJob }));
vi.mock("@/server/db/asset-repo", () => ({ lockReadableMemoryAssetsForAiJob }));
vi.mock("@/server/db/ai-job-repo", () => ({
  createAiJob,
  findScopedAiJob,
  findActiveMemoryAiJobsForMemory,
  findActiveTextExtractionAiJobsForMemory,
}));
vi.mock("@/server/db/idempotency-repo", () => ({ prismaIdempotencyRepository: {} }));
vi.mock("@/server/services/idempotency.service", () => ({ executeIdempotentDbOperation }));
vi.mock("@/server/ai/openai-client", () => ({ assertMemoryAiCapabilitiesConfigured, assertTextAiConfigured }));

import { createMemoryAiJob, createTextExtractionAiJob, getAiJobForOwner } from "./ai-job.service";
import {
  TEXT_EXTRACTION_PURPOSE,
  textExtractionIdempotencyRequestHash,
} from "@/server/ai/text-extraction-request";

const scope = { userId: "user-1", galaxyId: "galaxy-1" };

describe("AI job service", () => {
  beforeEach(() => {
    getPrismaClient.mockReset();
    findActiveMemory.mockReset();
    lockActiveDraftMemoryForAiJob.mockReset();
    createAiJob.mockReset();
    findScopedAiJob.mockReset();
    findActiveMemoryAiJobsForMemory.mockReset();
    findActiveTextExtractionAiJobsForMemory.mockReset();
    lockReadableMemoryAssetsForAiJob.mockReset();
    findActiveMemoryAiJobsForMemory.mockResolvedValue([]);
    findActiveTextExtractionAiJobsForMemory.mockResolvedValue([]);
    lockReadableMemoryAssetsForAiJob.mockResolvedValue([]);
    executeIdempotentDbOperation.mockReset();
    assertMemoryAiCapabilitiesConfigured.mockReset();
    assertTextAiConfigured.mockReset();
  });

  it("requires fresh explicit consent before it starts any database work", async () => {
    await expect(createTextExtractionAiJob(scope, "memory-1", {
      consent: false,
      idempotencyKey: "ai-job-consent-key-0001",
    })).rejects.toMatchObject({ code: "AI_CONSENT_REQUIRED", status: 400 });

    expect(getPrismaClient).not.toHaveBeenCalled();
    expect(executeIdempotentDbOperation).not.toHaveBeenCalled();
    expect(findActiveMemory).not.toHaveBeenCalled();
    expect(createAiJob).not.toHaveBeenCalled();
  });

  const fixtureFor = (sourceKind: "text" | "image" | "audio" | "document") => ({
    sourceKind,
    sourceText: sourceKind === "text" ? "妈妈在除夕包饺子。" : "这是用户补充的上下文。",
    assets: sourceKind === "text" ? [] : [{
      id: `asset-${sourceKind}`,
      kind: sourceKind,
      sha256: `${sourceKind}-hash`,
      visibility: "private",
    }],
    jobKind: sourceKind === "text"
      ? "text_extraction"
      : sourceKind === "image"
        ? "image_extraction"
        : sourceKind === "audio"
          ? "audio_transcription"
          : "document_extraction",
  } as const);

  it.each(["text", "image", "audio", "document"] as const)(
    "creates a %s pipeline only after explicit consent and leaves its Memory draft queued for review",
    async (sourceKind) => {
      const fixture = fixtureFor(sourceKind);
      const transaction = {};
      const snapshot = {
        id: "memory-1",
        planetId: "planet-1",
        sourceText: fixture.sourceText,
        occurredAtLabel: "2018 年夏天",
        visibility: "private",
        status: "draft",
        version: 4,
      };
      getPrismaClient.mockReturnValue({ $transaction: vi.fn() });
      findActiveMemory.mockResolvedValue(snapshot);
      lockActiveDraftMemoryForAiJob.mockResolvedValue([snapshot]);
      lockReadableMemoryAssetsForAiJob.mockResolvedValue(fixture.assets);
      createAiJob.mockResolvedValue({
        id: `job-${sourceKind}`,
        kind: fixture.jobKind,
        status: "queued",
        attempts: 0,
        errorCode: null,
        completedAt: null,
      });
      executeIdempotentDbOperation.mockImplementation(async (_database, _repo, _input, operation) => {
        const completion = await operation(transaction, "operation-1");
        return {
          kind: "completed",
          operationId: "operation-1",
          response: completion.response,
          status: completion.responseStatus,
        };
      });

      const result = await createMemoryAiJob(scope, "memory-1", {
        consent: true,
        idempotencyKey: `ai-job-${sourceKind}-create-key`,
      });

      expect(result).toMatchObject({
        kind: "completed",
        status: 202,
        response: { kind: fixture.jobKind, status: "queued" },
      });
      expect(lockReadableMemoryAssetsForAiJob).toHaveBeenCalledWith({
        ...scope,
        planetId: "planet-1",
        memoryId: "memory-1",
      }, transaction);
      expect(assertMemoryAiCapabilitiesConfigured).toHaveBeenCalledWith({ sourceKind });
      expect(createAiJob).toHaveBeenCalledWith(expect.objectContaining({
        ...scope,
        planetId: "planet-1",
        memoryId: "memory-1",
        kind: fixture.jobKind,
        consentCapturedAt: expect.any(Date),
        requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }), transaction);
    },
  );

  it.each(["family", "selected"] as const)(
    "creates a consented %s derived job from a private raw image without widening the source",
    async (visibility) => {
      const transaction = {};
      const privateImage = {
        id: "asset-image",
        kind: "image" as const,
        sha256: "image-hash",
        visibility: "private" as const,
      };
      const snapshot = {
        id: "memory-1",
        planetId: "planet-1",
        sourceText: "照片旁的家庭说明。",
        occurredAtLabel: null,
        visibility,
        status: "draft",
        version: 5,
      };
      getPrismaClient.mockReturnValue({ $transaction: vi.fn() });
      findActiveMemory.mockResolvedValue(snapshot);
      lockActiveDraftMemoryForAiJob.mockResolvedValue([snapshot]);
      lockReadableMemoryAssetsForAiJob.mockResolvedValue([privateImage]);
      createAiJob.mockResolvedValue({
        id: `job-private-image-${visibility}`,
        kind: "image_extraction",
        status: "queued",
        attempts: 0,
        errorCode: null,
        completedAt: null,
      });
      executeIdempotentDbOperation.mockImplementation(async (_database, _repo, _input, operation) => {
        const completion = await operation(transaction, "operation-1");
        return { kind: "completed", operationId: "operation-1", response: completion.response, status: completion.responseStatus };
      });

      await expect(createMemoryAiJob(scope, "memory-1", {
        consent: true,
        idempotencyKey: `ai-job-private-image-${visibility}`,
      })).resolves.toMatchObject({ kind: "completed", status: 202 });

      expect(lockReadableMemoryAssetsForAiJob).toHaveBeenCalledWith({
        ...scope,
        planetId: "planet-1",
        memoryId: "memory-1",
      }, transaction);
      expect(createAiJob).toHaveBeenCalledWith(expect.objectContaining({
        kind: "image_extraction",
        requestHash: memoryAiSnapshotHash({
          memoryId: "memory-1",
          sourceText: snapshot.sourceText,
          version: 5,
          purpose: MEMORY_EXTRACTION_PURPOSE,
          assets: [privateImage],
        }),
      }), transaction);
      expect(privateImage.visibility).toBe("private");
    },
  );

  it("creates a new exported text job through the generic source snapshot", async () => {
    const transaction = {};
    const snapshot = {
      id: "memory-1",
      planetId: "planet-1",
      sourceText: "第一次搬进新家的晚上。",
      occurredAtLabel: null,
      visibility: "private",
      status: "draft",
      version: 4,
    };
    const textAsset = {
      id: "asset-text",
      kind: "text" as const,
      sha256: "text-hash",
      visibility: "private" as const,
    };
    getPrismaClient.mockReturnValue({ $transaction: vi.fn() });
    findActiveMemory.mockResolvedValue(snapshot);
    lockActiveDraftMemoryForAiJob.mockResolvedValue([snapshot]);
    lockReadableMemoryAssetsForAiJob.mockResolvedValue([textAsset]);
    findActiveMemoryAiJobsForMemory.mockResolvedValue([]);
    createAiJob.mockResolvedValue({
      id: "job-text",
      kind: "text_extraction",
      status: "queued",
      attempts: 0,
      errorCode: null,
      completedAt: null,
    });
    executeIdempotentDbOperation.mockImplementation(async (_database, _repo, _input, operation) => {
      const completion = await operation(transaction, "operation-1");
      return {
        kind: "completed",
        operationId: "operation-1",
        response: completion.response,
        status: completion.responseStatus,
      };
    });

    await createTextExtractionAiJob(scope, "memory-1", {
      consent: true,
      idempotencyKey: "ai-job-generic-text-key-01",
    });

    expect(lockReadableMemoryAssetsForAiJob).toHaveBeenCalledWith({
      ...scope,
      planetId: "planet-1",
      memoryId: "memory-1",
    }, transaction);
    expect(assertMemoryAiCapabilitiesConfigured).toHaveBeenCalledWith({ sourceKind: "text" });
    expect(createAiJob).toHaveBeenCalledWith(expect.objectContaining({
      kind: "text_extraction",
      requestHash: memoryAiSnapshotHash({
        memoryId: "memory-1",
        sourceText: snapshot.sourceText,
        version: 4,
        purpose: MEMORY_EXTRACTION_PURPOSE,
        assets: [textAsset],
      }),
    }), transaction);
  });

  it.each(["text", "image", "audio", "document"] as const)(
    "creates a new %s job after its Memory and bound assets share an updated visibility",
    async (sourceKind) => {
      const transaction = {};
      const asset = {
        id: `asset-${sourceKind}`,
        kind: sourceKind,
        sha256: `${sourceKind}-hash`,
        visibility: "family" as const,
      };
      const snapshot = {
        id: "memory-1",
        planetId: "planet-1",
        sourceText: sourceKind === "text" ? "妈妈在除夕包饺子。" : "照片旁的家庭说明。",
        occurredAtLabel: null,
        visibility: "family" as const,
        status: "draft",
        version: 5,
      };
      getPrismaClient.mockReturnValue({ $transaction: vi.fn() });
      findActiveMemory.mockResolvedValue(snapshot);
      lockActiveDraftMemoryForAiJob.mockResolvedValue([snapshot]);
      lockReadableMemoryAssetsForAiJob.mockResolvedValue([asset]);
      findActiveMemoryAiJobsForMemory.mockResolvedValue([]);
      createAiJob.mockResolvedValue({
        id: `job-${sourceKind}`,
        kind: sourceKind === "text" ? "text_extraction" : sourceKind === "image" ? "image_extraction" : sourceKind === "audio" ? "audio_transcription" : "document_extraction",
        status: "queued",
        attempts: 0,
        errorCode: null,
        completedAt: null,
      });
      executeIdempotentDbOperation.mockImplementation(async (_database, _repo, _input, operation) => {
        const completion = await operation(transaction, "operation-1");
        return { kind: "completed", operationId: "operation-1", response: completion.response, status: completion.responseStatus };
      });

      await expect(createMemoryAiJob(scope, "memory-1", {
        consent: true,
        idempotencyKey: `ai-job-visible-${sourceKind}-key`,
      })).resolves.toMatchObject({ kind: "completed", status: 202 });

      expect(createAiJob).toHaveBeenCalledWith(expect.objectContaining({
        requestHash: memoryAiSnapshotHash({
          memoryId: "memory-1",
          sourceText: snapshot.sourceText,
          version: 5,
          purpose: MEMORY_EXTRACTION_PURPOSE,
          assets: [asset],
        }),
      }), transaction);
    },
  );

  it("fails a new exported text job before it creates a job when generic text AI is not configured", async () => {
    const transaction = {};
    const snapshot = {
      id: "memory-1",
      planetId: "planet-1",
      sourceText: "第一次搬进新家的晚上。",
      occurredAtLabel: null,
      visibility: "private" as const,
      status: "draft",
      version: 4,
    };
    getPrismaClient.mockReturnValue({ $transaction: vi.fn() });
    findActiveMemory.mockResolvedValue(snapshot);
    lockActiveDraftMemoryForAiJob.mockResolvedValue([snapshot]);
    assertMemoryAiCapabilitiesConfigured.mockImplementation(() => {
      throw new DomainError("AI_NOT_CONFIGURED", 503, "AI 功能尚未配置。");
    });
    executeIdempotentDbOperation.mockImplementation(async (_database, _repo, _input, operation) => {
      return operation(transaction, "operation-1");
    });

    await expect(createTextExtractionAiJob(scope, "memory-1", {
      consent: true,
      idempotencyKey: "ai-job-unconfigured-key-01",
    })).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED", status: 503 });

    expect(executeIdempotentDbOperation).toHaveBeenCalledTimes(1);
    expect(assertMemoryAiCapabilitiesConfigured).toHaveBeenCalledWith({ sourceKind: "text" });
    expect(findActiveMemory).toHaveBeenCalledTimes(1);
    expect(lockActiveDraftMemoryForAiJob).toHaveBeenCalledTimes(1);
    expect(createAiJob).not.toHaveBeenCalled();
  });

  it("creates an owner-scoped queued text job through the idempotency transaction and returns only a safe DTO", async () => {
    const transaction = {};
    const snapshot = {
      id: "memory-1",
      planetId: "planet-1",
      sourceText: "第一次搬进新家的晚上。",
      occurredAtLabel: "2018 年夏天",
      visibility: "private" as const,
      status: "draft",
      version: 4,
    };
    const textAsset = {
      id: "asset-text",
      kind: "text" as const,
      sha256: "text-hash",
      visibility: "private" as const,
    };
    getPrismaClient.mockReturnValue({ $transaction: vi.fn() });
    findActiveMemory.mockResolvedValue(snapshot);
    lockActiveDraftMemoryForAiJob.mockImplementation(async (input, client) => {
      expect(input).toEqual({ ...scope, memoryId: "memory-1" });
      expect(client).toBe(transaction);
      return [snapshot];
    });
    lockReadableMemoryAssetsForAiJob.mockResolvedValue([textAsset]);
    createAiJob.mockImplementation(async (input, client) => {
      expect(client).toBe(transaction);
      expect(input).toMatchObject({
        ...scope,
        planetId: "planet-1",
        memoryId: "memory-1",
        kind: "text_extraction",
        consentCapturedAt: expect.any(Date),
        requestHash: memoryAiSnapshotHash({
          memoryId: "memory-1",
          sourceText: "第一次搬进新家的晚上。",
          version: 4,
          purpose: MEMORY_EXTRACTION_PURPOSE,
          assets: [textAsset],
        }),
      });
      return {
        id: "job-1",
        kind: "text_extraction",
        status: "queued",
        attempts: 0,
        errorCode: null,
        completedAt: null,
        leaseToken: "secret-lease",
        leaseExpiresAt: new Date("2026-07-17T00:00:30.000Z"),
        requestHash: input.requestHash,
      };
    });
    executeIdempotentDbOperation.mockImplementation(async (database, _repo, input, operation) => {
      expect(database).toBe(getPrismaClient());
      expect(input).toMatchObject({
        ...scope,
        scope: "ai-job:memory-extraction:create",
        key: "ai-job-create-key-0001",
        requestHash: memoryAiIdempotencyRequestHash({
          memoryId: "memory-1",
          purpose: MEMORY_EXTRACTION_PURPOSE,
        }),
      });
      const completion = await operation(transaction, "operation-1");
      return {
        kind: "completed",
        operationId: "operation-1",
        response: completion.response,
        status: completion.responseStatus,
      };
    });

    const result = await createTextExtractionAiJob(scope, "memory-1", {
      consent: true,
      purpose: "memory_extraction",
      idempotencyKey: "ai-job-create-key-0001",
    });

    expect(result).toMatchObject({
      kind: "completed",
      status: 202,
      response: {
        id: "job-1",
        kind: "text_extraction",
        status: "queued",
        attempts: 0,
        errorCode: null,
        completedAt: null,
      },
    });
    if (result.kind !== "completed") throw new Error("expected a completed result");
    expect(result.response).not.toHaveProperty("leaseToken");
    expect(result.response).not.toHaveProperty("leaseExpiresAt");
    expect(result.response).not.toHaveProperty("requestHash");
    expect(lockActiveDraftMemoryForAiJob).toHaveBeenCalledTimes(1);
  });

  it("replays the same text snapshot through the same idempotency hash without enqueuing a second job", async () => {
    const transaction = {};
    const snapshot = {
      id: "memory-1",
      planetId: "planet-1",
      sourceText: "第一次搬进新家的晚上。",
      occurredAtLabel: "2018 年夏天",
      status: "draft",
      version: 4,
    };
    const response = {
      id: "job-1",
      kind: "text_extraction" as const,
      status: "queued" as const,
      attempts: 0,
      errorCode: null,
      completedAt: null,
    };
    const requestHash = textExtractionIdempotencyRequestHash({
      memoryId: "memory-1",
      purpose: TEXT_EXTRACTION_PURPOSE,
    });
    const seenRequestHashes: string[] = [];
    let initialRequest = true;

    getPrismaClient.mockReturnValue({ $transaction: vi.fn() });
    findActiveMemory.mockResolvedValue(snapshot);
    lockActiveDraftMemoryForAiJob.mockResolvedValue([snapshot]);
    createAiJob.mockResolvedValue(response);
    executeIdempotentDbOperation.mockImplementation(async (_database, _repo, input, operation) => {
      seenRequestHashes.push(input.requestHash);

      if (initialRequest) {
        initialRequest = false;
        const completion = await operation(transaction, "operation-1");
        return {
          kind: "completed",
          operationId: "operation-1",
          response: completion.response,
          status: completion.responseStatus,
        };
      }

      return { kind: "completed", operationId: "operation-1", response, status: 202 };
    });

    const first = await createTextExtractionAiJob(scope, "memory-1", {
      consent: true,
      idempotencyKey: "ai-job-replay-key-0001",
    });
    const replay = await createTextExtractionAiJob(scope, "memory-1", {
      consent: true,
      idempotencyKey: "ai-job-replay-key-0001",
    });

    expect(first).toEqual(replay);
    expect(seenRequestHashes).toEqual([requestHash, requestHash]);
    expect(createAiJob).toHaveBeenCalledTimes(1);
    expect(lockActiveDraftMemoryForAiJob).toHaveBeenCalledTimes(1);
  });

  it("replays the original 202 job after it has moved the memory to needs_confirmation", async () => {
    const transaction = {};
    const draftSnapshot = {
      id: "memory-1",
      planetId: "planet-1",
      sourceText: "第一次搬进新家的晚上。",
      occurredAtLabel: "2018 年夏天",
      status: "draft",
      version: 4,
    };
    const response = {
      id: "job-1",
      kind: "text_extraction" as const,
      status: "queued" as const,
      attempts: 0,
      errorCode: null,
      completedAt: null,
    };
    let storedRequestHash: string | undefined;
    let storedResult: unknown;

    getPrismaClient.mockReturnValue({ $transaction: vi.fn() });
    findActiveMemory
      .mockResolvedValueOnce(draftSnapshot)
      .mockResolvedValueOnce({ ...draftSnapshot, status: "needs_confirmation", version: 5 });
    lockActiveDraftMemoryForAiJob.mockResolvedValue([draftSnapshot]);
    createAiJob.mockResolvedValue(response);
    executeIdempotentDbOperation.mockImplementation(async (_database, _repo, input, operation) => {
      if (storedResult) {
        expect(input.requestHash).toBe(storedRequestHash);
        return storedResult;
      }

      storedRequestHash = input.requestHash;
      const completion = await operation(transaction, "operation-1");
      storedResult = {
        kind: "completed",
        operationId: "operation-1",
        response: completion.response,
        status: completion.responseStatus,
      };
      return storedResult;
    });

    const first = await createTextExtractionAiJob(scope, "memory-1", {
      consent: true,
      idempotencyKey: "ai-job-success-replay-key-1",
    });
    const replay = await createTextExtractionAiJob(scope, "memory-1", {
      consent: true,
      idempotencyKey: "ai-job-success-replay-key-1",
    });

    expect(first).toEqual(replay);
    expect(createAiJob).toHaveBeenCalledTimes(1);
    expect(findActiveMemory).toHaveBeenCalledTimes(1);
  });

  it("returns a completed idempotent replay before it checks current text AI configuration", async () => {
    const replay = {
      kind: "completed" as const,
      operationId: "operation-1",
      status: 202,
      response: {
        id: "job-1",
        kind: "text_extraction" as const,
        status: "queued" as const,
        attempts: 0,
        errorCode: null,
        completedAt: null,
      },
    };
    getPrismaClient.mockReturnValue({ $transaction: vi.fn() });
    assertTextAiConfigured.mockImplementation(() => {
      throw new DomainError("AI_NOT_CONFIGURED", 503, "AI 功能尚未配置。");
    });
    executeIdempotentDbOperation.mockResolvedValue(replay);

    await expect(createTextExtractionAiJob(scope, "memory-1", {
      consent: true,
      idempotencyKey: "ai-job-replay-after-config-key-01",
    })).resolves.toEqual(replay);

    expect(assertTextAiConfigured).not.toHaveBeenCalled();
    expect(findActiveMemory).not.toHaveBeenCalled();
    expect(lockActiveDraftMemoryForAiJob).not.toHaveBeenCalled();
    expect(createAiJob).not.toHaveBeenCalled();
  });

  it("looks up a new idempotency key before it rejects a non-draft memory", async () => {
    const transaction = {};
    getPrismaClient.mockReturnValue({ $transaction: vi.fn() });
    findActiveMemory.mockResolvedValue({
      id: "memory-1",
      planetId: "planet-1",
      sourceText: "第一次搬进新家的晚上。",
      status: "needs_confirmation",
      version: 5,
    });
    executeIdempotentDbOperation.mockImplementation(async (_database, _repo, _input, operation) => {
      return operation(transaction, "operation-1");
    });

    await expect(createTextExtractionAiJob(scope, "memory-1", {
      consent: true,
      idempotencyKey: "ai-job-new-key-non-draft-01",
    })).rejects.toMatchObject({ code: "MEMORY_DRAFT_NOT_EDITABLE", status: 409 });

    expect(executeIdempotentDbOperation).toHaveBeenCalledTimes(1);
    expect(createAiJob).not.toHaveBeenCalled();
  });

  it("rejects the same idempotency key when the memory request semantic changes", async () => {
    const transaction = {};
    const snapshots = {
      "memory-1": {
        id: "memory-1",
        planetId: "planet-1",
        sourceText: "第一次搬进新家的晚上。",
        status: "draft",
        version: 4,
      },
      "memory-2": {
        id: "memory-2",
        planetId: "planet-1",
        sourceText: "第二次搬进新家的晚上。",
        status: "draft",
        version: 4,
      },
    } as const;
    let recorded: { requestHash: string; result: unknown } | undefined;

    getPrismaClient.mockReturnValue({ $transaction: vi.fn() });
    findActiveMemory.mockImplementation(async ({ memoryId }) => snapshots[memoryId as keyof typeof snapshots] ?? null);
    lockActiveDraftMemoryForAiJob.mockImplementation(async ({ memoryId }) => [snapshots[memoryId as keyof typeof snapshots]]);
    createAiJob.mockImplementation(async ({ memoryId }) => ({
      id: `job-${memoryId}`,
      kind: "text_extraction",
      status: "queued",
      attempts: 0,
      errorCode: null,
      completedAt: null,
    }));
    executeIdempotentDbOperation.mockImplementation(async (_database, _repo, input, operation) => {
      if (recorded) {
        if (input.requestHash !== recorded.requestHash) {
          throw new DomainError("IDEMPOTENCY_CONFLICT", 409, "幂等请求与原始请求不一致。");
        }
        return recorded.result;
      }

      const completion = await operation(transaction, "operation-1");
      recorded = {
        requestHash: input.requestHash,
        result: {
          kind: "completed",
          operationId: "operation-1",
          response: completion.response,
          status: completion.responseStatus,
        },
      };
      return recorded.result;
    });

    await createTextExtractionAiJob(scope, "memory-1", {
      consent: true,
      idempotencyKey: "ai-job-shared-key-00001",
    });

    await expect(createTextExtractionAiJob(scope, "memory-2", {
      consent: true,
      idempotencyKey: "ai-job-shared-key-00001",
    })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", status: 409 });

    expect(createAiJob).toHaveBeenCalledTimes(1);
  });

  it("does not enqueue a second text job for a memory that already has a queued job", async () => {
    const transaction = {};
    const snapshot = {
      id: "memory-1",
      planetId: "planet-1",
      sourceText: "第一次搬进新家的晚上。",
      occurredAtLabel: "2018 年夏天",
      status: "draft",
      version: 4,
    };
    getPrismaClient.mockReturnValue({ $transaction: vi.fn() });
    findActiveMemory.mockResolvedValue(snapshot);
    lockActiveDraftMemoryForAiJob.mockResolvedValue([snapshot]);
    findActiveMemoryAiJobsForMemory.mockResolvedValue([{
      id: "existing-job",
      status: "queued",
      leaseToken: null,
      leaseExpiresAt: null,
    }]);
    createAiJob.mockResolvedValue({
      id: "unexpected-job",
      kind: "text_extraction",
      status: "queued",
      attempts: 0,
      errorCode: null,
      completedAt: null,
    });
    executeIdempotentDbOperation.mockImplementation(async (_database, _repo, _input, operation) => {
      return operation(transaction, "operation-1");
    });

    await expect(createTextExtractionAiJob(scope, "memory-1", {
      consent: true,
      idempotencyKey: "ai-job-competing-key-0001",
    })).rejects.toMatchObject({ code: "AI_JOB_ALREADY_ACTIVE", status: 409 });

    expect(findActiveMemoryAiJobsForMemory).toHaveBeenCalledWith({
      ...scope,
      memoryId: "memory-1",
    }, transaction);
    expect(createAiJob).not.toHaveBeenCalled();
  });

  it("rejects a snapshot changed while waiting for the draft lock without enqueuing a job", async () => {
    const transaction = {};
    const initialSnapshot = {
      id: "memory-1",
      planetId: "planet-1",
      sourceText: "第一次搬进新家的晚上。",
      occurredAtLabel: "2018 年夏天",
      status: "draft",
      version: 4,
    };
    const lockedSnapshot = {
      ...initialSnapshot,
      sourceText: "第一次搬进新家的晚上，窗外还下着小雨。",
      version: 5,
    };

    getPrismaClient.mockReturnValue({ $transaction: vi.fn() });
    findActiveMemory.mockResolvedValue(initialSnapshot);
    lockActiveDraftMemoryForAiJob.mockResolvedValue([lockedSnapshot]);
    executeIdempotentDbOperation.mockImplementation(async (_database, _repo, _input, operation) => {
      return operation(transaction, "operation-1");
    });

    await expect(createTextExtractionAiJob(scope, "memory-1", {
      consent: true,
      idempotencyKey: "ai-job-version-conflict-key-0001",
    })).rejects.toMatchObject({ code: "VERSION_CONFLICT", status: 409 });

    expect(createAiJob).not.toHaveBeenCalled();
  });

  it("returns the same scoped not-found error when the requested memory is outside the owner galaxy", async () => {
    const transaction = {};
    getPrismaClient.mockReturnValue({ $transaction: vi.fn() });
    findActiveMemory.mockResolvedValue(null);
    executeIdempotentDbOperation.mockImplementation(async (_database, _repo, _input, operation) => {
      return operation(transaction, "operation-1");
    });

    await expect(createTextExtractionAiJob(scope, "foreign-memory", {
      consent: true,
      idempotencyKey: "ai-job-foreign-key-0001",
    })).rejects.toMatchObject({ code: "MEMORY_NOT_FOUND", status: 404 });
    expect(createAiJob).not.toHaveBeenCalled();
  });

  it.each(["needs_confirmation", "confirmed", "archived"] as const)(
    "does not enqueue a %s memory after the new key reaches its guarded transaction",
    async (status) => {
      const transaction = {};
      getPrismaClient.mockReturnValue({ $transaction: vi.fn() });
      findActiveMemory.mockResolvedValue({
        id: "memory-1",
        planetId: "planet-1",
        sourceText: "第一次搬进新家的晚上。",
        version: 4,
        status,
      });
      executeIdempotentDbOperation.mockImplementation(async (_database, _repo, _input, operation) => {
        return operation(transaction, "operation-1");
      });

      await expect(createTextExtractionAiJob(scope, "memory-1", {
        consent: true,
        idempotencyKey: "ai-job-non-draft-key-001",
      })).rejects.toMatchObject({ code: "MEMORY_DRAFT_NOT_EDITABLE", status: 409 });

      expect(executeIdempotentDbOperation).toHaveBeenCalledTimes(1);
      expect(createAiJob).not.toHaveBeenCalled();
    },
  );

  it("returns only the owner-scoped safe status fields for an AI job", async () => {
    findScopedAiJob.mockResolvedValue({
      id: "job-1",
      kind: "text_extraction",
      status: "failed",
      attempts: 3,
      errorCode: "AI_PROVIDER_UNAVAILABLE",
      errorSummary: "provider detail that must not leave the server",
      completedAt: new Date("2026-07-17T00:00:00.000Z"),
      leaseToken: "secret-lease",
      leaseExpiresAt: new Date("2026-07-17T00:00:30.000Z"),
      requestHash: "secret-request-hash",
    });

    const result = await getAiJobForOwner(scope, "job-1");

    expect(findScopedAiJob).toHaveBeenCalledWith({ ...scope, aiJobId: "job-1" });
    expect(result).toEqual({
      id: "job-1",
      kind: "text_extraction",
      status: "failed",
      attempts: 3,
      errorCode: "AI_PROVIDER_UNAVAILABLE",
      completedAt: "2026-07-17T00:00:00.000Z",
    });
    expect(result).not.toHaveProperty("errorSummary");
    expect(result).not.toHaveProperty("leaseToken");
    expect(result).not.toHaveProperty("requestHash");
  });
});
