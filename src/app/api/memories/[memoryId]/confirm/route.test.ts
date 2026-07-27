import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/server/domain-error";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
const { resolvePersonalGalaxyScope } = vi.hoisted(() => ({ resolvePersonalGalaxyScope: vi.fn() }));
const { confirmTextMemory } = vi.hoisted(() => ({ confirmTextMemory: vi.fn() }));

vi.mock("@/auth", () => ({ auth }));
vi.mock("@/server/db/galaxy-repo", () => ({ resolvePersonalGalaxyScope }));
vi.mock("@/server/services/memory.service", () => ({ confirmTextMemory }));

import { POST } from "./route";

const memoryId = "ck8m3x8xy000000000000001";
const context = { params: Promise.resolve({ memoryId }) };

function request(body: unknown, headers: HeadersInit = {}) {
  return new Request(`http://localhost/api/memories/${memoryId}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/memories/[memoryId]/confirm", () => {
  beforeEach(() => {
    auth.mockReset();
    resolvePersonalGalaxyScope.mockReset();
    confirmTextMemory.mockReset();
  });

  it("rejects unauthenticated confirmation before scope resolution", async () => {
    auth.mockResolvedValue(null);

    const response = await POST(request({ version: 1 }), context);

    expect(response.status).toBe(401);
    expect(resolvePersonalGalaxyScope).not.toHaveBeenCalled();
    expect(confirmTextMemory).not.toHaveBeenCalled();
  });

  it("only accepts strict structured fields and never a browser-confirmed status", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });

    const response = await POST(request({ version: 1, status: "confirmed" }), context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "MEMORY_CONFIRMATION_INVALID" });
    expect(confirmTextMemory).not.toHaveBeenCalled();
  });

  it("confirms a needs-confirmation draft inside the authenticated personal scope", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    confirmTextMemory.mockResolvedValue({
      id: memoryId,
      status: "confirmed",
      confirmedAt: "2026-07-17T00:00:00.000Z",
      version: 2,
      title: "新家的晚上",
    });

    const response = await POST(request({
      version: 1,
      title: "新家的晚上",
      summary: "全家第一次在新家吃晚饭。",
      tags: ["新家", "晚饭"],
      occurredAtLabel: "2018 年夏天",
      locationLabel: "老家厨房",
      people: ["妈妈", "我"],
    }), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "confirmed", version: 2 });
    expect(confirmTextMemory).toHaveBeenCalledWith(
      { userId: "user-1", galaxyId: "galaxy-1" },
      memoryId,
      {
        version: 1,
        title: "新家的晚上",
        summary: "全家第一次在新家吃晚饭。",
        tags: ["新家", "晚饭"],
        occurredAtLabel: "2018 年夏天",
        locationLabel: "老家厨房",
        people: ["妈妈", "我"],
      },
    );
  });

  it("returns one not-found response for a foreign memory and preserves version conflicts", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    confirmTextMemory.mockRejectedValueOnce(new DomainError("MEMORY_NOT_FOUND", 404, "记忆不存在或无权访问。"));

    const foreign = await POST(request({ version: 1 }), context);
    expect(foreign.status).toBe(404);
    await expect(foreign.json()).resolves.toMatchObject({ code: "MEMORY_NOT_FOUND" });

    confirmTextMemory.mockRejectedValueOnce(new DomainError("VERSION_CONFLICT", 409, "这条记忆已在另一处更新，请刷新后重试。"));
    const stale = await POST(request({ version: 1 }), context);
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ code: "VERSION_CONFLICT" });
  });
});
