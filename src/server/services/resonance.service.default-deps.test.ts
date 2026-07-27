import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/server/domain-error";

const { getAiProvider } = vi.hoisted(() => ({ getAiProvider: vi.fn() }));
const {
  findEligibleResonanceSource,
  findEligibleResonanceTargets,
  findExistingResonancePairs,
  createResonanceCandidate,
  releaseResonanceScanLease,
  renewResonanceScanLease,
  tryAcquireResonanceScanLease,
  findActiveResonanceCandidate,
  updateResonanceCandidateDecision,
} = vi.hoisted(() => ({
  findEligibleResonanceSource: vi.fn(),
  findEligibleResonanceTargets: vi.fn(),
  findExistingResonancePairs: vi.fn(),
  createResonanceCandidate: vi.fn(),
  releaseResonanceScanLease: vi.fn(),
  renewResonanceScanLease: vi.fn(),
  tryAcquireResonanceScanLease: vi.fn(),
  findActiveResonanceCandidate: vi.fn(),
  updateResonanceCandidateDecision: vi.fn(),
}));

vi.mock("@/server/ai/openai-client", () => ({ getAiProvider }));
vi.mock("@/server/db/resonance-repo", () => ({
  findEligibleResonanceSource,
  findEligibleResonanceTargets,
  findExistingResonancePairs,
  createResonanceCandidate,
  releaseResonanceScanLease,
  renewResonanceScanLease,
  tryAcquireResonanceScanLease,
  findActiveResonanceCandidate,
  updateResonanceCandidateDecision,
}));

import { scanResonanceCandidates } from "./resonance.service";

const scope = { userId: "user-1", galaxyId: "galaxy-1" };

describe("resonance service default dependencies", () => {
  beforeEach(() => {
    getAiProvider.mockReset();
    findEligibleResonanceSource.mockReset();
    findEligibleResonanceTargets.mockReset();
    findExistingResonancePairs.mockReset();
    createResonanceCandidate.mockReset();
    releaseResonanceScanLease.mockReset();
    renewResonanceScanLease.mockReset();
    tryAcquireResonanceScanLease.mockReset();
    findActiveResonanceCandidate.mockReset();
    updateResonanceCandidateDecision.mockReset();
  });

  it("surfaces an unconfigured AI explanation as a real 503 and never fabricates a candidate reason", async () => {
    const explainResonance = vi.fn().mockRejectedValue(new DomainError("AI_NOT_CONFIGURED", 503, "AI 功能尚未配置。"));
    getAiProvider.mockReturnValue({
      extractMemory: vi.fn(),
      describeImage: vi.fn(),
      transcribeAudio: vi.fn(),
      embed: vi.fn(),
      explainResonance,
      generateBook: vi.fn(),
    });
    findEligibleResonanceSource.mockResolvedValue({
      id: "memory-1",
      sourceText: "第一次搬进新家的晚上。",
      occurredAt: null,
      occurredAtLabel: null,
      locationLabel: null,
      people: null,
      embedding: [1, 0],
    });
    findEligibleResonanceTargets.mockResolvedValue([{
      id: "memory-2",
      sourceText: "全家第一次在新家吃晚饭。",
      occurredAt: null,
      occurredAtLabel: null,
      locationLabel: null,
      people: null,
      embedding: [1, 0],
    }]);
    findExistingResonancePairs.mockResolvedValue([]);
    tryAcquireResonanceScanLease.mockResolvedValue({ leaseToken: "scan-lease" });
    releaseResonanceScanLease.mockResolvedValue(undefined);
    renewResonanceScanLease.mockResolvedValue(new Date("2026-07-19T00:01:00.000Z"));

    await expect(scanResonanceCandidates(scope, "memory-1"))
      .rejects.toMatchObject({ code: "AI_NOT_CONFIGURED", status: 503 });
    expect(explainResonance).toHaveBeenCalledTimes(1);
    expect(createResonanceCandidate).not.toHaveBeenCalled();
  });
});
