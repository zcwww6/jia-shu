import {
  claimOneQueuedAiJob,
  retryOrFailAiJob,
  type ClaimedAiJob,
} from "@/server/db/ai-job-repo";
import { DomainError } from "@/server/domain-error";

import { processMemoryAiJob, type MemoryAiJob } from "./memory-ai";

type RunOne = () => Promise<unknown>;
type IntervalFactory = (callback: () => void, delayMs: number) => { unref?: () => unknown };

const TERMINAL_AI_JOB_ERROR_CODES = new Set([
  "AI_CONSENT_STALE",
  "AI_CONSENT_REQUIRED",
  "AI_JOB_KIND_UNSUPPORTED",
  "AI_JOB_MEMORY_REQUIRED",
  "MEMORY_NOT_FOUND",
  "MEMORY_SOURCE_REQUIRED",
  "MEMORY_ASSET_SOURCE_INVALID",
  "MEMORY_ASSET_VISIBILITY_INVALID",
  "MEMORY_ASSET_DERIVATIVE_REQUIRED",
  "DOCUMENT_TEXT_REQUIRED",
  "ASSET_READ_LIMIT",
  "INVALID_STORAGE_KEY",
]);

export async function runOneQueuedAiJob(): Promise<boolean> {
  const job = await claimOneQueuedAiJob();

  if (!job) {
    return false;
  }

  try {
    if (!isMemoryAiJob(job)) {
      throw new DomainError("AI_JOB_KIND_UNSUPPORTED", 422, "当前 AI 作业类型尚未启用。");
    }

    await processMemoryAiJob(job);
  } catch (error) {
    const failure = safeFailure(error);
    await retryOrFailAiJob({ job, ...failure });
  }

  return true;
}

/**
 * Starts outside request handlers. The first tick is immediate so an enqueued
 * job does not depend on a future HTTP request; later ticks run once per
 * second. The timer remains referenced so the dedicated worker service stays
 * alive after an empty poll or a completed job.
 */
export function startAiJobWorker(options: {
  runOne?: RunOne;
  setIntervalFn?: IntervalFactory;
} = {}): void {
  const runOne = options.runOne ?? runOneQueuedAiJob;
  const setIntervalFn = options.setIntervalFn ?? defaultInterval;
  let running = false;

  const runIfIdle = () => {
    if (running) {
      return;
    }

    running = true;
    void (async () => {
      try {
        await runOne();
      } catch {
        console.error("[ai-job-worker] tick failed", { code: "AI_JOB_TICK_FAILED" });
      } finally {
        running = false;
      }
    })();
  };

  runIfIdle();
  setIntervalFn(runIfIdle, 1_000);
}

function defaultInterval(callback: () => void, delayMs: number) {
  return setInterval(callback, delayMs) as unknown as { unref?: () => unknown };
}

function safeFailure(error: unknown) {
  if (error instanceof DomainError) {
    if (error.code === "AI_NOT_CONFIGURED") {
      return { errorCode: "AI_NOT_CONFIGURED", errorSummary: "AI 功能尚未配置。" };
    }

    if (error.code === "AI_PROVIDER_UNAVAILABLE") {
      return { errorCode: "AI_PROVIDER_UNAVAILABLE", errorSummary: "AI 服务暂不可用，请稍后重试。" };
    }

    if (error.code === "AI_PROVIDER_RESPONSE_INVALID") {
      return { errorCode: "AI_PROVIDER_RESPONSE_INVALID", errorSummary: "AI 服务返回内容无法处理，请稍后重试。" };
    }

    if (error.code === "AI_CONSENT_STALE") {
      return {
        errorCode: "AI_CONSENT_STALE",
        errorSummary: "记忆内容已变化，请重新确认后发起 AI 整理。",
        forceTerminal: true,
      };
    }

    if (TERMINAL_AI_JOB_ERROR_CODES.has(error.code)) {
      return {
        errorCode: error.code,
        errorSummary: "AI 作业内容无效，请重新确认后发起处理。",
        forceTerminal: true,
      };
    }

    return { errorCode: error.code, errorSummary: "AI 处理失败，请稍后重试。" };
  }

  return { errorCode: "AI_PROCESSING_FAILED", errorSummary: "AI 处理失败，请稍后重试。" };
}

function isMemoryAiJob(job: ClaimedAiJob): job is ClaimedAiJob & MemoryAiJob {
  return (
    job.kind === "text_extraction"
    || job.kind === "image_extraction"
    || job.kind === "audio_transcription"
    || job.kind === "document_extraction"
  );
}
