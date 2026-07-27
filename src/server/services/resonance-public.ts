export type PublicResonanceCandidate = {
  id: string;
  sourceMemoryId: string;
  targetMemoryId: string;
  score: number;
  reason: string;
  status: "candidate" | "confirmed" | "rejected";
  confirmedAt: string | null;
  rejectedAt: string | null;
  version: number;
};

type ResonanceCandidateForPublicDto = Omit<PublicResonanceCandidate, "confirmedAt" | "rejectedAt"> & {
  confirmedAt: Date | null;
  rejectedAt: Date | null;
};

export function toPublicResonanceCandidate(
  candidate: ResonanceCandidateForPublicDto,
): PublicResonanceCandidate {
  return {
    id: candidate.id,
    sourceMemoryId: candidate.sourceMemoryId,
    targetMemoryId: candidate.targetMemoryId,
    score: candidate.score,
    reason: candidate.reason,
    status: candidate.status,
    confirmedAt: candidate.confirmedAt?.toISOString() ?? null,
    rejectedAt: candidate.rejectedAt?.toISOString() ?? null,
    version: candidate.version,
  };
}
