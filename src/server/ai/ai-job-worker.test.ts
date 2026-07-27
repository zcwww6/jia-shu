import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/server/domain-error";

const { claimOneQueuedAiJob, retryOrFailAiJob } = vi.hoisted(() => ({
  claimOneQueuedAiJob: vi.fn(),
  retryOrFailAiJob: vi.fn(),
}));
const { processMemoryAiJob, processTextExtractionAiJob } = vi.hoisted(() => ({
  processMemoryAiJob: vi.fn(),
  processTextExtractionAiJob: vi.fn(),
}));

vi.mock("@/server/db/ai-job-repo", () => ({ claimOneQueuedAiJob, retryOrFailAiJob }));
vi.mock("./memory-ai", () => ({ processMemoryAiJob, processTextExtractionAiJob }));

import { runOneQueuedAiJob, startAiJobWorker } from "./ai-job-worker";

const job = {
  id: "job-1",
  userId: "user-1",
  galaxyId: "galaxy-1",
  planetId: "planet-1",
  memoryId: "memory-1",
  assetId: null,
  resonanceCandidateId: null,
  bookId: null,
  kind: "text_extraction" as const,
  status: "processing" as const,
  attempts: 1,
  consentCapturedAt: new Date("2026-07-17T00:00:00.000Z"),
  requestHash: "request-hash",
  leaseToken: "lease-token",
  leaseExpiresAt: new Date("2026-07-17T00:00:30.000Z"),
};

describe("AI job worker", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    claimOneQueuedAiJob.mockReset();
    retryOrFailAiJob.mockReset();
    processMemoryAiJob.mockReset();
    processTextExtractionAiJob.mockReset();
  });

  it("processes a claimed text job through the same real source-pipeline worker", async () => {
    claimOneQueuedAiJob.mockResolvedValue(job);
    processMemoryAiJob.mockResolvedValue(undefined);

    await expect(runOneQueuedAiJob()).resolves.toBe(true);

    expect(processMemoryAiJob).toHaveBeenCalledWith(job);
    expect(processTextExtractionAiJob).not.toHaveBeenCalled();
    expect(retryOrFailAiJob).not.toHaveBeenCalled();
  });

  it("dispatches a claimed image pipeline through the same real worker and retry boundary", async () => {
    const imageJob = { ...job, kind: "image_extraction" as const };
    claimOneQueuedAiJob.mockResolvedValue(imageJob);
    processMemoryAiJob.mockResolvedValue(undefined);

    await expect(runOneQueuedAiJob()).resolves.toBe(true);

    expect(processMemoryAiJob).toHaveBeenCalledWith(imageJob);
    expect(processTextExtractionAiJob).not.toHaveBeenCalled();
    expect(retryOrFailAiJob).not.toHaveBeenCalled();
  });

  it("converts provider errors to a safe retry record without persisting raw provider details", async () => {
    claimOneQueuedAiJob.mockResolvedValue(job);
    processMemoryAiJob.mockRejectedValue(new DomainError(
      "AI_PROVIDER_UNAVAILABLE",
      503,
      "upstream says key sk-sensitive and prompt body are invalid",
    ));
    retryOrFailAiJob.mockResolvedValue("requeued");

    await expect(runOneQueuedAiJob()).resolves.toBe(true);

    expect(retryOrFailAiJob).toHaveBeenCalledWith(expect.objectContaining({
      job,
      errorCode: "AI_PROVIDER_UNAVAILABLE",
      errorSummary: "AI 服务暂不可用，请稍后重试。",
    }));
    expect(JSON.stringify(retryOrFailAiJob.mock.calls)).not.toContain("sk-sensitive");
  });

  it("marks a stale consent snapshot terminal instead of requeueing it", async () => {
    claimOneQueuedAiJob.mockResolvedValue(job);
    processMemoryAiJob.mockRejectedValue(new DomainError(
      "AI_CONSENT_STALE",
      409,
      "记忆内容已变化，请重新确认后发起 AI 整理。",
    ));
    retryOrFailAiJob.mockResolvedValue("failed");

    await expect(runOneQueuedAiJob()).resolves.toBe(true);

    expect(retryOrFailAiJob).toHaveBeenCalledWith({
      job,
      errorCode: "AI_CONSENT_STALE",
      errorSummary: "记忆内容已变化，请重新确认后发起 AI 整理。",
      forceTerminal: true,
    });
  });

  it.each([
    "MEMORY_ASSET_DERIVATIVE_REQUIRED",
    "DOCUMENT_TEXT_REQUIRED",
    "ASSET_READ_LIMIT",
    "INVALID_STORAGE_KEY",
    "AI_CONSENT_REQUIRED",
    "AI_JOB_MEMORY_REQUIRED",
    "MEMORY_NOT_FOUND",
  ])("terminalizes deterministic %s failures on their first attempt so the repository can restore the Memory draft", async (code) => {
    claimOneQueuedAiJob.mockResolvedValue(job);
    processMemoryAiJob.mockRejectedValue(new DomainError(code, 422, "deterministic fixture failure"));
    retryOrFailAiJob.mockResolvedValue("failed");

    await expect(runOneQueuedAiJob()).resolves.toBe(true);

    expect(retryOrFailAiJob).toHaveBeenCalledWith(expect.objectContaining({
      job,
      errorCode: code,
      forceTerminal: true,
    }));
  });

  it.each(["AI_PROVIDER_UNAVAILABLE", "AI_NOT_CONFIGURED"])(
    "keeps %s retryable",
    async (code) => {
      claimOneQueuedAiJob.mockResolvedValue(job);
      processMemoryAiJob.mockRejectedValue(new DomainError(code, 503, "retryable fixture failure"));
      retryOrFailAiJob.mockResolvedValue("requeued");

      await expect(runOneQueuedAiJob()).resolves.toBe(true);

      expect(retryOrFailAiJob.mock.calls[0]?.[0]).not.toHaveProperty("forceTerminal");
    },
  );

  it("starts immediately, repeats every second, and keeps its service timer referenced", async () => {
    const runOne = vi.fn().mockResolvedValue(false);
    const unref = vi.fn();
    const interval = { unref };
    const setIntervalFn = vi.fn().mockReturnValue(interval);

    startAiJobWorker({ runOne, setIntervalFn });
    await Promise.resolve();

    expect(runOne).toHaveBeenCalledTimes(1);
    expect(setIntervalFn).toHaveBeenCalledWith(expect.any(Function), 1_000);
    expect(unref).not.toHaveBeenCalled();
  });

  it("does not overlap timer ticks while a job run is still pending", async () => {
    let resolveFirstRun: (() => void) | undefined;
    const firstRun = new Promise<void>((resolve) => {
      resolveFirstRun = resolve;
    });
    const runOne = vi.fn()
      .mockReturnValueOnce(firstRun)
      .mockResolvedValueOnce(false);
    const unref = vi.fn();
    let intervalTick: (() => void) | undefined;
    const setIntervalFn = (callback: () => void) => {
      intervalTick = callback;
      return { unref };
    };

    startAiJobWorker({ runOne, setIntervalFn });
    expect(runOne).toHaveBeenCalledTimes(1);

    intervalTick?.();
    expect(runOne).toHaveBeenCalledTimes(1);

    resolveFirstRun?.();
    await Promise.resolve();
    await Promise.resolve();

    intervalTick?.();
    expect(runOne).toHaveBeenCalledTimes(2);
  });

  it("logs a fixed safe code when a worker tick fails without exposing the raw error", async () => {
    const rawError = "prompt=家庭私密内容 api_key=sk-sensitive";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const runOne = vi.fn().mockRejectedValue(new Error(rawError));
    const setIntervalFn = vi.fn().mockReturnValue({});

    startAiJobWorker({ runOne, setIntervalFn });
    await Promise.resolve();
    await Promise.resolve();

    expect(errorSpy).toHaveBeenCalledWith("[ai-job-worker] tick failed", {
      code: "AI_JOB_TICK_FAILED",
    });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(rawError);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("sk-sensitive");
  });
});
