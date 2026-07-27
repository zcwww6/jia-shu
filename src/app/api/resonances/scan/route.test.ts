import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/server/domain-error";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
const { resolvePersonalGalaxyScope } = vi.hoisted(() => ({ resolvePersonalGalaxyScope: vi.fn() }));
const { scanResonanceCandidates } = vi.hoisted(() => ({ scanResonanceCandidates: vi.fn() }));

vi.mock("@/auth", () => ({ auth }));
vi.mock("@/server/db/galaxy-repo", () => ({ resolvePersonalGalaxyScope }));
vi.mock("@/server/services/resonance.service", () => ({ scanResonanceCandidates }));

import { POST } from "./route";

const memoryId = "ck8m3x8xy000000000000001";

function request(body: unknown) {
  return new Request("http://localhost/api/resonances/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/resonances/scan", () => {
  beforeEach(() => {
    auth.mockReset();
    resolvePersonalGalaxyScope.mockReset();
    scanResonanceCandidates.mockReset();
  });

  it("rejects an unauthenticated scan before it resolves a galaxy or calls the service", async () => {
    auth.mockResolvedValue(null);

    const response = await POST(request({ memoryId }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(resolvePersonalGalaxyScope).not.toHaveBeenCalled();
    expect(scanResonanceCandidates).not.toHaveBeenCalled();
  });

  it("rejects malformed or browser-supplied resonance scoring fields", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });

    const response = await POST(request({ memoryId, score: 1, reason: "浏览器不能写入候选" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "RESONANCE_SCAN_INVALID" });
    expect(scanResonanceCandidates).not.toHaveBeenCalled();
  });

  it("scans only in the authenticated personal galaxy and serializes the public candidate DTO", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    scanResonanceCandidates.mockResolvedValue([{
      id: "resonance-1",
      sourceMemoryId: "memory-a",
      targetMemoryId: "memory-b",
      score: 0.91,
      reason: "两段记忆有清晰联系。",
      status: "candidate",
      confirmedAt: null,
      rejectedAt: null,
      version: 1,
      userId: "user-1",
      galaxyId: "galaxy-1",
      deletedAt: new Date("2026-07-01T00:00:00.000Z"),
      purgeAfter: new Date("2026-07-31T00:00:00.000Z"),
      createdAt: new Date("2026-06-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-01T00:00:00.000Z"),
      sourceMemory: { sourceText: "不应暴露的原始记忆" },
    }]);

    const response = await POST(request({ memoryId }));

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body).toEqual({
      candidates: [{
        id: "resonance-1",
        sourceMemoryId: "memory-a",
        targetMemoryId: "memory-b",
        score: 0.91,
        reason: "两段记忆有清晰联系。",
        status: "candidate",
        confirmedAt: null,
        rejectedAt: null,
        version: 1,
      }],
    });
    expect(body.candidates[0]).not.toHaveProperty("userId");
    expect(body.candidates[0]).not.toHaveProperty("galaxyId");
    expect(body.candidates[0]).not.toHaveProperty("deletedAt");
    expect(body.candidates[0]).not.toHaveProperty("purgeAfter");
    expect(body.candidates[0]).not.toHaveProperty("sourceMemory");
    expect(scanResonanceCandidates).toHaveBeenCalledWith(
      { userId: "user-1", galaxyId: "galaxy-1" },
      memoryId,
    );
  });

  it("preserves an AI configuration failure instead of returning a made-up reason", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    scanResonanceCandidates.mockRejectedValue(new DomainError("AI_NOT_CONFIGURED", 503, "AI 功能尚未配置。"));

    const response = await POST(request({ memoryId }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ code: "AI_NOT_CONFIGURED", message: "AI 功能尚未配置。" });
  });
});
