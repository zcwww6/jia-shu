import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/server/domain-error";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
const { resolvePersonalGalaxyScope } = vi.hoisted(() => ({ resolvePersonalGalaxyScope: vi.fn() }));
const { decideResonanceCandidate } = vi.hoisted(() => ({ decideResonanceCandidate: vi.fn() }));

vi.mock("@/auth", () => ({ auth }));
vi.mock("@/server/db/galaxy-repo", () => ({ resolvePersonalGalaxyScope }));
vi.mock("@/server/services/resonance.service", () => ({ decideResonanceCandidate }));

import { POST } from "./route";

const resonanceId = "ck8m3x8xy000000000000002";
const context = { params: Promise.resolve({ resonanceId }) };

function request(body: unknown, headers: HeadersInit = {}) {
  return new Request(`http://localhost/api/resonances/${resonanceId}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/resonances/[resonanceId]/confirm", () => {
  beforeEach(() => {
    auth.mockReset();
    resolvePersonalGalaxyScope.mockReset();
    decideResonanceCandidate.mockReset();
  });

  it("rejects an unauthenticated decision before scope resolution", async () => {
    auth.mockResolvedValue(null);

    const response = await POST(request({ version: 1, status: "confirmed" }), context);

    expect(response.status).toBe(401);
    expect(resolvePersonalGalaxyScope).not.toHaveBeenCalled();
    expect(decideResonanceCandidate).not.toHaveBeenCalled();
  });

  it("requires an explicit candidate decision status and optimistic version", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });

    const response = await POST(request({ version: 1, status: "candidate" }), context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "RESONANCE_DECISION_INVALID" });
    expect(decideResonanceCandidate).not.toHaveBeenCalled();
  });

  it("submits a rejection inside the authenticated owner scope with only the public DTO", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    decideResonanceCandidate.mockResolvedValue({
      id: resonanceId,
      sourceMemoryId: "memory-a",
      targetMemoryId: "memory-b",
      score: 0.91,
      reason: "两段记忆有清晰联系。",
      status: "rejected",
      confirmedAt: null,
      rejectedAt: new Date("2026-07-19T00:00:00.000Z"),
      version: 2,
      userId: "user-1",
      galaxyId: "galaxy-1",
      deletedAt: new Date("2026-07-20T00:00:00.000Z"),
      purgeAfter: new Date("2026-08-19T00:00:00.000Z"),
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-19T00:00:00.000Z"),
      targetMemory: { sourceText: "不应暴露的原始记忆" },
    });

    const response = await POST(request({ version: 1, status: "rejected" }), context);

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body).toEqual({
      id: resonanceId,
      sourceMemoryId: "memory-a",
      targetMemoryId: "memory-b",
      score: 0.91,
      reason: "两段记忆有清晰联系。",
      status: "rejected",
      confirmedAt: null,
      rejectedAt: "2026-07-19T00:00:00.000Z",
      version: 2,
    });
    expect(body).not.toHaveProperty("userId");
    expect(body).not.toHaveProperty("galaxyId");
    expect(body).not.toHaveProperty("deletedAt");
    expect(body).not.toHaveProperty("purgeAfter");
    expect(body).not.toHaveProperty("targetMemory");
    expect(decideResonanceCandidate).toHaveBeenCalledWith(
      { userId: "user-1", galaxyId: "galaxy-1" },
      resonanceId,
      { version: 1, status: "rejected" },
    );
  });

  it("uses the same not-found response for a foreign candidate and preserves version conflicts", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    decideResonanceCandidate.mockRejectedValueOnce(new DomainError("RESONANCE_NOT_FOUND", 404, "共鸣候选不存在或无权访问。"));

    const foreign = await POST(request({ version: 1, status: "confirmed" }), context);
    expect(foreign.status).toBe(404);
    await expect(foreign.json()).resolves.toMatchObject({ code: "RESONANCE_NOT_FOUND" });

    decideResonanceCandidate.mockRejectedValueOnce(new DomainError("VERSION_CONFLICT", 409, "共鸣候选已在另一处更新，请刷新后重试。"));
    const stale = await POST(request({ version: 1, status: "confirmed" }), context);
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ code: "VERSION_CONFLICT" });
  });
});
