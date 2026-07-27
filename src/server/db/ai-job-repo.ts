import { randomUUID } from "node:crypto";

import type { AiJobKind, AiJobStatus, PrismaClient } from "@prisma/client";

import { getPrismaClient } from "@/server/db/client";
import { DomainError } from "@/server/domain-error";
import type { MemoryAiDraft } from "@/server/ai/provider";

const MAX_AI_JOB_ATTEMPTS = 3;
export const AI_JOB_LEASE_DURATION_MS = 30_000;
const MAX_EXPIRED_AI_JOB_REAP_PER_CLAIM = 50;
export const MEMORY_AI_JOB_KINDS = [
  "text_extraction",
  "image_extraction",
  "audio_transcription",
  "document_extraction",
] as const;
export type MemoryAiJobKind = typeof MEMORY_AI_JOB_KINDS[number];

export type ClaimedAiJob = {
  id: string;
  userId: string;
  galaxyId: string;
  planetId: string | null;
  memoryId: string | null;
  assetId: string | null;
  resonanceCandidateId: string | null;
  bookId: string | null;
  kind: AiJobKind;
  status: "processing";
  attempts: number;
  consentCapturedAt: Date;
  requestHash: string;
  leaseToken: string;
  leaseExpiresAt: Date;
};

type AiJobRepositoryClient = Pick<PrismaClient, "aiJob">;

export async function createAiJob(input: {
  userId: string;
  galaxyId: string;
  planetId: string;
  memoryId: string;
  kind: MemoryAiJobKind;
  consentCapturedAt: Date;
  requestHash: string;
}, client?: AiJobRepositoryClient) {
  const prisma = client ?? getPrismaClient();

  return prisma.aiJob.create({
    data: {
      userId: input.userId,
      galaxyId: input.galaxyId,
      planetId: input.planetId,
      memoryId: input.memoryId,
      kind: input.kind,
      status: "queued",
      consentCapturedAt: input.consentCapturedAt,
      requestHash: input.requestHash,
    },
  });
}

export async function findScopedAiJob(input: {
  userId: string;
  galaxyId: string;
  aiJobId: string;
}) {
  const prisma = getPrismaClient();

  return prisma.aiJob.findFirst({
    where: {
      id: input.aiJobId,
      userId: input.userId,
      galaxyId: input.galaxyId,
    },
  });
}

export async function findActiveTextExtractionAiJobsForMemory(input: {
  userId: string;
  galaxyId: string;
  memoryId: string;
}, client?: AiJobRepositoryClient) {
  const prisma = client ?? getPrismaClient();

  return prisma.aiJob.findMany({
    where: {
      userId: input.userId,
      galaxyId: input.galaxyId,
      memoryId: input.memoryId,
      kind: "text_extraction",
      status: { in: ["queued", "processing"] },
    },
    select: {
      id: true,
      status: true,
      leaseToken: true,
      leaseExpiresAt: true,
    },
  });
}

/**
 * A Memory may have at most one active source pipeline, irrespective of its
 * media kind. This is the Task7 single-snapshot boundary generalized without
 * allowing a second image/audio/document job to race the same draft.
 */
export async function findActiveMemoryAiJobsForMemory(input: {
  userId: string;
  galaxyId: string;
  memoryId: string;
}, client?: AiJobRepositoryClient) {
  const prisma = client ?? getPrismaClient();

  return prisma.aiJob.findMany({
    where: {
      userId: input.userId,
      galaxyId: input.galaxyId,
      memoryId: input.memoryId,
      kind: { in: [...MEMORY_AI_JOB_KINDS] },
      status: { in: ["queued", "processing"] },
    },
    select: {
      id: true,
      status: true,
      leaseToken: true,
      leaseExpiresAt: true,
    },
  });
}

export async function updateAiJobStatus(input: {
  userId: string;
  galaxyId: string;
  aiJobId: string;
  expectedStatus: AiJobStatus;
  status: AiJobStatus;
}) {
  const prisma = getPrismaClient();
  const result = await prisma.aiJob.updateMany({
    where: {
      id: input.aiJobId,
      userId: input.userId,
      galaxyId: input.galaxyId,
      status: input.expectedStatus,
    },
    data: {
      status: input.status,
    },
  });

  if (result.count !== 1) {
    throw new DomainError("VERSION_CONFLICT", 409);
  }
}

/**
 * Uses a read followed by a conditional update as the lease boundary. The
 * update repeats every ownership/state predicate, so simultaneous readers can
 * never both turn the same row into their lease.
 */
export async function claimOneQueuedAiJob(input: {
  now?: Date;
  leaseDurationMs?: number;
} = {}): Promise<ClaimedAiJob | null> {
  const prisma = getPrismaClient();
  const now = input.now ?? new Date();
  const leaseDurationMs = input.leaseDurationMs ?? AI_JOB_LEASE_DURATION_MS;

  await reapExpiredTerminalAiJobs(prisma, now);

  const leaseToken = randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);
  const claimableWhere = {
    attempts: { lt: MAX_AI_JOB_ATTEMPTS },
    OR: [
      { status: "queued" as const },
      { status: "processing" as const, leaseExpiresAt: { lte: now } },
    ],
  };
  const candidate = await prisma.aiJob.findFirst({
    where: claimableWhere,
    orderBy: { createdAt: "asc" },
  });

  if (!candidate) {
    return null;
  }

  const claimed = await prisma.aiJob.updateMany({
    where: {
      id: candidate.id,
      userId: candidate.userId,
      galaxyId: candidate.galaxyId,
      ...claimableWhere,
    },
    data: {
      status: "processing",
      leaseToken,
      leaseExpiresAt,
      startedAt: candidate.startedAt ?? now,
      attempts: { increment: 1 },
      errorCode: null,
      errorSummary: null,
    },
  });

  if (claimed.count !== 1) {
    return null;
  }

  return {
    id: candidate.id,
    userId: candidate.userId,
    galaxyId: candidate.galaxyId,
    planetId: candidate.planetId,
    memoryId: candidate.memoryId,
    assetId: candidate.assetId,
    resonanceCandidateId: candidate.resonanceCandidateId,
    bookId: candidate.bookId,
    kind: candidate.kind,
    status: "processing",
    attempts: candidate.attempts + 1,
    consentCapturedAt: candidate.consentCapturedAt,
    requestHash: candidate.requestHash,
    leaseToken,
    leaseExpiresAt,
  };
}

/**
 * Extends the active worker's lease immediately before a remote provider call.
 * The update is an atomic ownership check, not a transaction held across I/O.
 */
export async function renewTextExtractionAiJobLease(input: {
  job: Pick<ClaimedAiJob, "id" | "userId" | "galaxyId" | "leaseToken">;
  now?: Date;
  leaseDurationMs?: number;
}): Promise<Date | null> {
  const now = input.now ?? new Date();
  const leaseDurationMs = input.leaseDurationMs ?? AI_JOB_LEASE_DURATION_MS;

  if (leaseDurationMs < AI_JOB_LEASE_DURATION_MS) {
    return null;
  }

  const prisma = getPrismaClient();
  const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);
  const renewed = await prisma.aiJob.updateMany({
    where: {
      id: input.job.id,
      userId: input.job.userId,
      galaxyId: input.job.galaxyId,
      kind: "text_extraction",
      status: "processing",
      leaseToken: input.job.leaseToken,
      leaseExpiresAt: { gt: now },
    },
    data: { leaseExpiresAt },
  });

  return renewed.count === 1 ? leaseExpiresAt : null;
}

/**
 * Exactly the same lease ownership guard used by text extraction, but scoped
 * to every supported memory-source pipeline before each external AI call.
 */
export async function renewMemoryAiJobLease(input: {
  job: Pick<ClaimedAiJob, "id" | "userId" | "galaxyId" | "leaseToken">;
  now?: Date;
  leaseDurationMs?: number;
}): Promise<Date | null> {
  const now = input.now ?? new Date();
  const leaseDurationMs = input.leaseDurationMs ?? AI_JOB_LEASE_DURATION_MS;

  if (leaseDurationMs < AI_JOB_LEASE_DURATION_MS) {
    return null;
  }

  const prisma = getPrismaClient();
  const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);
  const renewed = await prisma.aiJob.updateMany({
    where: {
      id: input.job.id,
      userId: input.job.userId,
      galaxyId: input.job.galaxyId,
      kind: { in: [...MEMORY_AI_JOB_KINDS] },
      status: "processing",
      leaseToken: input.job.leaseToken,
      leaseExpiresAt: { gt: now },
    },
    data: { leaseExpiresAt },
  });

  return renewed.count === 1 ? leaseExpiresAt : null;
}

async function reapExpiredTerminalAiJobs(prisma: PrismaClient, now: Date): Promise<void> {
  for (let reaped = 0; reaped < MAX_EXPIRED_AI_JOB_REAP_PER_CLAIM; reaped += 1) {
    const expired = await prisma.aiJob.findFirst({
      where: {
        status: "processing",
        attempts: { gte: MAX_AI_JOB_ATTEMPTS },
        leaseExpiresAt: { lte: now },
      },
      orderBy: { createdAt: "asc" },
    });

    if (!expired) {
      return;
    }

    await prisma.$transaction(async (transaction) => {
      const ownsProcessingMemory = expired.memoryId
        ? await isOnlyActiveMemoryAiJobForMemory(transaction, {
          userId: expired.userId,
          galaxyId: expired.galaxyId,
          memoryId: expired.memoryId,
          aiJobId: expired.id,
        })
        : false;
      const terminalized = await transaction.aiJob.updateMany({
        where: {
          id: expired.id,
          userId: expired.userId,
          galaxyId: expired.galaxyId,
          status: "processing",
          attempts: { gte: MAX_AI_JOB_ATTEMPTS },
          leaseToken: expired.leaseToken,
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

      if (terminalized.count !== 1 || !expired.memoryId || !ownsProcessingMemory) {
        return;
      }

      await transaction.memory.updateMany({
        where: {
          id: expired.memoryId,
          userId: expired.userId,
          galaxyId: expired.galaxyId,
          deletedAt: null,
          status: "processing",
        },
        data: {
          status: "draft",
        },
      });
    });
  }
}

export async function retryOrFailAiJob(input: {
  job: Pick<ClaimedAiJob, "id" | "userId" | "galaxyId" | "memoryId" | "attempts" | "leaseToken">;
  errorCode: string;
  errorSummary: string;
  forceTerminal?: boolean;
  now?: Date;
}): Promise<"requeued" | "failed" | "lease_lost"> {
  const prisma = getPrismaClient();
  const now = input.now ?? new Date();
  const terminal = input.forceTerminal || input.job.attempts >= MAX_AI_JOB_ATTEMPTS;
  let outcome: "requeued" | "failed" | "lease_lost" = "lease_lost";

  await prisma.$transaction(async (transaction) => {
    const ownsProcessingMemory = input.job.memoryId
      ? await isOnlyActiveMemoryAiJobForMemory(transaction, {
        userId: input.job.userId,
        galaxyId: input.job.galaxyId,
        memoryId: input.job.memoryId,
        aiJobId: input.job.id,
      })
      : false;
    const result = await transaction.aiJob.updateMany({
      where: {
        id: input.job.id,
        userId: input.job.userId,
        galaxyId: input.job.galaxyId,
        status: "processing",
        leaseToken: input.job.leaseToken,
        leaseExpiresAt: { gt: now },
      },
      data: {
        status: terminal ? "failed" : "queued",
        leaseToken: null,
        leaseExpiresAt: null,
        errorCode: input.errorCode,
        errorSummary: input.errorSummary,
        completedAt: terminal ? now : null,
      },
    });

    if (result.count !== 1) {
      return;
    }

    if (input.job.memoryId && ownsProcessingMemory) {
      await transaction.memory.updateMany({
        where: {
          id: input.job.memoryId,
          userId: input.job.userId,
          galaxyId: input.job.galaxyId,
          deletedAt: null,
          status: "processing",
        },
        data: {
          status: "draft",
        },
      });
    }

    outcome = terminal ? "failed" : "requeued";
  });

  return outcome;
}

async function isOnlyActiveMemoryAiJobForMemory(
  client: AiJobRepositoryClient,
  input: {
    userId: string;
    galaxyId: string;
    memoryId: string;
    aiJobId: string;
  },
): Promise<boolean> {
  const activeJobs = await client.aiJob.findMany({
    where: {
      userId: input.userId,
      galaxyId: input.galaxyId,
      memoryId: input.memoryId,
      kind: { in: [...MEMORY_AI_JOB_KINDS] },
      status: { in: ["queued", "processing"] },
    },
    select: { id: true },
  });

  return activeJobs.length === 1 && activeJobs[0]?.id === input.aiJobId;
}

/**
 * The completion is transactional: the lease guard is claimed first, then the
 * same owner-scoped processing Memory is advanced to review. A memory version
 * conflict rolls back the job success so recovery can remain explicit.
 */
export async function completeMemoryAiJob(input: {
  job: {
    id: string;
    userId: string;
    galaxyId: string;
    memoryId: string | null;
    leaseToken: string;
  };
  memoryVersion: number;
  draft: MemoryAiDraft;
  now?: Date;
}) {
  const memoryId = input.job.memoryId;

  if (!memoryId) {
    throw new DomainError("AI_JOB_MEMORY_REQUIRED", 409, "AI 作业缺少可处理的记忆。");
  }

  const prisma = getPrismaClient();
  const now = input.now ?? new Date();
  const tags = [...new Set([...input.draft.people, ...input.draft.emotions])];

  await prisma.$transaction(async (transaction) => {
    const job = await transaction.aiJob.updateMany({
      where: {
        id: input.job.id,
        userId: input.job.userId,
        galaxyId: input.job.galaxyId,
        status: "processing",
        leaseToken: input.job.leaseToken,
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

    if (job.count !== 1) {
      throw new DomainError("AI_JOB_LEASE_LOST", 409, "AI 作业租约已失效。");
    }

    const memory = await transaction.memory.updateMany({
      where: {
        id: memoryId,
        userId: input.job.userId,
        galaxyId: input.job.galaxyId,
        deletedAt: null,
        status: "processing",
        version: input.memoryVersion,
      },
      data: {
        title: input.draft.title,
        summary: input.draft.summary,
        locationLabel: input.draft.locationLabel,
        people: input.draft.people,
        tags,
        uncertainFields: input.draft.uncertainFields,
        status: "needs_confirmation",
        confirmedAt: null,
        version: { increment: 1 },
      },
    });

    if (memory.count !== 1) {
      throw new DomainError("VERSION_CONFLICT", 409, "记忆已在另一处更新，请刷新后重试。");
    }
  });
}

/** @deprecated Use completeMemoryAiJob for every consent-bound source pipeline. */
export async function completeTextExtractionAiJob(input: {
  job: {
    id: string;
    userId: string;
    galaxyId: string;
    memoryId: string | null;
    leaseToken: string;
  };
  memoryVersion: number;
  draft: MemoryAiDraft;
  now?: Date;
}) {
  return completeMemoryAiJob(input);
}
