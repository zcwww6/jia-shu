import type { AiJobKind, AiJobStatus } from "@prisma/client";

import {
  deriveMemoryAiSource,
  MEMORY_EXTRACTION_PURPOSE,
  memoryAiIdempotencyRequestHash,
  memoryAiSnapshotHash,
} from "@/server/ai/memory-ai-contract";
import { assertMemoryAiCapabilitiesConfigured } from "@/server/ai/openai-client";
import {
  createAiJob,
  findActiveMemoryAiJobsForMemory,
  findScopedAiJob,
} from "@/server/db/ai-job-repo";
import { lockReadableMemoryAssetsForAiJob } from "@/server/db/asset-repo";
import { getPrismaClient } from "@/server/db/client";
import { prismaIdempotencyRepository } from "@/server/db/idempotency-repo";
import { findActiveMemory, lockActiveDraftMemoryForAiJob } from "@/server/db/memory-repo";
import { DomainError } from "@/server/domain-error";
import {
  executeIdempotentDbOperation,
  type IdempotencyStatus,
} from "@/server/services/idempotency.service";

export type AiJobScope = {
  userId: string;
  galaxyId: string;
};

export type CreateTextExtractionAiJobInput = {
  consent: boolean;
  purpose?: "memory_extraction";
  idempotencyKey: string;
};

export type CreateMemoryAiJobInput = {
  consent: boolean;
  purpose?: "memory_extraction";
  idempotencyKey: string;
};

export type AiJobResponse = {
  id: string;
  kind: AiJobKind;
  status: AiJobStatus;
  attempts: number;
  errorCode: string | null;
  completedAt: string | null;
};

export async function createTextExtractionAiJob(
  scope: AiJobScope,
  memoryId: string,
  input: CreateTextExtractionAiJobInput,
): Promise<IdempotencyStatus> {
  return createMemoryAiJob(scope, memoryId, input);
}

/**
 * Starts exactly one server-selected source pipeline for an existing draft.
 * The client neither selects job kind nor supplies storage keys, paths, or
 * prompts; it only captures consent for this new job attempt.
 */
export async function createMemoryAiJob(
  scope: AiJobScope,
  memoryId: string,
  input: CreateMemoryAiJobInput,
): Promise<IdempotencyStatus> {
  if (input.consent !== true) {
    throw new DomainError("AI_CONSENT_REQUIRED", 400, "请先明确同意本次 AI 处理。");
  }

  const purpose = input.purpose ?? MEMORY_EXTRACTION_PURPOSE;
  const idempotencyRequestHash = memoryAiIdempotencyRequestHash({ memoryId, purpose });

  return executeIdempotentDbOperation(
    getPrismaClient(),
    prismaIdempotencyRepository,
    {
      ...scope,
      scope: "ai-job:memory-extraction:create",
      key: input.idempotencyKey,
      requestHash: idempotencyRequestHash,
    },
    async (transaction) => {
      const initialMemory = await findActiveMemory({ ...scope, memoryId }, transaction);

      if (!initialMemory) {
        throw new DomainError("MEMORY_NOT_FOUND", 404, "记忆不存在或无权访问。");
      }

      if (initialMemory.status !== "draft") {
        throw new DomainError("MEMORY_DRAFT_NOT_EDITABLE", 409, "只有草稿状态的记忆可以由 AI 整理。");
      }

      const lockedMemories = await lockActiveDraftMemoryForAiJob({ ...scope, memoryId }, transaction);

      if (lockedMemories.length !== 1) {
        throw new DomainError("MEMORY_DRAFT_NOT_EDITABLE", 409, "只有草稿状态的记忆可以由 AI 整理。");
      }

      const memory = lockedMemories[0];

      if (
        memory.sourceText !== initialMemory.sourceText
        || memory.version !== initialMemory.version
        || memory.visibility !== initialMemory.visibility
      ) {
        throw new DomainError("VERSION_CONFLICT", 409, "记忆已在另一处更新，请刷新后重试。");
      }

      const assets = await lockReadableMemoryAssetsForAiJob({
        ...scope,
        planetId: memory.planetId,
        memoryId,
      }, transaction);
      const source = deriveMemoryAiSource({
        sourceText: memory.sourceText,
        visibility: memory.visibility,
        assets,
      });

      // Preflight runs inside the idempotency operation, so a completed replay
      // returns its safe original 202 result without a new configuration read.
      assertMemoryAiCapabilitiesConfigured({ sourceKind: source.sourceKind });

      const requestHash = memoryAiSnapshotHash({
        memoryId,
        sourceText: memory.sourceText,
        version: memory.version,
        purpose,
        assets,
      });
      const activeJobs = await findActiveMemoryAiJobsForMemory({ ...scope, memoryId }, transaction);

      if (activeJobs.length > 0) {
        throw new DomainError("AI_JOB_ALREADY_ACTIVE", 409, "该记忆已有正在处理的 AI 作业。");
      }

      const job = await createAiJob({
        ...scope,
        planetId: memory.planetId,
        memoryId,
        kind: source.jobKind,
        consentCapturedAt: new Date(),
        requestHash,
      }, transaction);
      const response = toAiJobResponse(job);

      return {
        resourceType: "ai_job",
        resourceId: job.id,
        result: response,
        response,
        responseStatus: 202,
      };
    },
  );
}

export function toAiJobResponse(job: {
  id: string;
  kind: AiJobKind;
  status: AiJobStatus;
  attempts: number;
  errorCode: string | null;
  completedAt: Date | null;
}): AiJobResponse {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    attempts: job.attempts,
    errorCode: job.errorCode,
    completedAt: job.completedAt?.toISOString() ?? null,
  };
}

export async function getAiJobForOwner(scope: AiJobScope, aiJobId: string): Promise<AiJobResponse> {
  const job = await findScopedAiJob({ ...scope, aiJobId });

  if (!job) {
    throw new DomainError("AI_JOB_NOT_FOUND", 404, "AI 作业不存在或无权访问。");
  }

  return toAiJobResponse(job);
}
