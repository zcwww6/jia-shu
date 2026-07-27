import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/server/domain-error";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
const { resolvePersonalGalaxyScope } = vi.hoisted(() => ({ resolvePersonalGalaxyScope: vi.fn() }));
const { revokeBookShare } = vi.hoisted(() => ({ revokeBookShare: vi.fn() }));

vi.mock("@/auth", () => ({ auth }));
vi.mock("@/server/db/galaxy-repo", () => ({ resolvePersonalGalaxyScope }));
vi.mock("@/server/services/book.service", () => ({ revokeBookShare }));

import { POST } from "./route";

const context = {
  params: Promise.resolve({ bookId: "book-1", token: "a".repeat(64) }),
};

function request(headers: HeadersInit = {}) {
  return new Request(`http://localhost/api/books/book-1/shares/${"a".repeat(64)}/revoke`, {
    method: "POST",
    headers,
  });
}

describe("POST /api/books/[bookId]/shares/[token]/revoke", () => {
  beforeEach(() => {
    auth.mockReset();
    resolvePersonalGalaxyScope.mockReset();
    revokeBookShare.mockReset();
  });

  it("uses authenticated URL scope to revoke a saved snapshot", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    revokeBookShare.mockResolvedValue({
      kind: "completed",
      operationId: "operation-1",
      status: 200,
      response: { token: "a".repeat(64), revoked: true },
    });

    const response = await POST(request({ "Idempotency-Key": "book-revoke-key-00001" }), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ token: "a".repeat(64), revoked: true });
    expect(revokeBookShare).toHaveBeenCalledWith(
      { userId: "user-1", galaxyId: "galaxy-1" },
      "book-1",
      "a".repeat(64),
      { idempotencyKey: "book-revoke-key-00001" },
    );
  });

  it("returns the same 404 for a missing, revoked-by-another-user, or wrong-book token", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    revokeBookShare.mockRejectedValue(new DomainError("SHARED_BOOK_NOT_FOUND", 404, "家书不存在或无权访问。"));

    const response = await POST(request({ "Idempotency-Key": "book-revoke-key-00001" }), context);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      code: "SHARED_BOOK_NOT_FOUND",
      message: "家书不存在或无权访问。",
    });
  });

  it("validates idempotency before looking up an owner scope", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });

    const response = await POST(request(), context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "IDEMPOTENCY_KEY_INVALID",
      message: "幂等键格式不正确。",
    });
    expect(resolvePersonalGalaxyScope).not.toHaveBeenCalled();
    expect(revokeBookShare).not.toHaveBeenCalled();
  });
});
