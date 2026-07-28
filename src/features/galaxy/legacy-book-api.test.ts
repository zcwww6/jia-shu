import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createLegacyBook,
  createLegacyBookShare,
  getLegacyBook,
  listLegacyBookShares,
  revokeLegacyBookShare,
  updateLegacyBook,
} from "./legacy-book-api";

const createdBook = {
  id: "book-1",
  title: "除夕家书",
  status: "ready" as const,
  draft: {
    sourceMemoryIds: ["memory-a", "memory-b"],
    sourceRange: "binary_system" as const,
    themeTemplateKey: "family_reunion",
    visibility: "family" as const,
  },
  body: "这是服务端 AI 生成的正文。",
  sections: [{ title: "团圆", content: "真实段落" }],
  version: 1,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("legacy book API bridge", () => {
  it("creates a real book and reuses the caller idempotency key on a retry", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify(createdBook), { status: 201 }),
    ));
    vi.stubGlobal("fetch", fetchMock);
    const request = {
      title: "除夕家书",
      sourceMemoryIds: ["memory-a", "memory-b"],
      sourceRange: "binary_system" as const,
      themeTemplateKey: "family_reunion",
      visibility: "family" as const,
    };

    await expect(createLegacyBook(request, "book-request-1")).resolves.toEqual(createdBook);
    await expect(createLegacyBook(request, "book-request-1")).resolves.toEqual(createdBook);

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/books", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "book-request-1",
      },
      body: JSON.stringify(request),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/books", expect.objectContaining({
      headers: expect.objectContaining({ "Idempotency-Key": "book-request-1" }),
    }));
  });

  it("uses the current book URL and optimistic version when reading and saving", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(createdBook), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "book-1", title: "新标题", body: "新正文", version: 2,
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getLegacyBook("book-1")).resolves.toEqual(createdBook);
    await expect(updateLegacyBook("book-1", {
      version: 1,
      title: "新标题",
      body: "新正文",
    })).resolves.toEqual({ id: "book-1", title: "新标题", body: "新正文", version: 2 });

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/books/book-1", { method: "GET" });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/books/book-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: 1, title: "新标题", body: "新正文" }),
    });
  });

  it("creates, lists, and revokes real shares with their idempotency keys", async () => {
    const share = { token: "share-token", url: "/share/share-token" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(share), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ shares: [{ ...share, createdAt: "2026-07-28T00:00:00.000Z" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ revoked: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const options = { showBody: true, showSourceTitles: true, showOriginalText: false };

    await expect(createLegacyBookShare("book-1", options, "share-request-1")).resolves.toEqual(share);
    await expect(listLegacyBookShares("book-1")).resolves.toEqual({
      shares: [{ ...share, createdAt: "2026-07-28T00:00:00.000Z" }],
    });
    await expect(revokeLegacyBookShare("book-1", "share-token", "revoke-request-1")).resolves.toEqual({ revoked: true });

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/books/book-1/shares", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "share-request-1" },
      body: JSON.stringify(options),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/books/book-1/shares", { method: "GET" });
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/books/book-1/shares/share-token/revoke", {
      method: "POST",
      headers: { "Idempotency-Key": "revoke-request-1" },
    });
  });

  it("surfaces an AI error instead of manufacturing a mock book", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "AI 服务暂不可用" }), { status: 503 }),
    ));

    await expect(createLegacyBook({
      sourceMemoryIds: ["memory-a", "memory-b"],
      sourceRange: "binary_system",
      themeTemplateKey: "family_reunion",
      visibility: "family",
    }, "book-request-1")).rejects.toMatchObject({
      message: "AI 服务暂不可用",
      status: 503,
    });
  });

  it("treats a processing idempotency response as retryable instead of a completed book", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        code: "IDEMPOTENCY_PROCESSING",
        message: "请求仍在处理中，请稍后重试。",
      }), { status: 202 }),
    ));

    await expect(createLegacyBook({
      sourceMemoryIds: ["memory-a", "memory-b"],
      sourceRange: "binary_system",
      themeTemplateKey: "family_reunion",
      visibility: "family",
    }, "book-request-1")).rejects.toMatchObject({
      message: "请求仍在处理中，请稍后重试。",
      status: 202,
      code: "IDEMPOTENCY_PROCESSING",
    });
  });
});
