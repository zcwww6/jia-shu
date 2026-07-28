import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
const { resolvePersonalGalaxyScope } = vi.hoisted(() => ({ resolvePersonalGalaxyScope: vi.fn() }));
const { findActiveBook, findActiveBookWithMedia } = vi.hoisted(() => ({
  findActiveBook: vi.fn(),
  findActiveBookWithMedia: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/server/db/galaxy-repo", () => ({ resolvePersonalGalaxyScope }));
vi.mock("@/server/db/book-repo", () => ({ findActiveBook, findActiveBookWithMedia }));
import { GET } from "./route";

describe("GET /api/books/[bookId]", () => {
  beforeEach(() => { auth.mockReset(); resolvePersonalGalaxyScope.mockReset(); findActiveBook.mockReset(); findActiveBookWithMedia.mockReset(); });
  it("returns a scoped saved book without exposing unrelated records", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } }); resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    findActiveBookWithMedia.mockResolvedValue({
      id: "book-1", title: "团圆", body: "正文", sections: [], status: "ready", version: 2, visibility: "family",
      memories: [],
      draft: {
        sourceMemoryIds: ["memory-1", "memory-2"],
        intro: "这是一封已经保存的家书前言。",
        sourceLabels: {
          "memory-1": "妈妈的除夕回忆",
          "memory-2": 42,
          sourceText: "不应向浏览器公开",
        },
      },
    });
    const response = await GET(new Request("http://localhost/api/books/book-1"), { params: Promise.resolve({ bookId: "book-1" }) });
    expect(response.status).toBe(200); await expect(response.json()).resolves.toEqual({ id: "book-1", title: "团圆", body: "正文", intro: "这是一封已经保存的家书前言。", sections: [], status: "ready", version: 2, visibility: "family", sourceLabels: { "memory-1": "妈妈的除夕回忆" }, media: [] });
    expect(findActiveBookWithMedia).toHaveBeenCalledWith({ userId: "user-1", galaxyId: "galaxy-1", bookId: "book-1" });
  });

  it("projects only usable source image and audio into the authenticated keepsake edition", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    findActiveBookWithMedia.mockResolvedValue({
      id: "book-1", title: "团圆", body: "正文", sections: [], status: "ready", version: 2, visibility: "family",
      draft: { sourceMemoryIds: ["memory-1"], sourceLabels: { "memory-1": "妈妈的除夕回忆" } },
      memories: [{
        memory: {
          id: "memory-1",
          title: "妈妈的除夕回忆",
          summary: "全家围桌。",
          assets: [
            { id: "image-1", kind: "image", mimeType: "image/jpeg", originalName: "dinner.jpg", width: 1600, height: 1200, durationMs: null },
            { id: "audio-1", kind: "audio", mimeType: "audio/mpeg", originalName: "grandma.mp3", width: null, height: null, durationMs: 21_000 },
            { id: "document-1", kind: "document", mimeType: "application/pdf", originalName: "diary.pdf", width: null, height: null, durationMs: null },
          ],
        },
      }],
    });

    const response = await GET(new Request("http://localhost/api/books/book-1"), { params: Promise.resolve({ bookId: "book-1" }) });

    await expect(response.json()).resolves.toMatchObject({
      media: [
        { id: "image-1", kind: "image", url: "/api/assets/image-1/content", caption: "全家围桌。", width: 1600, height: 1200 },
        { id: "audio-1", kind: "audio", url: "/api/assets/audio-1/content", durationMs: 21_000 },
      ],
    });
    expect(findActiveBookWithMedia).toHaveBeenCalledWith({ userId: "user-1", galaxyId: "galaxy-1", bookId: "book-1" });
  });
});
