import { beforeEach, describe, expect, it, vi } from "vitest";

const { getPrismaClient } = vi.hoisted(() => ({
  getPrismaClient: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  getPrismaClient,
}));

import {
  createResonanceCandidate,
  findActiveResonanceCandidate,
  findEligibleResonanceSource,
  findEligibleResonanceTargets,
  findExistingResonancePairs,
  releaseResonanceScanLease,
  renewResonanceScanLease,
  softDeleteResonanceCandidate,
  tryAcquireResonanceScanLease,
  updateResonanceCandidateDecision,
} from "./resonance-repo";

describe("resonance repo", () => {
  beforeEach(() => {
    getPrismaClient.mockReset();
  });

  it("reads an active resonance candidate only inside the caller's galaxy scope", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "resonance-1" });
    getPrismaClient.mockReturnValue({ resonanceCandidate: { findFirst } });

    await findActiveResonanceCandidate({
      userId: "user-1",
      galaxyId: "galaxy-1",
      resonanceCandidateId: "resonance-1",
    });

    expect(findFirst).toHaveBeenCalledWith({
      where: { id: "resonance-1", userId: "user-1", galaxyId: "galaxy-1", deletedAt: null },
    });
  });

  it("reads a resonance source only when it is confirmed, opted in, and active in the owner galaxy", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "memory-1" });
    getPrismaClient.mockReturnValue({ memory: { findFirst } });

    await findEligibleResonanceSource({
      userId: "user-1",
      galaxyId: "galaxy-1",
      memoryId: "memory-1",
    });

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: "memory-1",
        userId: "user-1",
        galaxyId: "galaxy-1",
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
  });

  it("lists only other confirmed opted-in active memories in the same owner galaxy as resonance targets", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    getPrismaClient.mockReturnValue({ memory: { findMany } });

    await findEligibleResonanceTargets({
      userId: "user-1",
      galaxyId: "galaxy-1",
      sourceMemoryId: "memory-1",
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        galaxyId: "galaxy-1",
        id: { not: "memory-1" },
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
  });

  it("keeps every persisted pair, including a rejected soft-deleted row, from being recreated", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    getPrismaClient.mockReturnValue({ resonanceCandidate: { findMany } });

    await findExistingResonancePairs({
      userId: "user-1",
      galaxyId: "galaxy-1",
      pairs: [{ sourceMemoryId: "memory-a", targetMemoryId: "memory-b" }],
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        galaxyId: "galaxy-1",
        OR: [
          { sourceMemoryId: "memory-a", targetMemoryId: "memory-b" },
          { sourceMemoryId: "memory-b", targetMemoryId: "memory-a" },
        ],
      },
      select: { sourceMemoryId: true, targetMemoryId: true },
    });
  });

  it("normalizes reverse caller input before checking canonical and legacy pair orientations", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    getPrismaClient.mockReturnValue({ resonanceCandidate: { findMany } });

    await findExistingResonancePairs({
      userId: "user-1",
      galaxyId: "galaxy-1",
      pairs: [{ sourceMemoryId: "memory-z", targetMemoryId: "memory-a" }],
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        galaxyId: "galaxy-1",
        OR: [
          { sourceMemoryId: "memory-a", targetMemoryId: "memory-z" },
          { sourceMemoryId: "memory-z", targetMemoryId: "memory-a" },
        ],
      },
      select: { sourceMemoryId: true, targetMemoryId: true },
    });
  });

  it("creates a candidate only with the owner-scoped canonical pair and candidate status", async () => {
    const create = vi.fn().mockResolvedValue({ id: "resonance-1", status: "candidate" });
    getPrismaClient.mockReturnValue({ resonanceCandidate: { create } });

    await createResonanceCandidate({
      userId: "user-1",
      galaxyId: "galaxy-1",
      sourceMemoryId: "memory-a",
      targetMemoryId: "memory-b",
      score: 0.93,
      reason: "两段记忆有清晰联系。",
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        galaxyId: "galaxy-1",
        sourceMemoryId: "memory-a",
        targetMemoryId: "memory-b",
        score: 0.93,
        reason: "两段记忆有清晰联系。",
        status: "candidate",
        confirmedAt: null,
        rejectedAt: null,
      },
    });
  });

  it("normalizes reverse caller input before persisting a candidate", async () => {
    const create = vi.fn().mockResolvedValue({ id: "resonance-1", status: "candidate" });
    getPrismaClient.mockReturnValue({ resonanceCandidate: { create } });

    await createResonanceCandidate({
      userId: "user-1",
      galaxyId: "galaxy-1",
      sourceMemoryId: "memory-z",
      targetMemoryId: "memory-a",
      score: 0.93,
      reason: "两段记忆有清晰联系。",
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceMemoryId: "memory-a",
        targetMemoryId: "memory-z",
      }),
    });
  });

  it("treats a concurrent unique-pair collision as an already-known candidate instead of duplicating it", async () => {
    const create = vi.fn().mockRejectedValue({ code: "P2002" });
    getPrismaClient.mockReturnValue({ resonanceCandidate: { create } });

    await expect(createResonanceCandidate({
      userId: "user-1",
      galaxyId: "galaxy-1",
      sourceMemoryId: "memory-a",
      targetMemoryId: "memory-b",
      score: 0.93,
      reason: "两段记忆有清晰联系。",
    })).resolves.toBeNull();
  });

  it("acquires an unused canonical pair with a sixty-second scan lease", async () => {
    const create = vi.fn().mockResolvedValue({ id: "lease-1" });
    getPrismaClient.mockReturnValue({ resonanceScanLease: { create } });
    const now = new Date("2026-07-19T00:00:00.000Z");

    const acquired = await tryAcquireResonanceScanLease({
      userId: "user-1",
      galaxyId: "galaxy-1",
      sourceMemoryId: "memory-z",
      targetMemoryId: "memory-a",
      now,
    });

    expect(acquired).toEqual({ leaseToken: expect.any(String) });
    expect(create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        galaxyId: "galaxy-1",
        sourceMemoryId: "memory-a",
        targetMemoryId: "memory-z",
        leaseToken: acquired?.leaseToken,
        expiresAt: new Date("2026-07-19T00:01:00.000Z"),
      },
    });
  });

  it("does not take an active scan lease after its unique-pair create collides", async () => {
    const create = vi.fn().mockRejectedValue({ code: "P2002" });
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    getPrismaClient.mockReturnValue({ resonanceScanLease: { create, updateMany } });
    const now = new Date("2026-07-19T00:00:00.000Z");

    await expect(tryAcquireResonanceScanLease({
      userId: "user-1",
      galaxyId: "galaxy-1",
      sourceMemoryId: "memory-a",
      targetMemoryId: "memory-b",
      now,
    })).resolves.toBeNull();

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        galaxyId: "galaxy-1",
        sourceMemoryId: "memory-a",
        targetMemoryId: "memory-b",
        expiresAt: { lte: now },
      },
      data: {
        leaseToken: expect.any(String),
        expiresAt: new Date("2026-07-19T00:01:00.000Z"),
      },
    });
  });

  it("takes over an expired scan lease only through the expiry-guarded update", async () => {
    const create = vi.fn().mockRejectedValue({ code: "P2002" });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    getPrismaClient.mockReturnValue({ resonanceScanLease: { create, updateMany } });
    const now = new Date("2026-07-19T00:00:00.000Z");

    const acquired = await tryAcquireResonanceScanLease({
      userId: "user-1",
      galaxyId: "galaxy-1",
      sourceMemoryId: "memory-a",
      targetMemoryId: "memory-b",
      now,
    });

    expect(acquired).toEqual({ leaseToken: expect.any(String) });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        galaxyId: "galaxy-1",
        sourceMemoryId: "memory-a",
        targetMemoryId: "memory-b",
        expiresAt: { lte: now },
      },
      data: {
        leaseToken: acquired?.leaseToken,
        expiresAt: new Date("2026-07-19T00:01:00.000Z"),
      },
    });
  });

  it("renews a matching nonexpired canonical scan lease", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    getPrismaClient.mockReturnValue({ resonanceScanLease: { updateMany } });
    const now = new Date("2026-07-19T00:00:00.000Z");

    await expect(renewResonanceScanLease({
      userId: "user-1",
      galaxyId: "galaxy-1",
      sourceMemoryId: "memory-z",
      targetMemoryId: "memory-a",
      leaseToken: "active-worker-token",
      now,
    })).resolves.toEqual(new Date("2026-07-19T00:01:00.000Z"));

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        galaxyId: "galaxy-1",
        sourceMemoryId: "memory-a",
        targetMemoryId: "memory-z",
        leaseToken: "active-worker-token",
        expiresAt: { gt: now },
      },
      data: { expiresAt: new Date("2026-07-19T00:01:00.000Z") },
    });
  });

  it.each(["a stale token", "an expired lease"])(
    "does not renew a scan lease held by %s",
    async () => {
      const updateMany = vi.fn().mockResolvedValue({ count: 0 });
      getPrismaClient.mockReturnValue({ resonanceScanLease: { updateMany } });
      const now = new Date("2026-07-19T00:00:00.000Z");

      await expect(renewResonanceScanLease({
        userId: "user-1",
        galaxyId: "galaxy-1",
        sourceMemoryId: "memory-a",
        targetMemoryId: "memory-b",
        leaseToken: "stale-worker-token",
        now,
      })).resolves.toBeNull();

      expect(updateMany).toHaveBeenCalledWith({
        where: {
          userId: "user-1",
          galaxyId: "galaxy-1",
          sourceMemoryId: "memory-a",
          targetMemoryId: "memory-b",
          leaseToken: "stale-worker-token",
          expiresAt: { gt: now },
        },
        data: { expiresAt: new Date("2026-07-19T00:01:00.000Z") },
      });
    },
  );

  it("does not release a scan lease when the caller presents another worker's token", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    getPrismaClient.mockReturnValue({ resonanceScanLease: { deleteMany } });

    await expect(releaseResonanceScanLease({
      userId: "user-1",
      galaxyId: "galaxy-1",
      sourceMemoryId: "memory-z",
      targetMemoryId: "memory-a",
      leaseToken: "wrong-worker-token",
    })).resolves.toBeUndefined();

    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        galaxyId: "galaxy-1",
        sourceMemoryId: "memory-a",
        targetMemoryId: "memory-z",
        leaseToken: "wrong-worker-token",
      },
    });
  });

  it("rejects through a candidate-only owner-scoped optimistic write", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findFirst = vi.fn().mockResolvedValue({ id: "resonance-1", status: "rejected", version: 5 });
    getPrismaClient.mockReturnValue({ resonanceCandidate: { updateMany, findFirst } });
    const now = new Date("2026-07-19T00:00:00.000Z");

    await updateResonanceCandidateDecision({
      userId: "user-1",
      galaxyId: "galaxy-1",
      resonanceId: "resonance-1",
      status: "rejected",
      version: 4,
      now,
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "resonance-1",
        userId: "user-1",
        galaxyId: "galaxy-1",
        deletedAt: null,
        status: "candidate",
        version: 4,
      },
      data: {
        status: "rejected",
        confirmedAt: null,
        rejectedAt: now,
        version: { increment: 1 },
      },
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: "resonance-1",
        userId: "user-1",
        galaxyId: "galaxy-1",
        deletedAt: null,
        status: "rejected",
        version: 5,
      },
    });
  });

  it("soft deletes a candidate with a scope and version guard", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    getPrismaClient.mockReturnValue({ resonanceCandidate: { updateMany } });
    const now = new Date("2026-07-16T00:00:00.000Z");

    await softDeleteResonanceCandidate({
      userId: "user-1",
      galaxyId: "galaxy-1",
      resonanceCandidateId: "resonance-1",
      version: 1,
      now,
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "resonance-1", userId: "user-1", galaxyId: "galaxy-1", deletedAt: null, version: 1 },
      data: {
        deletedAt: now,
        purgeAfter: new Date("2026-08-15T00:00:00.000Z"),
        version: { increment: 1 },
      },
    });
  });
});
