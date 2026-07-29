import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
const { resolvePersonalGalaxyScope } = vi.hoisted(() => ({ resolvePersonalGalaxyScope: vi.fn() }));
const { reviewBookSpread } = vi.hoisted(() => ({ reviewBookSpread: vi.fn() }));

vi.mock("@/auth", () => ({ auth }));
vi.mock("@/server/db/galaxy-repo", () => ({ resolvePersonalGalaxyScope }));
vi.mock("@/server/services/book-review.service", () => ({ reviewBookSpread }));

import { POST } from "./route";

describe("POST /api/books/[bookId]/review", () => {
  beforeEach(() => {
    auth.mockReset();
    resolvePersonalGalaxyScope.mockReset();
    reviewBookSpread.mockReset();
  });

  it("records one administrator-confirmed spread in the caller's own galaxy", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    reviewBookSpread.mockResolvedValue({ id: "book-1", status: "draft", version: 2, reviewedSpreadIndexes: [0], spreadCount: 3 });

    const response = await POST(new Request("http://localhost/api/books/book-1/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageIndex: 0, version: 1 }),
    }), { params: Promise.resolve({ bookId: "book-1" }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: "book-1", status: "draft", version: 2, reviewedSpreadIndexes: [0], spreadCount: 3 });
    expect(reviewBookSpread).toHaveBeenCalledWith(
      { userId: "user-1", galaxyId: "galaxy-1" },
      "book-1",
      { pageIndex: 0, version: 1 },
    );
  });
});
