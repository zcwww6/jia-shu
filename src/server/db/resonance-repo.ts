import { randomUUID } from "node:crypto";

import { getPrismaClient } from "@/server/db/client";
import { normalizeResonancePair } from "@/server/domain/resonance-pair";
import { DomainError } from "@/server/domain-error";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
export const RESONANCE_SCAN_LEASE_DURATION_MS = 60_000;

export async function findActiveResonanceCandidate(input: {
  userId: string;
  galaxyId: string;
  resonanceCandidateId: string;
}) {
  const prisma = getPrismaClient();

  return prisma.resonanceCandidate.findFirst({
    where: {
      id: input.resonanceCandidateId,
      userId: input.userId,
      galaxyId: input.galaxyId,
      deletedAt: null,
    },
  });
}

export async function findEligibleResonanceSource(input: {
  userId: string;
  galaxyId: string;
  memoryId: string;
}) {
  const prisma = getPrismaClient();

  return prisma.memory.findFirst({
    where: {
      id: input.memoryId,
      userId: input.userId,
      galaxyId: input.galaxyId,
      deletedAt: null,
      status: "confirmed",
      allowResonance: true,
    },
    select: {
      id: true,
      sourceText: true,
      occurredAt: true,
      occurredAtLabel: true,
      locationLabel: true,
      people: true,
      embedding: true,
    },
  });
}

export async function findEligibleResonanceTargets(input: {
  userId: string;
  galaxyId: string;
  sourceMemoryId: string;
}) {
  const prisma = getPrismaClient();

  return prisma.memory.findMany({
    where: {
      userId: input.userId,
      galaxyId: input.galaxyId,
      id: { not: input.sourceMemoryId },
      deletedAt: null,
      status: "confirmed",
      allowResonance: true,
    },
    select: {
      id: true,
      sourceText: true,
      occurredAt: true,
      occurredAtLabel: true,
      locationLabel: true,
      people: true,
      embedding: true,
    },
    orderBy: { id: "asc" },
  });
}

export async function findExistingResonancePairs(input: {
  userId: string;
  galaxyId: string;
  pairs: Array<{ sourceMemoryId: string; targetMemoryId: string }>;
}) {
  if (input.pairs.length === 0) {
    return [];
  }

  const prisma = getPrismaClient();
  const pairs = input.pairs.map(({ sourceMemoryId, targetMemoryId }) =>
    normalizeResonancePair(sourceMemoryId, targetMemoryId),
  );

  // Do not filter deletedAt or status here. The unique pair represents the
  // family's decision history; in particular, a rejected pair never revives.
  return prisma.resonanceCandidate.findMany({
    where: {
      userId: input.userId,
      galaxyId: input.galaxyId,
      OR: pairs.flatMap(({ sourceMemoryId, targetMemoryId }) => [
        { sourceMemoryId, targetMemoryId },
        { sourceMemoryId: targetMemoryId, targetMemoryId: sourceMemoryId },
      ]),
    },
    select: { sourceMemoryId: true, targetMemoryId: true },
  });
}

export async function createResonanceCandidate(input: {
  userId: string;
  galaxyId: string;
  sourceMemoryId: string;
  targetMemoryId: string;
  score: number;
  reason: string;
}) {
  const prisma = getPrismaClient();
  const pair = normalizeResonancePair(input.sourceMemoryId, input.targetMemoryId);

  try {
    return await prisma.resonanceCandidate.create({
      data: {
        userId: input.userId,
        galaxyId: input.galaxyId,
        sourceMemoryId: pair.sourceMemoryId,
        targetMemoryId: pair.targetMemoryId,
        score: input.score,
        reason: input.reason,
        status: "candidate",
        confirmedAt: null,
        rejectedAt: null,
      },
    });
  } catch (error) {
    if (isUniquePairConflict(error)) {
      return null;
    }

    throw error;
  }
}

function isUniquePairConflict(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

/**
 * Atomically reserves one canonical pair before the caller starts remote I/O.
 * The expired-takeover write repeats every pair scope predicate, so concurrent
 * contenders cannot both become the active lease holder.
 */
export async function tryAcquireResonanceScanLease(input: {
  userId: string;
  galaxyId: string;
  sourceMemoryId: string;
  targetMemoryId: string;
  now?: Date;
}): Promise<{ leaseToken: string } | null> {
  const prisma = getPrismaClient();
  const pair = normalizeResonancePair(input.sourceMemoryId, input.targetMemoryId);
  const now = input.now ?? new Date();
  const leaseToken = randomUUID();
  const expiresAt = new Date(now.getTime() + RESONANCE_SCAN_LEASE_DURATION_MS);
  const leaseScope = {
    userId: input.userId,
    galaxyId: input.galaxyId,
    sourceMemoryId: pair.sourceMemoryId,
    targetMemoryId: pair.targetMemoryId,
  };

  try {
    await prisma.resonanceScanLease.create({
      data: {
        ...leaseScope,
        leaseToken,
        expiresAt,
      },
    });

    return { leaseToken };
  } catch (error) {
    if (!isUniquePairConflict(error)) {
      throw error;
    }
  }

  const takeover = await prisma.resonanceScanLease.updateMany({
    where: {
      ...leaseScope,
      expiresAt: { lte: now },
    },
    data: { leaseToken, expiresAt },
  });

  return takeover.count === 1 ? { leaseToken } : null;
}

export async function releaseResonanceScanLease(input: {
  userId: string;
  galaxyId: string;
  sourceMemoryId: string;
  targetMemoryId: string;
  leaseToken: string;
}) {
  const prisma = getPrismaClient();
  const pair = normalizeResonancePair(input.sourceMemoryId, input.targetMemoryId);

  await prisma.resonanceScanLease.deleteMany({
    where: {
      userId: input.userId,
      galaxyId: input.galaxyId,
      sourceMemoryId: pair.sourceMemoryId,
      targetMemoryId: pair.targetMemoryId,
      leaseToken: input.leaseToken,
    },
  });
}

/**
 * Extends the active scan owner's lease before or during a bounded provider
 * request. This is an atomic ownership check, never a transaction over I/O.
 */
export async function renewResonanceScanLease(input: {
  userId: string;
  galaxyId: string;
  sourceMemoryId: string;
  targetMemoryId: string;
  leaseToken: string;
  now?: Date;
}): Promise<Date | null> {
  const prisma = getPrismaClient();
  const pair = normalizeResonancePair(input.sourceMemoryId, input.targetMemoryId);
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + RESONANCE_SCAN_LEASE_DURATION_MS);
  const renewed = await prisma.resonanceScanLease.updateMany({
    where: {
      userId: input.userId,
      galaxyId: input.galaxyId,
      sourceMemoryId: pair.sourceMemoryId,
      targetMemoryId: pair.targetMemoryId,
      leaseToken: input.leaseToken,
      expiresAt: { gt: now },
    },
    data: { expiresAt },
  });

  return renewed.count === 1 ? expiresAt : null;
}

export async function updateResonanceCandidateDecision(input: {
  userId: string;
  galaxyId: string;
  resonanceId: string;
  version: number;
  status: "confirmed" | "rejected";
  now: Date;
}) {
  const prisma = getPrismaClient();
  const result = await prisma.resonanceCandidate.updateMany({
    where: {
      id: input.resonanceId,
      userId: input.userId,
      galaxyId: input.galaxyId,
      deletedAt: null,
      status: "candidate",
      version: input.version,
    },
    data: {
      status: input.status,
      confirmedAt: input.status === "confirmed" ? input.now : null,
      rejectedAt: input.status === "rejected" ? input.now : null,
      version: { increment: 1 },
    },
  });

  if (result.count !== 1) {
    return null;
  }

  return prisma.resonanceCandidate.findFirst({
    where: {
      id: input.resonanceId,
      userId: input.userId,
      galaxyId: input.galaxyId,
      deletedAt: null,
      status: input.status,
      version: input.version + 1,
    },
  });
}

export async function softDeleteResonanceCandidate(input: {
  userId: string;
  galaxyId: string;
  resonanceCandidateId: string;
  version: number;
  now?: Date;
}) {
  const prisma = getPrismaClient();
  const now = input.now ?? new Date();
  const result = await prisma.resonanceCandidate.updateMany({
    where: {
      id: input.resonanceCandidateId,
      userId: input.userId,
      galaxyId: input.galaxyId,
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
}
