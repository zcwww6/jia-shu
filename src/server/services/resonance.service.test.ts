import { describe, expect, it, vi } from "vitest";

import {
  decideResonanceCandidate,
  scanResonanceCandidates,
  type ResonanceServiceDeps,
} from "./resonance.service";

const scope = { userId: "user-1", galaxyId: "galaxy-1" };

function memory(id: string, embedding: number[]) {
  return {
    id,
    sourceText: `已确认的 ${id} 记忆。`,
    occurredAt: null,
    occurredAtLabel: null,
    locationLabel: null,
    people: null,
    embedding,
  };
}

function unitVector(cosine: number) {
  return [cosine, Math.sqrt(1 - cosine ** 2)];
}

function depsFor(overrides: Partial<ResonanceServiceDeps> = {}): ResonanceServiceDeps {
  return {
    findEligibleSource: vi.fn(),
    findEligibleTargets: vi.fn(),
    findExistingPairs: vi.fn().mockResolvedValue([]),
    createCandidate: vi.fn(async (input) => ({
      id: `resonance-${input.targetMemoryId}`,
      ...input,
      status: "candidate" as const,
      confirmedAt: null,
      rejectedAt: null,
      version: 1,
    })),
    tryAcquireScanLease: vi.fn().mockResolvedValue({ leaseToken: "scan-lease" }),
    releaseScanLease: vi.fn().mockResolvedValue(undefined),
    renewScanLease: vi.fn().mockResolvedValue(new Date("2026-07-19T00:01:00.000Z")),
    findActiveCandidate: vi.fn(),
    updateCandidateDecision: vi.fn(),
    explainResonance: vi.fn().mockResolvedValue({ explanation: "两段已确认记忆有清晰联系。", uncertainFields: [] }),
    ...overrides,
  };
}

describe("resonance service", () => {
  it("ranks compatible embeddings by cosine and creates only the stable top five", async () => {
    const source = memory("memory-00", [1, 0]);
    const targets = [
      memory("memory-91", unitVector(0.91)),
      memory("memory-96", unitVector(0.96)),
      memory("memory-93", unitVector(0.93)),
      memory("memory-95", unitVector(0.95)),
      memory("memory-92", unitVector(0.92)),
      memory("memory-94", unitVector(0.94)),
    ];
    const deps = depsFor({
      findEligibleSource: vi.fn().mockResolvedValue(source),
      findEligibleTargets: vi.fn().mockResolvedValue(targets),
    });

    const candidates = await scanResonanceCandidates(scope, "memory-00", deps);

    expect(candidates.map((candidate) => candidate.targetMemoryId)).toEqual([
      "memory-96",
      "memory-95",
      "memory-94",
      "memory-93",
      "memory-92",
    ]);
    expect(candidates.map((candidate) => candidate.score)).toEqual([
      expect.closeTo(0.96, 8),
      expect.closeTo(0.95, 8),
      expect.closeTo(0.94, 8),
      expect.closeTo(0.93, 8),
      expect.closeTo(0.92, 8),
    ]);
    expect(deps.findEligibleSource).toHaveBeenCalledWith({ ...scope, memoryId: "memory-00" });
    expect(deps.findEligibleTargets).toHaveBeenCalledWith({ ...scope, sourceMemoryId: "memory-00" });
    expect(deps.explainResonance).toHaveBeenCalledTimes(5);
    expect(deps.createCandidate).toHaveBeenCalledTimes(5);
  });

  it("allows only the scan-lease winner to request a resonance explanation for a concurrent pair", async () => {
    const source = memory("memory-a", [1, 0]);
    const target = memory("memory-b", [1, 0]);
    const tryAcquireScanLease = vi.fn()
      .mockResolvedValueOnce({ leaseToken: "scan-lease-1" })
      .mockResolvedValueOnce(null);
    const releaseScanLease = vi.fn().mockResolvedValue(undefined);
    const concurrentDeps = {
      ...depsFor({
        findEligibleSource: vi.fn().mockResolvedValue(source),
        findEligibleTargets: vi.fn().mockResolvedValue([target]),
      }),
      tryAcquireScanLease,
      releaseScanLease,
    };

    await Promise.all([
      scanResonanceCandidates(scope, source.id, concurrentDeps),
      scanResonanceCandidates(scope, source.id, concurrentDeps),
    ]);

    expect(tryAcquireScanLease).toHaveBeenCalledTimes(2);
    expect(concurrentDeps.explainResonance).toHaveBeenCalledTimes(1);
    expect(releaseScanLease).toHaveBeenCalledWith({
      ...scope,
      sourceMemoryId: "memory-a",
      targetMemoryId: "memory-b",
      leaseToken: "scan-lease-1",
    });
  });

  it("rechecks persisted pair history after acquiring a lease that became available", async () => {
    const source = memory("memory-a", [1, 0]);
    const target = memory("memory-b", [1, 0]);
    const persistedPairs: Array<{ sourceMemoryId: string; targetMemoryId: string }> = [];
    let releaseFirstLease!: () => void;
    const firstLeaseReleased = new Promise<void>((resolve) => {
      releaseFirstLease = resolve;
    });
    const tryAcquireScanLease = vi.fn()
      .mockResolvedValueOnce({ leaseToken: "scan-lease-1" })
      .mockImplementationOnce(async () => {
        await firstLeaseReleased;
        return { leaseToken: "scan-lease-2" };
      });
    const releaseScanLease = vi.fn(async ({ leaseToken }: { leaseToken: string }) => {
      if (leaseToken === "scan-lease-1") {
        releaseFirstLease();
      }
    });
    const createCandidate = vi.fn(async (input) => {
      persistedPairs.push({
        sourceMemoryId: input.sourceMemoryId,
        targetMemoryId: input.targetMemoryId,
      });

      return {
        id: "resonance-memory-b",
        ...input,
        status: "candidate" as const,
        confirmedAt: null,
        rejectedAt: null,
        version: 1,
      };
    });
    const concurrentDeps = {
      ...depsFor({
        findEligibleSource: vi.fn().mockResolvedValue(source),
        findEligibleTargets: vi.fn().mockResolvedValue([target]),
        findExistingPairs: vi.fn(async () => [...persistedPairs]),
        createCandidate,
      }),
      tryAcquireScanLease,
      releaseScanLease,
    };

    await Promise.all([
      scanResonanceCandidates(scope, source.id, concurrentDeps),
      scanResonanceCandidates(scope, source.id, concurrentDeps),
    ]);

    expect(tryAcquireScanLease).toHaveBeenCalledTimes(2);
    expect(concurrentDeps.explainResonance).toHaveBeenCalledTimes(1);
    expect(createCandidate).toHaveBeenCalledTimes(1);
    expect(releaseScanLease).toHaveBeenCalledTimes(2);
  });

  it("keeps a pending explanation lease alive so another scan cannot take it after sixty seconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T00:00:00.000Z"));
    const source = memory("memory-a", [1, 0]);
    const target = memory("memory-b", [1, 0]);
    const lease = { token: null as string | null, expiresAt: 0 };
    let nextLease = 0;
    let resolveExplanation: ((value: { explanation: string; uncertainFields: string[] }) => void) | undefined;
    let scanA: Promise<unknown> | undefined;
    let scanB: Promise<unknown> | undefined;
    const pendingExplanation = new Promise<{ explanation: string; uncertainFields: string[] }>((resolve) => {
      resolveExplanation = resolve;
    });
    const tryAcquireScanLease = vi.fn(async () => {
      if (lease.token && lease.expiresAt > Date.now()) {
        return null;
      }

      lease.token = `scan-lease-${++nextLease}`;
      lease.expiresAt = Date.now() + 60_000;
      return { leaseToken: lease.token };
    });
    const renewScanLease = vi.fn(async ({ leaseToken }: { leaseToken: string }) => {
      if (lease.token !== leaseToken || lease.expiresAt <= Date.now()) {
        return null;
      }

      lease.expiresAt = Date.now() + 60_000;
      return new Date(lease.expiresAt);
    });
    const releaseScanLease = vi.fn(async ({ leaseToken }: { leaseToken: string }) => {
      if (lease.token === leaseToken) {
        lease.token = null;
        lease.expiresAt = 0;
      }
    });
    const explainResonance = vi.fn(() => pendingExplanation);
    const deps = {
      ...depsFor({
        findEligibleSource: vi.fn().mockResolvedValue(source),
        findEligibleTargets: vi.fn().mockResolvedValue([target]),
        explainResonance,
      }),
      tryAcquireScanLease,
      renewScanLease,
      releaseScanLease,
    };
    const flushMicrotasks = async () => {
      for (let index = 0; index < 12; index += 1) {
        await Promise.resolve();
      }
    };

    try {
      scanA = scanResonanceCandidates(scope, source.id, deps);
      await flushMicrotasks();
      expect(explainResonance).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(60_001);
      scanB = scanResonanceCandidates(scope, source.id, deps);
      await flushMicrotasks();

      expect(explainResonance).toHaveBeenCalledTimes(1);

      resolveExplanation?.({ explanation: "两段已确认记忆有清晰联系。", uncertainFields: [] });
      await Promise.all([scanA, scanB]);
    } finally {
      resolveExplanation?.({ explanation: "两段已确认记忆有清晰联系。", uncertainFields: [] });
      await Promise.allSettled([scanA, scanB].filter((scan): scan is Promise<unknown> => Boolean(scan)));
      vi.useRealTimers();
    }
  });

  it("does not call the provider when the pre-explanation lease renewal fails", async () => {
    const source = memory("memory-a", [1, 0]);
    const target = memory("memory-b", [1, 0]);
    const renewScanLease = vi.fn().mockResolvedValue(null);
    const deps = {
      ...depsFor({
        findEligibleSource: vi.fn().mockResolvedValue(source),
        findEligibleTargets: vi.fn().mockResolvedValue([target]),
      }),
      renewScanLease,
    };

    await expect(scanResonanceCandidates(scope, source.id, deps)).resolves.toEqual([]);

    expect(renewScanLease).toHaveBeenCalledWith({
      ...scope,
      sourceMemoryId: "memory-a",
      targetMemoryId: "memory-b",
      leaseToken: "scan-lease",
    });
    expect(deps.explainResonance).not.toHaveBeenCalled();
    expect(deps.createCandidate).not.toHaveBeenCalled();
    expect(deps.releaseScanLease).toHaveBeenCalledWith({
      ...scope,
      sourceMemoryId: "memory-a",
      targetMemoryId: "memory-b",
      leaseToken: "scan-lease",
    });
  });

  it("does not persist an explanation when the active lease heartbeat fails", async () => {
    vi.useFakeTimers();
    const source = memory("memory-a", [1, 0]);
    const target = memory("memory-b", [1, 0]);
    let resolveExplanation: ((value: { explanation: string; uncertainFields: string[] }) => void) | undefined;
    const pendingExplanation = new Promise<{ explanation: string; uncertainFields: string[] }>((resolve) => {
      resolveExplanation = resolve;
    });
    const renewScanLease = vi.fn()
      .mockResolvedValueOnce(new Date("2026-07-19T00:01:00.000Z"))
      .mockRejectedValueOnce(new Error("lease renewal unavailable"));
    const deps = {
      ...depsFor({
        findEligibleSource: vi.fn().mockResolvedValue(source),
        findEligibleTargets: vi.fn().mockResolvedValue([target]),
        explainResonance: vi.fn(() => pendingExplanation),
      }),
      renewScanLease,
    };
    const flushMicrotasks = async () => {
      for (let index = 0; index < 12; index += 1) {
        await Promise.resolve();
      }
    };
    let scan: Promise<unknown> | undefined;

    try {
      scan = scanResonanceCandidates(scope, source.id, deps);
      await flushMicrotasks();
      expect(deps.explainResonance).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(20_000);
      await flushMicrotasks();
      resolveExplanation?.({ explanation: "两段已确认记忆有清晰联系。", uncertainFields: [] });

      await expect(scan).resolves.toEqual([]);
      expect(deps.createCandidate).not.toHaveBeenCalled();
    } finally {
      resolveExplanation?.({ explanation: "两段已确认记忆有清晰联系。", uncertainFields: [] });
      await Promise.allSettled(scan ? [scan] : []);
      vi.useRealTimers();
    }
  });

  it("keeps a created candidate when token-scoped lease cleanup fails", async () => {
    const source = memory("memory-a", [1, 0]);
    const target = memory("memory-b", [1, 0]);
    const releaseScanLease = vi.fn().mockRejectedValue(new Error("lease cleanup unavailable"));
    const deps = depsFor({
      findEligibleSource: vi.fn().mockResolvedValue(source),
      findEligibleTargets: vi.fn().mockResolvedValue([target]),
      releaseScanLease,
    });

    await expect(scanResonanceCandidates(scope, source.id, deps)).resolves.toMatchObject([{
      id: "resonance-memory-b",
      sourceMemoryId: "memory-a",
      targetMemoryId: "memory-b",
    }]);

    expect(releaseScanLease).toHaveBeenCalledWith({
      ...scope,
      sourceMemoryId: "memory-a",
      targetMemoryId: "memory-b",
      leaseToken: "scan-lease",
    });
  });

  it("preserves a provider failure when token-scoped lease cleanup also fails", async () => {
    const source = memory("memory-a", [1, 0]);
    const target = memory("memory-b", [1, 0]);
    const providerError = new Error("provider unavailable");
    const releaseScanLease = vi.fn().mockRejectedValue(new Error("lease cleanup unavailable"));
    const deps = depsFor({
      findEligibleSource: vi.fn().mockResolvedValue(source),
      findEligibleTargets: vi.fn().mockResolvedValue([target]),
      explainResonance: vi.fn().mockRejectedValue(providerError),
      releaseScanLease,
    });

    await expect(scanResonanceCandidates(scope, source.id, deps)).rejects.toBe(providerError);

    expect(releaseScanLease).toHaveBeenCalledWith({
      ...scope,
      sourceMemoryId: "memory-a",
      targetMemoryId: "memory-b",
      leaseToken: "scan-lease",
    });
  });

  it("uses only explicit structured intersections for an embedding-free fallback", async () => {
    const source = {
      ...memory("memory-00", []),
      sourceText: "妈妈和我在老家厨房包饺子。",
      occurredAtLabel: "2018 年夏天",
      locationLabel: "老家厨房",
      people: ["妈妈", "我"],
      embedding: null,
    };
    const structuredMatch = {
      ...memory("memory-01", []),
      sourceText: "那次团圆饭的照片。",
      occurredAtLabel: "2018 年夏天",
      locationLabel: "老家厨房",
      people: ["妈妈", "外婆"],
      embedding: null,
    };
    const textOnlyLookalike = {
      ...memory("memory-02", []),
      sourceText: "妈妈和我在老家厨房包饺子。",
      embedding: null,
    };
    const deps = depsFor({
      findEligibleSource: vi.fn().mockResolvedValue(source),
      findEligibleTargets: vi.fn().mockResolvedValue([textOnlyLookalike, structuredMatch]),
    });

    const candidates = await scanResonanceCandidates(scope, source.id, deps);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      sourceMemoryId: source.id,
      targetMemoryId: structuredMatch.id,
      score: 1,
    });
    expect(deps.explainResonance).toHaveBeenCalledTimes(1);
    expect(deps.explainResonance).toHaveBeenCalledWith({
      sourceText: source.sourceText,
      targetText: structuredMatch.sourceText,
    });
  });

  it("does not use the fallback when either memory lacks any required structured field", async () => {
    const source = {
      ...memory("memory-00", []),
      occurredAtLabel: "2018 年夏天",
      locationLabel: "老家厨房",
      people: [],
      embedding: null,
    };
    const target = {
      ...memory("memory-01", []),
      occurredAtLabel: "2018 年夏天",
      locationLabel: "老家厨房",
      people: ["妈妈"],
      embedding: null,
    };
    const deps = depsFor({
      findEligibleSource: vi.fn().mockResolvedValue(source),
      findEligibleTargets: vi.fn().mockResolvedValue([target]),
    });

    await expect(scanResonanceCandidates(scope, source.id, deps)).resolves.toEqual([]);
    expect(deps.explainResonance).not.toHaveBeenCalled();
    expect(deps.createCandidate).not.toHaveBeenCalled();
  });

  it("normalizes an undirected pair and never recreates a previously rejected pair", async () => {
    const source = memory("memory-z", [1, 0]);
    const target = memory("memory-a", [1, 0]);
    const deps = depsFor({
      findEligibleSource: vi.fn().mockResolvedValue(source),
      findEligibleTargets: vi.fn().mockResolvedValue([target]),
      // The repository includes all prior statuses, including rejected rows.
      findExistingPairs: vi.fn().mockResolvedValue([{
        sourceMemoryId: "memory-a",
        targetMemoryId: "memory-z",
      }]),
    });

    const candidates = await scanResonanceCandidates(scope, source.id, deps);

    expect(deps.findExistingPairs).toHaveBeenCalledWith({
      ...scope,
      pairs: [{ sourceMemoryId: "memory-a", targetMemoryId: "memory-z" }],
    });
    expect(candidates).toEqual([]);
    expect(deps.explainResonance).not.toHaveBeenCalled();
    expect(deps.createCandidate).not.toHaveBeenCalled();
  });

  it("treats a legacy reverse-orientation pair as already decided", async () => {
    const source = memory("memory-z", [1, 0]);
    const target = memory("memory-a", [1, 0]);
    const deps = depsFor({
      findEligibleSource: vi.fn().mockResolvedValue(source),
      findEligibleTargets: vi.fn().mockResolvedValue([target]),
      findExistingPairs: vi.fn().mockResolvedValue([{
        sourceMemoryId: "memory-z",
        targetMemoryId: "memory-a",
      }]),
    });

    await expect(scanResonanceCandidates(scope, source.id, deps)).resolves.toEqual([]);

    expect(deps.explainResonance).not.toHaveBeenCalled();
    expect(deps.createCandidate).not.toHaveBeenCalled();
  });

  it("applies an administrator rejection through the owner-scoped optimistic decision write", async () => {
    const pending = {
      id: "resonance-1",
      sourceMemoryId: "memory-a",
      targetMemoryId: "memory-b",
      score: 0.9,
      reason: "两段记忆有清晰联系。",
      status: "candidate" as const,
      confirmedAt: null,
      rejectedAt: null,
      version: 4,
    };
    const rejectedAt = new Date("2026-07-19T00:00:00.000Z");
    const deps = depsFor({
      findActiveCandidate: vi.fn().mockResolvedValue(pending),
      updateCandidateDecision: vi.fn().mockResolvedValue({
        ...pending,
        status: "rejected" as const,
        rejectedAt,
        version: 5,
      }),
    });

    const result = await decideResonanceCandidate(scope, pending.id, {
      status: "rejected",
      version: 4,
    }, deps, rejectedAt);

    expect(deps.findActiveCandidate).toHaveBeenCalledWith({ ...scope, resonanceId: pending.id });
    expect(deps.updateCandidateDecision).toHaveBeenCalledWith({
      ...scope,
      resonanceId: pending.id,
      status: "rejected",
      version: 4,
      now: rejectedAt,
    });
    expect(result).toMatchObject({ status: "rejected", version: 5, rejectedAt });
  });
});
