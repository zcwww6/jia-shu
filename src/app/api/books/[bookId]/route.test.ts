import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
const { resolvePersonalGalaxyScope } = vi.hoisted(() => ({ resolvePersonalGalaxyScope: vi.fn() }));
const { findActiveBook } = vi.hoisted(() => ({ findActiveBook: vi.fn() }));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/server/db/galaxy-repo", () => ({ resolvePersonalGalaxyScope }));
vi.mock("@/server/db/book-repo", () => ({ findActiveBook }));
import { GET } from "./route";

describe("GET /api/books/[bookId]", () => {
  beforeEach(() => { auth.mockReset(); resolvePersonalGalaxyScope.mockReset(); findActiveBook.mockReset(); });
  it("returns a scoped saved book without exposing unrelated records", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } }); resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    findActiveBook.mockResolvedValue({
      id: "book-1", title: "团圆", body: "正文", sections: [], status: "ready", version: 2, visibility: "family",
      draft: {
        sourceMemoryIds: ["memory-1", "memory-2"],
        sourceLabels: {
          "memory-1": "妈妈的除夕回忆",
          "memory-2": 42,
          sourceText: "不应向浏览器公开",
        },
      },
    });
    const response = await GET(new Request("http://localhost/api/books/book-1"), { params: Promise.resolve({ bookId: "book-1" }) });
    expect(response.status).toBe(200); await expect(response.json()).resolves.toEqual({ id: "book-1", title: "团圆", body: "正文", sections: [], status: "ready", version: 2, visibility: "family", sourceLabels: { "memory-1": "妈妈的除夕回忆" } });
    expect(findActiveBook).toHaveBeenCalledWith({ userId: "user-1", galaxyId: "galaxy-1", bookId: "book-1" });
  });
});
