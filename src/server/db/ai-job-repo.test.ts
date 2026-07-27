import { beforeEach, describe, expect, it, vi } from "vitest";

const { getPrismaClient } = vi.hoisted(() => ({
  getPrismaClient: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  getPrismaClient,
}));

import {
  claimOneQueuedAiJob,
  completeMemoryAiJob,
  completeTextExtractionAiJob,
  createAiJob,
  findActiveMemoryAiJobsForMemory,
  findScopedAiJob,
  renewMemoryAiJobLease,
  renewTextExtractionAiJobLease,
  retryOrFailAiJob,
  updateAiJobStatus,
} from "./ai-job-repo";

describe("ai job repo", () => {
  beforeEach(() => {
    getPrismaClient.mockReset();
  });

  it("reads an AI job only inside the caller's galaxy scope", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "job-1" });
    getPrismaClient.mockReturnValue({ aiJob: { findFirst } });

    await findScopedAiJob({ userId: "user-1", galaxyId: "galaxy-1", aiJobId: "job-1" });

    expect(findFirst).toHaveBeenCalledWith({
      where: { id: "job-1", userId: "user-1", galaxyId: "galaxy-1" },
    });
  });

  it("persists a server-owned queued text extraction job without browser-controlled state", async () => {
    const create = vi.fn().mockResolvedValue({ id: "job-1" });
    getPrismaClient.mockReturnValue({ aiJob: { create } });
    const consentCapturedAt = new Date("2026-07-17T00:00:00.000Z");

    await createAiJob({
      userId: "user-1",
      galaxyId: "galaxy-1",
      planetId: "planet-1",
      memoryId: "memory-1",
      kind: "text_extraction",
      consentCapturedAt,
      requestHash: "server-request-hash",
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        galaxyId: "galaxy-1",
        planetId: "planet-1",
        memoryId: "memory-1",
        kind: "text_extraction",
        status: "queued",
        consentCapturedAt,
        requestHash: "server-request-hash",
      },
    });
  });

  it("treats image, audio, and document jobs as the same single active memory pipeline boundary", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "job-image" }]);
    getPrismaClient.mockReturnValue({ aiJob: { findMany } });

    await findActiveMemoryAiJobsForMemory({
      userId: "user-1",
      galaxyId: "galaxy-1",
      memoryId: "memory-1",
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        galaxyId: "galaxy-1",
        memoryId: "memory-1",
        kind: { in: ["text_extraction", "image_extraction", "audio_transcription", "document_extraction"] },
        status: { in: ["queued", "processing"] },
      },
      select: {
        id: true,
        status: true,
        leaseToken: true,
        leaseExpiresAt: true,
      },
    });
  });

  it("updates an AI job through the scoped expected-state guard", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    getPrismaClient.mockReturnValue({ aiJob: { updateMany } });

    await updateAiJobStatus({
      userId: "user-1",
      galaxyId: "galaxy-1",
      aiJobId: "job-1",
      expectedStatus: "queued",
      status: "processing",
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "job-1", userId: "user-1", galaxyId: "galaxy-1", status: "queued" },
      data: { status: "processing" },
    });
  });

  it("atomically renews only the current processing text-job lease before a provider call", async () => {
    const now = new Date("2026-07-17T00:00:00.000Z");
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    getPrismaClient.mockReturnValue({ aiJob: { updateMany } });

    const renewed = await renewTextExtractionAiJobLease({
      job: {
        id: "job-1",
        userId: "user-1",
        galaxyId: "galaxy-1",
        leaseToken: "lease-token",
      },
      now,
      leaseDurationMs: 30_000,
    });

    expect(renewed).toEqual(new Date("2026-07-17T00:00:30.000Z"));
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "job-1",
        userId: "user-1",
        galaxyId: "galaxy-1",
        kind: "text_extraction",
        status: "processing",
        leaseToken: "lease-token",
        leaseExpiresAt: { gt: now },
      },
      data: { leaseExpiresAt: new Date("2026-07-17T00:00:30.000Z") },
    });
  });

  it("renews the same guarded provider window for a claimed multimodal memory pipeline", async () => {
    const now = new Date("2026-07-17T00:00:00.000Z");
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    getPrismaClient.mockReturnValue({ aiJob: { updateMany } });

    await expect(renewMemoryAiJobLease({
      job: {
        id: "job-image",
        userId: "user-1",
        galaxyId: "galaxy-1",
        leaseToken: "lease-token",
      },
      now,
      leaseDurationMs: 30_000,
    })).resolves.toEqual(new Date("2026-07-17T00:00:30.000Z"));

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "job-image",
        userId: "user-1",
        galaxyId: "galaxy-1",
        kind: { in: ["text_extraction", "image_extraction", "audio_transcription", "document_extraction"] },
        status: "processing",
        leaseToken: "lease-token",
        leaseExpiresAt: { gt: now },
      },
      data: { leaseExpiresAt: new Date("2026-07-17T00:00:30.000Z") },
    });
  });

  it.each(["old token", "expired lease"])(
    "returns null without a provider window when the %s renewal guard updates no job",
    async () => {
      const now = new Date("2026-07-17T00:00:00.000Z");
      const updateMany = vi.fn().mockResolvedValue({ count: 0 });
      getPrismaClient.mockReturnValue({ aiJob: { updateMany } });

      await expect(renewTextExtractionAiJobLease({
        job: {
          id: "job-1",
          userId: "user-1",
          galaxyId: "galaxy-1",
          leaseToken: "stale-lease-token",
        },
        now,
        leaseDurationMs: 30_000,
      })).resolves.toBeNull();
    },
  );

  it("does not create a provider lease window shorter than the configured completion budget", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    getPrismaClient.mockReturnValue({ aiJob: { updateMany } });

    await expect(renewTextExtractionAiJobLease({
      job: {
        id: "job-1",
        userId: "user-1",
        galaxyId: "galaxy-1",
        leaseToken: "lease-token",
      },
      now: new Date("2026-07-17T00:00:00.000Z"),
      leaseDurationMs: 29_999,
    })).resolves.toBeNull();

    expect(updateMany).not.toHaveBeenCalled();
  });

  it("atomically claims only one queued job when two workers race", async () => {
    const now = new Date("2026-07-17T00:00:00.000Z");
    const candidate = {
      id: "job-1",
      userId: "user-1",
      galaxyId: "galaxy-1",
      planetId: "planet-1",
      memoryId: "memory-1",
      kind: "text_extraction",
      status: "queued",
      attempts: 0,
      consentCapturedAt: new Date("2026-07-16T00:00:00.000Z"),
      requestHash: "request-hash",
    };
    const findFirst = vi.fn(({ where }) => Promise.resolve(
      where.status === "processing" ? null : candidate,
    ));
    const updateMany = vi.fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    getPrismaClient.mockReturnValue({ aiJob: { findFirst, updateMany } });

    const claimed = await Promise.all([
      claimOneQueuedAiJob({ now, leaseDurationMs: 30_000 }),
      claimOneQueuedAiJob({ now, leaseDurationMs: 30_000 }),
    ]);

    expect(claimed.filter(Boolean)).toHaveLength(1);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        attempts: { lt: 3 },
        OR: [
          { status: "queued" },
          { status: "processing", leaseExpiresAt: { lte: now } },
        ],
      },
      orderBy: { createdAt: "asc" },
    });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "job-1",
        attempts: { lt: 3 },
        OR: [
          { status: "queued" },
          { status: "processing", leaseExpiresAt: { lte: now } },
        ],
      }),
      data: expect.objectContaining({
        status: "processing",
        attempts: { increment: 1 },
        leaseToken: expect.any(String),
        leaseExpiresAt: new Date("2026-07-17T00:00:30.000Z"),
      }),
    }));
  });

  it("reclaims an expired processing lease after a worker restart", async () => {
    const now = new Date("2026-07-17T00:00:00.000Z");
    const candidate = {
      id: "job-1",
      userId: "user-1",
      galaxyId: "galaxy-1",
      planetId: "planet-1",
      memoryId: "memory-1",
      assetId: null,
      resonanceCandidateId: null,
      bookId: null,
      kind: "text_extraction",
      status: "processing",
      attempts: 1,
      consentCapturedAt: new Date("2026-07-16T00:00:00.000Z"),
      requestHash: "request-hash",
      startedAt: new Date("2026-07-16T00:00:00.000Z"),
      leaseToken: "dead-worker-token",
      leaseExpiresAt: new Date("2026-07-16T00:00:30.000Z"),
    };
    const findFirst = vi.fn(({ where }) => Promise.resolve(
      where.status === "processing" ? null : candidate,
    ));
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    getPrismaClient.mockReturnValue({ aiJob: { findFirst, updateMany } });

    const claimed = await claimOneQueuedAiJob({ now, leaseDurationMs: 30_000 });

    expect(claimed).toMatchObject({
      id: "job-1",
      status: "processing",
      attempts: 2,
      leaseExpiresAt: new Date("2026-07-17T00:00:30.000Z"),
    });
    expect(claimed?.leaseToken).not.toBe("dead-worker-token");
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([{ status: "processing", leaseExpiresAt: { lte: now } }]),
      }),
    }));
  });

  it("checks expired terminal processing leases before it looks for another claim", async () => {
    const now = new Date("2026-07-17T00:00:00.000Z");
    const findFirst = vi.fn().mockResolvedValue(null);
    getPrismaClient.mockReturnValue({ aiJob: { findFirst } });

    await expect(claimOneQueuedAiJob({ now, leaseDurationMs: 30_000 })).resolves.toBeNull();

    expect(findFirst).toHaveBeenNthCalledWith(1, {
      where: {
        status: "processing",
        attempts: { gte: 3 },
        leaseExpiresAt: { lte: now },
      },
      orderBy: { createdAt: "asc" },
    });
    expect(findFirst).toHaveBeenNthCalledWith(2, {
      where: {
        attempts: { lt: 3 },
        OR: [
          { status: "queued" },
          { status: "processing", leaseExpiresAt: { lte: now } },
        ],
      },
      orderBy: { createdAt: "asc" },
    });
  });

  it("restores a memory to draft when the lease reaper terminalizes its expired third attempt", async () => {
    const now = new Date("2026-07-17T00:00:00.000Z");
    const expired = {
      id: "job-1",
      userId: "user-1",
      galaxyId: "galaxy-1",
      memoryId: "memory-1",
      status: "processing",
      attempts: 3,
      leaseToken: "expired-lease-token",
      leaseExpiresAt: new Date("2026-07-16T23:59:59.000Z"),
    };
    const findFirst = vi.fn()
      .mockResolvedValueOnce(expired)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    const legacyUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const jobUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const memoryUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findMany = vi.fn().mockResolvedValue([{ id: "job-1" }]);
    const transaction = { aiJob: { updateMany: jobUpdateMany, findMany }, memory: { updateMany: memoryUpdateMany } };
    const $transaction = vi.fn(async (callback) => callback(transaction));
    getPrismaClient.mockReturnValue({ aiJob: { findFirst, updateMany: legacyUpdateMany }, $transaction });

    await expect(claimOneQueuedAiJob({ now, leaseDurationMs: 30_000 })).resolves.toBeNull();

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(jobUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "job-1",
        userId: "user-1",
        galaxyId: "galaxy-1",
        status: "processing",
        attempts: { gte: 3 },
        leaseToken: "expired-lease-token",
        leaseExpiresAt: { lte: now },
      },
      data: {
        status: "failed",
        completedAt: now,
        leaseToken: null,
        leaseExpiresAt: null,
        errorCode: "AI_JOB_LEASE_EXPIRED",
        errorSummary: "AI 作业租约已过期，请重新发起处理。",
      },
    });
    expect(memoryUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "memory-1",
        userId: "user-1",
        galaxyId: "galaxy-1",
        deletedAt: null,
        status: "processing",
      },
      data: { status: "draft" },
    });
  });

  it("bounds expired third-attempt reaping so a queued job is still claimed in the same tick", async () => {
    const now = new Date("2026-07-17T00:00:00.000Z");
    const expiredJobs = Array.from({ length: 51 }, (_, index) => ({
      id: `expired-${index}`,
      userId: "user-1",
      galaxyId: "galaxy-1",
      memoryId: null,
      status: "processing",
      attempts: 3,
      leaseToken: `expired-lease-${index}`,
      leaseExpiresAt: new Date("2026-07-16T23:59:59.000Z"),
    }));
    const queuedCandidate = {
      id: "queued-job-1",
      userId: "user-1",
      galaxyId: "galaxy-1",
      planetId: "planet-1",
      memoryId: "memory-1",
      assetId: null,
      resonanceCandidateId: null,
      bookId: null,
      kind: "text_extraction",
      status: "queued",
      attempts: 0,
      consentCapturedAt: new Date("2026-07-16T00:00:00.000Z"),
      requestHash: "request-hash",
      startedAt: null,
    };
    let nextExpiredJob = 0;
    const findFirst = vi.fn(({ where }) => {
      if (where.attempts?.gte === 3) {
        return Promise.resolve(expiredJobs[nextExpiredJob++] ?? null);
      }

      return Promise.resolve(queuedCandidate);
    });
    const reapUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const claimUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = { aiJob: { updateMany: reapUpdateMany } };
    const $transaction = vi.fn(async (callback) => callback(transaction));
    getPrismaClient.mockReturnValue({ aiJob: { findFirst, updateMany: claimUpdateMany }, $transaction });

    const claimed = await claimOneQueuedAiJob({ now, leaseDurationMs: 30_000 });

    expect(claimed).toMatchObject({ id: "queued-job-1", status: "processing" });
    expect($transaction).toHaveBeenCalledTimes(50);
    expect(findFirst).toHaveBeenCalledTimes(51);
    expect(claimUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "queued-job-1", attempts: { lt: 3 } }),
    }));
  });

  it("requeues a leased failure before the third processing attempt", async () => {
    const now = new Date("2026-07-17T00:00:00.000Z");
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = { aiJob: { updateMany }, memory: { updateMany: vi.fn() } };
    const $transaction = vi.fn(async (callback) => callback(transaction));
    getPrismaClient.mockReturnValue({ $transaction });

    const result = await retryOrFailAiJob({
      job: {
        id: "job-1",
        userId: "user-1",
        galaxyId: "galaxy-1",
        memoryId: null,
        attempts: 2,
        leaseToken: "lease-token",
      },
      errorCode: "AI_PROVIDER_UNAVAILABLE",
      errorSummary: "AI 服务暂不可用，请稍后重试。",
      now,
    });

    expect(result).toBe("requeued");
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "job-1",
        userId: "user-1",
        galaxyId: "galaxy-1",
        status: "processing",
        leaseToken: "lease-token",
        leaseExpiresAt: { gt: now },
      },
      data: {
        status: "queued",
        leaseToken: null,
        leaseExpiresAt: null,
        errorCode: "AI_PROVIDER_UNAVAILABLE",
        errorSummary: "AI 服务暂不可用，请稍后重试。",
        completedAt: null,
      },
    });
  });

  it("restores the processing memory to draft in the same lease-guarded transaction when a job is requeued", async () => {
    const now = new Date("2026-07-17T00:00:00.000Z");
    const jobUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const memoryUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findMany = vi.fn().mockResolvedValue([{ id: "job-1" }]);
    const transaction = { aiJob: { updateMany: jobUpdateMany, findMany }, memory: { updateMany: memoryUpdateMany } };
    const $transaction = vi.fn(async (callback) => callback(transaction));
    const legacyUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    getPrismaClient.mockReturnValue({ $transaction, aiJob: { updateMany: legacyUpdateMany } });

    await expect(retryOrFailAiJob({
      job: {
        id: "job-1",
        userId: "user-1",
        galaxyId: "galaxy-1",
        memoryId: "memory-1",
        attempts: 1,
        leaseToken: "lease-token",
      },
      errorCode: "AI_PROVIDER_UNAVAILABLE",
      errorSummary: "AI 服务暂不可用，请稍后重试。",
      now,
    })).resolves.toBe("requeued");

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(jobUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "job-1",
        userId: "user-1",
        galaxyId: "galaxy-1",
        status: "processing",
        leaseToken: "lease-token",
        leaseExpiresAt: { gt: now },
      },
      data: {
        status: "queued",
        leaseToken: null,
        leaseExpiresAt: null,
        errorCode: "AI_PROVIDER_UNAVAILABLE",
        errorSummary: "AI 服务暂不可用，请稍后重试。",
        completedAt: null,
      },
    });
    expect(memoryUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "memory-1",
        userId: "user-1",
        galaxyId: "galaxy-1",
        deletedAt: null,
        status: "processing",
      },
      data: { status: "draft" },
    });
  });

  it("uses the same recovery guard for an audio pipeline instead of leaving its Memory stuck processing", async () => {
    const now = new Date("2026-07-17T00:00:00.000Z");
    const jobUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const memoryUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findMany = vi.fn().mockResolvedValue([{ id: "job-audio" }]);
    const transaction = { aiJob: { updateMany: jobUpdateMany, findMany }, memory: { updateMany: memoryUpdateMany } };
    const $transaction = vi.fn(async (callback) => callback(transaction));
    getPrismaClient.mockReturnValue({ $transaction });

    await expect(retryOrFailAiJob({
      job: {
        id: "job-audio",
        userId: "user-1",
        galaxyId: "galaxy-1",
        memoryId: "memory-1",
        attempts: 1,
        leaseToken: "lease-token",
      },
      errorCode: "AI_PROVIDER_UNAVAILABLE",
      errorSummary: "AI 服务暂不可用，请稍后重试。",
      now,
    })).resolves.toBe("requeued");

    expect(findMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        galaxyId: "galaxy-1",
        memoryId: "memory-1",
        kind: { in: ["text_extraction", "image_extraction", "audio_transcription", "document_extraction"] },
        status: { in: ["queued", "processing"] },
      },
      select: { id: true },
    });
    expect(memoryUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "draft" } }));
  });

  it.each([
    ["AI_CONSENT_STALE", "记忆内容已变化，请重新确认后发起 AI 整理。"],
    ["MEMORY_ASSET_DERIVATIVE_REQUIRED", "图片缺少可供 AI 使用的安全派生副本。"],
    ["DOCUMENT_TEXT_REQUIRED", "文档没有可用于整理的文字内容。"],
  ])("restores the processing memory when a lease-owned %s failure is terminal", async (errorCode, errorSummary) => {
    const now = new Date("2026-07-17T00:00:00.000Z");
    const jobUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const memoryUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findMany = vi.fn().mockResolvedValue([{ id: "job-1" }]);
    const transaction = { aiJob: { updateMany: jobUpdateMany, findMany }, memory: { updateMany: memoryUpdateMany } };
    const $transaction = vi.fn(async (callback) => callback(transaction));
    const legacyUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    getPrismaClient.mockReturnValue({ $transaction, aiJob: { updateMany: legacyUpdateMany } });

    await expect(retryOrFailAiJob({
      job: {
        id: "job-1",
        userId: "user-1",
        galaxyId: "galaxy-1",
        memoryId: "memory-1",
        attempts: 1,
        leaseToken: "lease-token",
      },
      errorCode,
      errorSummary,
      forceTerminal: true,
      now,
    })).resolves.toBe("failed");

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(jobUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "failed", completedAt: now }),
    }));
    expect(memoryUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: "draft" },
    }));
  });

  it("does not restore a processing memory when an old lease no longer owns the job", async () => {
    const now = new Date("2026-07-17T00:00:00.000Z");
    const jobUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
    const memoryUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findMany = vi.fn().mockResolvedValue([{ id: "job-1" }]);
    const transaction = { aiJob: { updateMany: jobUpdateMany, findMany }, memory: { updateMany: memoryUpdateMany } };
    const $transaction = vi.fn(async (callback) => callback(transaction));
    const legacyUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
    getPrismaClient.mockReturnValue({ $transaction, aiJob: { updateMany: legacyUpdateMany } });

    await expect(retryOrFailAiJob({
      job: {
        id: "job-1",
        userId: "user-1",
        galaxyId: "galaxy-1",
        memoryId: "memory-1",
        attempts: 1,
        leaseToken: "old-lease-token",
      },
      errorCode: "AI_PROVIDER_UNAVAILABLE",
      errorSummary: "AI 服务暂不可用，请稍后重试。",
      now,
    })).resolves.toBe("lease_lost");

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(memoryUpdateMany).not.toHaveBeenCalled();
  });

  it("does not unlock a processing memory when another active text job exists for it", async () => {
    const now = new Date("2026-07-17T00:00:00.000Z");
    const jobUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const memoryUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findMany = vi.fn().mockResolvedValue([{ id: "job-1" }, { id: "job-2" }]);
    const transaction = {
      aiJob: { updateMany: jobUpdateMany, findMany },
      memory: { updateMany: memoryUpdateMany },
    };
    const $transaction = vi.fn(async (callback) => callback(transaction));
    getPrismaClient.mockReturnValue({ $transaction });

    await expect(retryOrFailAiJob({
      job: {
        id: "job-1",
        userId: "user-1",
        galaxyId: "galaxy-1",
        memoryId: "memory-1",
        attempts: 1,
        leaseToken: "lease-token",
      },
      errorCode: "AI_PROVIDER_UNAVAILABLE",
      errorSummary: "AI 服务暂不可用，请稍后重试。",
      now,
    })).resolves.toBe("requeued");

    expect(memoryUpdateMany).not.toHaveBeenCalled();
  });

  it("marks the third failed processing attempt terminal instead of requeuing it", async () => {
    const now = new Date("2026-07-17T00:00:00.000Z");
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = { aiJob: { updateMany }, memory: { updateMany: vi.fn() } };
    const $transaction = vi.fn(async (callback) => callback(transaction));
    getPrismaClient.mockReturnValue({ $transaction });

    const result = await retryOrFailAiJob({
      job: {
        id: "job-1",
        userId: "user-1",
        galaxyId: "galaxy-1",
        memoryId: null,
        attempts: 3,
        leaseToken: "lease-token",
      },
      errorCode: "AI_PROVIDER_UNAVAILABLE",
      errorSummary: "AI 服务暂不可用，请稍后重试。",
      now,
    });

    expect(result).toBe("failed");
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "failed",
        completedAt: now,
        leaseToken: null,
        leaseExpiresAt: null,
      }),
    }));
  });

  it("terminalizes a stale-consent failure without waiting for a third attempt", async () => {
    const now = new Date("2026-07-17T00:00:00.000Z");
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = { aiJob: { updateMany }, memory: { updateMany: vi.fn() } };
    const $transaction = vi.fn(async (callback) => callback(transaction));
    getPrismaClient.mockReturnValue({ $transaction });

    const result = await retryOrFailAiJob({
      job: {
        id: "job-1",
        userId: "user-1",
        galaxyId: "galaxy-1",
        memoryId: null,
        attempts: 1,
        leaseToken: "lease-token",
      },
      errorCode: "AI_CONSENT_STALE",
      errorSummary: "记忆内容已变化，请重新确认后发起 AI 整理。",
      forceTerminal: true,
      now,
    });

    expect(result).toBe("failed");
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "failed",
        completedAt: now,
        leaseToken: null,
        leaseExpiresAt: null,
      }),
    }));
  });

  it("commits a leased text extraction with its processing memory as needs_confirmation", async () => {
    const now = new Date("2026-07-17T00:00:00.000Z");
    const aiJobUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const memoryUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = { aiJob: { updateMany: aiJobUpdateMany }, memory: { updateMany: memoryUpdateMany } };
    const $transaction = vi.fn(async (callback) => callback(transaction));
    getPrismaClient.mockReturnValue({ $transaction });

    await completeTextExtractionAiJob({
      job: {
        id: "job-1",
        userId: "user-1",
        galaxyId: "galaxy-1",
        memoryId: "memory-1",
        leaseToken: "lease-token",
      },
      memoryVersion: 4,
      draft: {
        title: "新家的晚上",
        summary: "全家第一次在新家吃晚饭。",
        locationLabel: "老家厨房",
        people: ["妈妈", "我"],
        emotions: ["安心"],
        uncertainFields: ["occurredAtLabel", "people"],
      },
      now,
    });

    expect(aiJobUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "job-1",
        userId: "user-1",
        galaxyId: "galaxy-1",
        status: "processing",
        leaseToken: "lease-token",
        leaseExpiresAt: { gt: now },
      },
      data: {
        status: "succeeded",
        completedAt: now,
        leaseToken: null,
        leaseExpiresAt: null,
        errorCode: null,
        errorSummary: null,
      },
    });
    expect(memoryUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "memory-1",
        userId: "user-1",
        galaxyId: "galaxy-1",
        deletedAt: null,
        status: "processing",
        version: 4,
      },
      data: {
        title: "新家的晚上",
        summary: "全家第一次在新家吃晚饭。",
        locationLabel: "老家厨房",
        people: ["妈妈", "我"],
        tags: ["妈妈", "我", "安心"],
        uncertainFields: ["occurredAtLabel", "people"],
        status: "needs_confirmation",
        confirmedAt: null,
        version: { increment: 1 },
      },
    });
  });

  it("commits a leased image pipeline only to needs_confirmation, never confirmed", async () => {
    const now = new Date("2026-07-17T00:00:00.000Z");
    const aiJobUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const memoryUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = { aiJob: { updateMany: aiJobUpdateMany }, memory: { updateMany: memoryUpdateMany } };
    const $transaction = vi.fn(async (callback) => callback(transaction));
    getPrismaClient.mockReturnValue({ $transaction });

    await completeMemoryAiJob({
      job: {
        id: "job-image",
        userId: "user-1",
        galaxyId: "galaxy-1",
        memoryId: "memory-1",
        leaseToken: "lease-token",
      },
      memoryVersion: 4,
        draft: {
          title: "搬家那天",
          summary: "照片记录了搬家当天。",
          locationLabel: null,
          people: [],
        emotions: [],
        uncertainFields: ["people"],
      },
      now,
    });

    expect(memoryUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "processing", version: 4 }),
      data: expect.objectContaining({
        status: "needs_confirmation",
        confirmedAt: null,
      }),
    }));
    const update = memoryUpdateMany.mock.calls[0]?.[0] as { data: { status: string } };
    expect(update.data.status).not.toBe("confirmed");
  });
});
