import { describe, expect, it, vi, beforeEach } from "vitest";

const { saveSharedBook } = vi.hoisted(() => ({ saveSharedBook: vi.fn() }));

vi.mock("@/server/store/shared-books", () => ({
  saveSharedBook,
}));

import { POST } from "./route";

const validPayload = {
  draft: {
    id: "book-draft-1",
    title: "我们家的第一个新房除夕",
    sourceRange: "binary_system" as const,
    themeTemplateKey: "family_reunion",
    sourceMemoryIds: ["memory-1", "memory-2"],
    intro: "intro",
    chapters: [],
  },
  body: "narrative body",
  sections: [
    { title: "共同记住的一天", body: "body", sourceMemoryIds: ["memory-1"] },
  ],
  share: { showBody: true, showSourceTitles: true, showOriginalText: false },
};

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/books/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/books/publish", () => {
  beforeEach(() => {
    saveSharedBook.mockReset();
  });

  it("校验通过后存储并返回 token 与 url", async () => {
    saveSharedBook.mockResolvedValue({ ...validPayload, token: "tok123abc", createdAt: "2026-07-01T00:00:00.000Z" });

    const response = await POST(jsonRequest(validPayload));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.token).toBe("tok123abc");
    expect(json.url).toBe("/share/tok123abc");
    expect(saveSharedBook).toHaveBeenCalledWith(expect.objectContaining({ draft: validPayload.draft }));
  });

  it("格式不正确时返回 400", async () => {
    const response = await POST(jsonRequest({ foo: "bar" }));
    expect(response.status).toBe(400);
    expect(saveSharedBook).not.toHaveBeenCalled();
  });
});
