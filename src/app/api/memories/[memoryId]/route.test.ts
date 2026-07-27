import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/server/domain-error";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
const { resolvePersonalGalaxyScope } = vi.hoisted(() => ({ resolvePersonalGalaxyScope: vi.fn() }));
const { updateTextMemoryDraft, getMemoryReview } = vi.hoisted(() => ({ updateTextMemoryDraft: vi.fn(), getMemoryReview: vi.fn() }));

vi.mock("@/auth", () => ({ auth }));
vi.mock("@/server/db/galaxy-repo", () => ({ resolvePersonalGalaxyScope }));
vi.mock("@/server/services/memory.service", () => ({ updateTextMemoryDraft, getMemoryReview }));

import { GET, PATCH } from "./route";

const memoryId = "ck8m3x8xy000000000000001";
const context = { params: Promise.resolve({ memoryId }) };

function request(body: unknown, headers: HeadersInit = {}) {
  return new Request(`http://localhost/api/memories/${memoryId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/memories/[memoryId]", () => {
  beforeEach(() => {
    auth.mockReset();
    resolvePersonalGalaxyScope.mockReset();
    updateTextMemoryDraft.mockReset();
    getMemoryReview.mockReset();
  });

  it("rejects an unauthenticated patch before looking up scope", async () => {
    auth.mockResolvedValue(null);

    const response = await PATCH(request({ version: 1, title: "草稿" }), context);

    expect(response.status).toBe(401);
    expect(resolvePersonalGalaxyScope).not.toHaveBeenCalled();
    expect(updateTextMemoryDraft).not.toHaveBeenCalled();
  });

  it("accepts If-Match-Version for a scoped draft patch", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    updateTextMemoryDraft.mockResolvedValue({ id: memoryId, title: "新草稿", status: "draft", version: 2 });

    const response = await PATCH(request({
      title: "新草稿",
      locationLabel: "老家厨房",
      people: ["妈妈", "我"],
    }, { "If-Match-Version": "1" }), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: memoryId, status: "draft", version: 2 });
    expect(updateTextMemoryDraft).toHaveBeenCalledWith(
      { userId: "user-1", galaxyId: "galaxy-1" },
      memoryId,
      {
        version: 1,
        title: "新草稿",
        locationLabel: "老家厨房",
        people: ["妈妈", "我"],
      },
    );
  });

  it("rejects a browser-supplied status before it reaches the draft service", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });

    const response = await PATCH(request({ version: 1, title: "冒充确认", status: "confirmed" }), context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "MEMORY_INPUT_INVALID" });
    expect(updateTextMemoryDraft).not.toHaveBeenCalled();
  });

  it("returns one 404 for a cross-owner memory and a 409 when a confirmed memory is patched", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    updateTextMemoryDraft.mockRejectedValueOnce(new DomainError("MEMORY_NOT_FOUND", 404, "记忆不存在或无权访问。"));

    const missing = await PATCH(request({ version: 1, title: "草稿" }), context);
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({ code: "MEMORY_NOT_FOUND" });

    updateTextMemoryDraft.mockRejectedValueOnce(new DomainError("MEMORY_DRAFT_NOT_EDITABLE", 409, "只有草稿状态的记忆可以修改。"));
    const confirmed = await PATCH(request({ version: 1, title: "草稿" }), context);
    expect(confirmed.status).toBe(409);
    await expect(confirmed.json()).resolves.toMatchObject({ code: "MEMORY_DRAFT_NOT_EDITABLE" });
  });
});

describe("GET /api/memories/[memoryId]", () => {
  it("requires auth and returns only the scoped safe review DTO", async () => {
    auth.mockResolvedValue(null);
    expect((await GET(new Request("http://localhost"), context)).status).toBe(401);
    expect(getMemoryReview).not.toHaveBeenCalled();
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    getMemoryReview.mockResolvedValue({ id: memoryId, planetId: "planet-1", status: "needs_confirmation", version: 2, sourceType: "text", visibility: "family", allowResonance: true, allowBook: true, title: "草稿", occurredAtLabel: null, locationLabel: null, people: [], tags: ["安心"], summary: "摘要", uncertainFields: ["people"], assets: [{ id: "asset-1", kind: "text", originalName: "memory.txt", mimeType: "text/plain", sizeBytes: 10 }] });
    const response = await GET(new Request("http://localhost"), context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ tags: ["安心"] });
    expect(getMemoryReview).toHaveBeenCalledWith({ userId: "user-1", galaxyId: "galaxy-1" }, memoryId);
  });
});
