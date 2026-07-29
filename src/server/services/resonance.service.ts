import { getAiProvider } from "@/server/ai/openai-client";
import {
  createResonanceCandidate,
  findActiveResonanceCandidate,
  findEligibleResonanceSource,
  findEligibleResonanceTargets,
  findExistingResonancePairs,
  releaseResonanceScanLease,
  renewResonanceScanLease,
  tryAcquireResonanceScanLease,
  updateResonanceCandidateDecision,
} from "@/server/db/resonance-repo";
import {
  normalizeResonancePair,
  type ResonancePair,
} from "@/server/domain/resonance-pair";
import { DomainError } from "@/server/domain-error";

export { normalizeResonancePair } from "@/server/domain/resonance-pair";
export type { ResonancePair } from "@/server/domain/resonance-pair";

export const MAX_RESONANCE_CANDIDATES_PER_SCAN = 5;
export const MIN_EMBEDDING_COSINE_SCORE = 0.8;
export const MIN_STRUCTURED_FALLBACK_SCORE = 1;
export const RESONANCE_SCAN_LEASE_HEARTBEAT_INTERVAL_MS = 20_000;

export type ResonanceMemoryRecord = {
  id: string;
  sourceText: string;
  occurredAt: Date | null;
  occurredAtLabel: string | null;
  locationLabel: string | null;
  people: unknown;
  embedding: unknown;
};

export type ResonanceCandidateRecord = ResonancePair & {
  id: string;
  score: number;
  reason: string;
  status: "candidate" | "confirmed" | "rejected";
  confirmedAt: Date | null;
  rejectedAt: Date | null;
  version: number;
};

export interface ResonanceServiceDeps {
  findEligibleSource(input: {
    userId: string;
    galaxyId: string;
    memoryId: string;
  }): Promise<ResonanceMemoryRecord | null>;
  findEligibleTargets(input: {
    userId: string;
    galaxyId: string;
    sourceMemoryId: string;
  }): Promise<ResonanceMemoryRecord[]>;
  findExistingPairs(input: {
    userId: string;
    galaxyId: string;
    pairs: ResonancePair[];
  }): Promise<ResonancePair[]>;
  createCandidate(input: {
    userId: string;
    galaxyId: string;
    sourceMemoryId: string;
    targetMemoryId: string;
    score: number;
    reason: string;
  }): Promise<ResonanceCandidateRecord | null>;
  tryAcquireScanLease(input: {
    userId: string;
    galaxyId: string;
    sourceMemoryId: string;
    targetMemoryId: string;
  }): Promise<{ leaseToken: string } | null>;
  releaseScanLease(input: {
    userId: string;
    galaxyId: string;
    sourceMemoryId: string;
    targetMemoryId: string;
    leaseToken: string;
  }): Promise<void>;
  renewScanLease(input: {
    userId: string;
    galaxyId: string;
    sourceMemoryId: string;
    targetMemoryId: string;
    leaseToken: string;
  }): Promise<Date | null>;
  findActiveCandidate(input: {
    userId: string;
    galaxyId: string;
    resonanceId: string;
  }): Promise<ResonanceCandidateRecord | null>;
  updateCandidateDecision(input: {
    userId: string;
    galaxyId: string;
    resonanceId: string;
    version: number;
    status: "confirmed" | "rejected";
    now: Date;
  }): Promise<ResonanceCandidateRecord | null>;
  explainResonance(input: {
    sourceText: string;
    targetText: string;
  }): Promise<{ explanation: string; uncertainFields: string[] }>;
}

const defaultDeps: ResonanceServiceDeps = {
  findEligibleSource: findEligibleResonanceSource,
  findEligibleTargets: findEligibleResonanceTargets,
  findExistingPairs: findExistingResonancePairs,
  createCandidate: createResonanceCandidate,
  tryAcquireScanLease: tryAcquireResonanceScanLease,
  releaseScanLease: releaseResonanceScanLease,
  renewScanLease: renewResonanceScanLease,
  findActiveCandidate: async (input) => findActiveResonanceCandidate({
    userId: input.userId,
    galaxyId: input.galaxyId,
    resonanceCandidateId: input.resonanceId,
  }),
  updateCandidateDecision: updateResonanceCandidateDecision,
  explainResonance: async (input) => getAiProvider().explainResonance(input),
};

type ResonanceScope = {
  userId: string;
  galaxyId: string;
};

type ScoredPair = ResonancePair & {
  score: number;
  source: ResonanceMemoryRecord;
  target: ResonanceMemoryRecord;
};

/**
 * Scans one already-confirmed, opted-in Memory. This service deliberately
 * delegates only short database reads/writes to its repository; the remote AI
 * explanation runs between those operations and never inside a transaction.
 */
export async function scanResonanceCandidates(
  scope: ResonanceScope,
  memoryId: string,
  deps: ResonanceServiceDeps = defaultDeps,
): Promise<ResonanceCandidateRecord[]> {
  const source = await deps.findEligibleSource({ ...scope, memoryId });

  if (!source) {
    throw resonanceSourceNotFound();
  }

  const targets = await deps.findEligibleTargets({ ...scope, sourceMemoryId: source.id });
  const scored = targets
    .filter((target) => target.id !== source.id)
    .map((target) => scorePair(source, target))
    .filter((candidate): candidate is ScoredPair => candidate !== null)
    .sort(compareScoredPairs);
  const existing = await deps.findExistingPairs({
    ...scope,
    pairs: scored.map(({ sourceMemoryId, targetMemoryId }) => ({ sourceMemoryId, targetMemoryId })),
  });
  const existingKeys = new Set(existing.map((pair) => pairKey(
    normalizeResonancePair(pair.sourceMemoryId, pair.targetMemoryId),
  )));
  const candidates = scored
    .filter((candidate) => !existingKeys.has(pairKey(candidate)))
    .slice(0, MAX_RESONANCE_CANDIDATES_PER_SCAN);
  const created: ResonanceCandidateRecord[] = [];

  for (const candidate of candidates) {
    const lease = await deps.tryAcquireScanLease({
      ...scope,
      sourceMemoryId: candidate.sourceMemoryId,
      targetMemoryId: candidate.targetMemoryId,
    });

    if (!lease) {
      continue;
    }

    try {
      const existingAfterLease = await deps.findExistingPairs({
        ...scope,
        pairs: [{
          sourceMemoryId: candidate.sourceMemoryId,
          targetMemoryId: candidate.targetMemoryId,
        }],
      });

      if (existingAfterLease.length > 0) {
        continue;
      }

      const leaseInput = {
        ...scope,
        sourceMemoryId: candidate.sourceMemoryId,
        targetMemoryId: candidate.targetMemoryId,
        leaseToken: lease.leaseToken,
      };
      const renewedLease = await deps.renewScanLease(leaseInput);

      if (!renewedLease) {
        continue;
      }

      let ownsLease = true;
      let renewalInFlight: Promise<void> | null = null;
      const renewHeartbeat = () => {
        if (renewalInFlight) {
          return;
        }

        renewalInFlight = (async () => {
          try {
            const renewed = await deps.renewScanLease(leaseInput);
            if (!renewed) {
              ownsLease = false;
            }
          } catch {
            ownsLease = false;
          } finally {
            renewalInFlight = null;
          }
        })();
      };
      const heartbeat = setInterval(renewHeartbeat, RESONANCE_SCAN_LEASE_HEARTBEAT_INTERVAL_MS);

      let explanation: { explanation: string; uncertainFields: string[] };

      try {
        explanation = await deps.explainResonance({
          sourceText: candidate.source.sourceText,
          targetText: candidate.target.sourceText,
        });
      } finally {
        clearInterval(heartbeat);
      }

      await renewalInFlight;

      if (!ownsLease) {
        continue;
      }

      const reason = validReason(explanation.explanation);
      const persisted = await deps.createCandidate({
        ...scope,
        sourceMemoryId: candidate.sourceMemoryId,
        targetMemoryId: candidate.targetMemoryId,
        score: candidate.score,
        reason,
      });

      if (persisted) {
        created.push(persisted);
      }
    } finally {
      try {
        await deps.releaseScanLease({
          ...scope,
          sourceMemoryId: candidate.sourceMemoryId,
          targetMemoryId: candidate.targetMemoryId,
          leaseToken: lease.leaseToken,
        });
      } catch {
        // Cleanup is best effort; expiry remains the recovery path and must
        // not replace a candidate result or the primary provider failure.
      }
    }
  }

  return created;
}

export async function decideResonanceCandidate(
  scope: ResonanceScope,
  resonanceId: string,
  input: { status: "confirmed" | "rejected"; version: number },
  deps: ResonanceServiceDeps = defaultDeps,
  now = new Date(),
): Promise<ResonanceCandidateRecord> {
  const candidate = await deps.findActiveCandidate({ ...scope, resonanceId });

  if (!candidate) {
    throw resonanceNotFound();
  }

  if (candidate.status !== "candidate") {
    throw new DomainError("RESONANCE_NOT_PENDING", 409, "这条共鸣候选已处理，请刷新后重试。");
  }

  const updated = await deps.updateCandidateDecision({
    ...scope,
    resonanceId,
    status: input.status,
    version: input.version,
    now,
  });

  if (!updated) {
    throw new DomainError("VERSION_CONFLICT", 409, "共鸣候选已在另一处更新，请刷新后重试。");
  }

  return updated;
}

function scorePair(source: ResonanceMemoryRecord, target: ResonanceMemoryRecord): ScoredPair | null {
  const pair = normalizeResonancePair(source.id, target.id);
  const embeddingScore = cosineSimilarity(source.embedding, target.embedding);

  if (embeddingScore !== null) {
    return embeddingScore >= MIN_EMBEDDING_COSINE_SCORE
      ? { ...pair, score: embeddingScore, source, target }
      : null;
  }

  const fallbackScore = structuredFallbackScore(source, target);

  return fallbackScore !== null
    ? { ...pair, score: fallbackScore, source, target }
    : null;
}

function compareScoredPairs(left: ScoredPair, right: ScoredPair) {
  return right.score - left.score
    || left.sourceMemoryId.localeCompare(right.sourceMemoryId)
    || left.targetMemoryId.localeCompare(right.targetMemoryId);
}

function cosineSimilarity(leftValue: unknown, rightValue: unknown): number | null {
  const left = numericVector(leftValue);
  const right = numericVector(rightValue);

  if (!left || !right || left.length !== right.length) {
    return null;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftEntry = left[index] as number;
    const rightEntry = right[index] as number;
    dot += leftEntry * rightEntry;
    leftMagnitude += leftEntry ** 2;
    rightMagnitude += rightEntry ** 2;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return null;
  }

  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

function numericVector(value: unknown): number[] | null {
  return Array.isArray(value)
    && value.length > 0
    && value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
    ? value
    : null;
}

function structuredFallbackScore(source: ResonanceMemoryRecord, target: ResonanceMemoryRecord): number | null {
  const timeMatches = hasIntersection(timeSignals(source), timeSignals(target));
  const locationMatches = hasIntersection(
    stringSignal(source.locationLabel),
    stringSignal(target.locationLabel),
  );
  const peopleMatches = hasIntersection(peopleSignals(source.people), peopleSignals(target.people));

  if (!timeMatches || !locationMatches || !peopleMatches) {
    return null;
  }

  const score = 1;

  return score >= MIN_STRUCTURED_FALLBACK_SCORE ? score : null;
}

function timeSignals(memory: Pick<ResonanceMemoryRecord, "occurredAt" | "occurredAtLabel">) {
  const signals = new Set<string>();

  if (memory.occurredAt instanceof Date && Number.isFinite(memory.occurredAt.getTime())) {
    signals.add(`date:${memory.occurredAt.toISOString().slice(0, 10)}`);
  }

  for (const label of stringSignal(memory.occurredAtLabel)) {
    signals.add(`label:${label}`);
  }

  return signals;
}

function stringSignal(value: string | null) {
  const normalized = normalizeSignal(value);
  return normalized ? new Set([normalized]) : new Set<string>();
}

function peopleSignals(value: unknown) {
  if (!Array.isArray(value) || !value.every((person) => typeof person === "string")) {
    return new Set<string>();
  }

  return new Set(value.map(normalizeSignal).filter((person): person is string => Boolean(person)));
}

function normalizeSignal(value: string | null | undefined) {
  const normalized = value?.trim().toLocaleLowerCase();
  return normalized || null;
}

function hasIntersection(left: Set<string>, right: Set<string>) {
  return [...left].some((value) => right.has(value));
}

function pairKey(pair: ResonancePair) {
  return `${pair.sourceMemoryId}\u0000${pair.targetMemoryId}`;
}

function validReason(value: string) {
  const reason = value.trim();

  if (!reason || reason.length > 2_000) {
    throw new DomainError("AI_PROVIDER_RESPONSE_INVALID", 502, "智能整理返回内容无法处理，请稍后重试。");
  }

  return reason;
}

function resonanceSourceNotFound() {
  return new DomainError("MEMORY_NOT_FOUND", 404, "记忆不存在、尚未确认或未授权共鸣。");
}

function resonanceNotFound() {
  return new DomainError("RESONANCE_NOT_FOUND", 404, "共鸣候选不存在或无权访问。");
}
