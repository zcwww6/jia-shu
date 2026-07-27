import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
const { resolvePersonalGalaxyScope } = vi.hoisted(() => ({ resolvePersonalGalaxyScope: vi.fn() }));
const { createBookShare } = vi.hoisted(() => ({ createBookShare: vi.fn() }));
const { listActiveBookShareSummaries } = vi.hoisted(() => ({ listActiveBookShareSummaries: vi.fn() }));

vi.mock("@/auth", () => ({ auth }));
vi.mock("@/server/db/galaxy-repo", () => ({ resolvePersonalGalaxyScope }));
vi.mock("@/server/services/book.service", () => ({ createBookShare }));
vi.mock("@/server/db/shared-book-repo", () => ({ listActiveBookShareSummaries }));

import { GET, POST } from "./route";

function request(body: unknown, headers: HeadersInit = {}) {
  return new Request("http://localhost/api/books/book-1/shares", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const context = { params: Promise.resolve({ bookId: "book-1" }) };

describe("POST /api/books/[bookId]/shares", () => {
  beforeEach(() => {
    auth.mockReset();
    resolvePersonalGalaxyScope.mockReset();
    createBookShare.mockReset();
    listActiveBookShareSummaries.mockReset();
  });

  it("lists only active snapshots from the authenticated book scope", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    listActiveBookShareSummaries.mockResolvedValue([{ token: "a".repeat(64), createdAt: "2026-07-25T00:00:00.000Z" }]);

    const response = await GET(new Request("http://localhost/api/books/book-1/shares"), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ shares: [{ token: "a".repeat(64), url: `/share/${"a".repeat(64)}`, createdAt: "2026-07-25T00:00:00.000Z" }] });
    expect(listActiveBookShareSummaries).toHaveBeenCalledWith({ userId: "user-1", galaxyId: "galaxy-1", bookId: "book-1" });
  });

  it("uses the URL book id and the saved-book service, never a browser-supplied book payload", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    createBookShare.mockResolvedValue({
      kind: "completed",
      operationId: "operation-1",
      status: 201,
      response: { token: "a".repeat(64), url: `/share/${"a".repeat(64)}` },
    });

    const response = await POST(request({
      showBody: true,
      showSourceTitles: true,
      showOriginalText: false,
    }, { "Idempotency-Key": "book-share-key-000001" }), context);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ token: "a".repeat(64), url: `/share/${"a".repeat(64)}` });
    expect(createBookShare).toHaveBeenCalledWith(
      { userId: "user-1", galaxyId: "galaxy-1" },
      "book-1",
      {
        showBody: true,
        showSourceTitles: true,
        showOriginalText: false,
        idempotencyKey: "book-share-key-000001",
      },
    );
  });

  it("rejects a body book id or raw book fields before calling the service", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });

    const response = await POST(request({
      bookId: "attacker-book",
      showBody: true,
      showSourceTitles: true,
      showOriginalText: false,
      body: "浏览器不能发布正文",
    }, { "Idempotency-Key": "book-share-key-000001" }), context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "BOOK_SHARE_INPUT_INVALID",
      message: "家书分享请求格式不正确。",
    });
    expect(resolvePersonalGalaxyScope).not.toHaveBeenCalled();
    expect(createBookShare).not.toHaveBeenCalled();
  });

  it("returns a safe authentication error before loading scope", async () => {
    auth.mockResolvedValue(null);

    const response = await POST(request({
      showBody: true,
      showSourceTitles: true,
      showOriginalText: false,
    }, { "Idempotency-Key": "book-share-key-000001" }), context);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "UNAUTHENTICATED",
      message: "请先登录后再分享家书。",
    });
    expect(resolvePersonalGalaxyScope).not.toHaveBeenCalled();
  });
});
