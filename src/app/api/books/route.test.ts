import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/server/domain-error";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
const { resolvePersonalGalaxyScope } = vi.hoisted(() => ({ resolvePersonalGalaxyScope: vi.fn() }));
const { createBookFromMemories } = vi.hoisted(() => ({ createBookFromMemories: vi.fn() }));
const { listBookSummaries } = vi.hoisted(() => ({ listBookSummaries: vi.fn() }));

vi.mock("@/auth", () => ({ auth }));
vi.mock("@/server/db/galaxy-repo", () => ({ resolvePersonalGalaxyScope }));
vi.mock("@/server/services/book.service", () => ({ createBookFromMemories }));
vi.mock("@/server/db/book-repo", () => ({ listBookSummaries }));

import { GET, POST } from "./route";

const memoryId = "ck8m3x8xy000000000000001";

function request(body: unknown, headers: HeadersInit = {}) {
  return new Request("http://localhost/api/books", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/books", () => {
  beforeEach(() => {
    auth.mockReset();
    resolvePersonalGalaxyScope.mockReset();
    createBookFromMemories.mockReset();
    listBookSummaries.mockReset();
  });

  it("accepts only browser-safe source settings and asks the scoped service to generate", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    createBookFromMemories.mockResolvedValue({
      kind: "completed",
      operationId: "operation-1",
      status: 201,
      response: { id: "book-1", title: "除夕家书", status: "ready" },
    });

    const response = await POST(request({
      sourceMemoryIds: [memoryId],
      sourceRange: "single_planet",
      themeTemplateKey: "family_reunion",
      visibility: "family",
    }, { "Idempotency-Key": "book-create-key-00001" }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ id: "book-1", title: "除夕家书", status: "ready" });
    expect(createBookFromMemories).toHaveBeenCalledWith(
      { userId: "user-1", galaxyId: "galaxy-1" },
      {
        sourceMemoryIds: [memoryId],
        sourceRange: "single_planet",
        themeTemplateKey: "family_reunion",
        visibility: "family",
        idempotencyKey: "book-create-key-00001",
      },
    );
  });

  it("rejects body, draft, and sections before resolving galaxy scope", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });

    const response = await POST(request({
      sourceMemoryIds: [memoryId],
      sourceRange: "single_planet",
      themeTemplateKey: "family_reunion",
      body: "浏览器不能写入家书正文",
      draft: { title: "浏览器不能断言草稿" },
      sections: [],
    }, { "Idempotency-Key": "book-create-key-00001" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "BOOK_INPUT_INVALID",
      message: "家书请求格式不正确。",
    });
    expect(resolvePersonalGalaxyScope).not.toHaveBeenCalled();
    expect(createBookFromMemories).not.toHaveBeenCalled();
  });

  it("returns accepted semantics when the same idempotency key is still generating", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    createBookFromMemories.mockResolvedValue({ kind: "processing", operationId: "operation-1", status: 202 });

    const response = await POST(request({
      sourceMemoryIds: [memoryId],
      sourceRange: "single_planet",
      themeTemplateKey: "family_reunion",
    }, { "Idempotency-Key": "book-create-key-00001" }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      code: "IDEMPOTENCY_PROCESSING",
      message: "请求仍在处理中，请稍后重试。",
    });
  });

  it("maps invalid source ownership or confirmation to the safe domain error", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    createBookFromMemories.mockRejectedValue(new DomainError(
      "INVALID_BOOK_SOURCE",
      422,
      "家书来源必须是当前星系中已确认、未删除且已授权生成家书的记忆。",
    ));

    const response = await POST(request({
      sourceMemoryIds: [memoryId],
      sourceRange: "single_planet",
      themeTemplateKey: "family_reunion",
    }, { "Idempotency-Key": "book-create-key-00001" }));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      code: "INVALID_BOOK_SOURCE",
      message: "家书来源必须是当前星系中已确认、未删除且已授权生成家书的记忆。",
    });
  });
});

describe("GET /api/books", () => {
  it("requires login and returns only scoped book summaries", async () => {
    auth.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect(listBookSummaries).not.toHaveBeenCalled();
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    listBookSummaries.mockResolvedValue([{ id: "book-1", title: "除夕家书", status: "ready", updatedAt: new Date("2026-07-25T00:00:00.000Z"), _count: { memories: 2 } }]);
    const response = await GET();
    await expect(response.json()).resolves.toEqual([{ id: "book-1", title: "除夕家书", status: "ready", memoryCount: 2, updatedAt: "2026-07-25T00:00:00.000Z" }]);
    expect(listBookSummaries).toHaveBeenCalledWith({ userId: "user-1", galaxyId: "galaxy-1" });
  });
});
