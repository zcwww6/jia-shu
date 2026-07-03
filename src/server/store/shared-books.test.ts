import { beforeEach, describe, expect, it, vi } from "vitest";

const { createSharedBook, findSharedBookByToken } = vi.hoisted(() => ({
  createSharedBook: vi.fn(),
  findSharedBookByToken: vi.fn(),
}));

vi.mock("@/server/db/shared-book-repo", () => ({
  createSharedBook,
  findSharedBookByToken,
}));

import { getSharedBook, saveSharedBook } from "./shared-books";

const publishPayload = {
  draft: {
    id: "book-draft-1",
    title: "我们家的第一个新房除夕",
    sourceRange: "binary_system" as const,
    themeTemplateKey: "family_reunion",
    sourceMemoryIds: ["memory-1", "memory-2"],
    intro: "这页家书只使用已确认的记忆星来源。",
    chapters: [],
  },
  body: "原始生成全文内容。",
  sections: [
    { title: "共同记住的一天", body: "AI 先整理出重合。", sourceMemoryIds: ["memory-1"] },
  ],
  share: { showBody: true, showSourceTitles: true, showOriginalText: false },
};

describe("shared-books store", () => {
  beforeEach(() => {
    createSharedBook.mockReset();
    findSharedBookByToken.mockReset();
  });

  it("saves a shared book through the repo with the publishing user id", async () => {
    createSharedBook.mockImplementation(async (input) => ({
      ...publishPayload,
      token: input.token,
      createdAt: input.createdAt,
    }));

    const stored = await saveSharedBook({
      userId: "user-1",
      ...publishPayload,
    });

    expect(createSharedBook).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        draft: publishPayload.draft,
        body: publishPayload.body,
      }),
    );
    expect(stored.token).toHaveLength(12);
    expect(stored.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("reads a shared book through the repo by token", async () => {
    const storedBook = {
      ...publishPayload,
      token: "known-token",
      createdAt: "2026-07-04T00:00:00.000Z",
    };
    findSharedBookByToken.mockResolvedValue(storedBook);

    await expect(getSharedBook("known-token")).resolves.toEqual(storedBook);
    expect(findSharedBookByToken).toHaveBeenCalledWith("known-token");
  });

  it("returns null without calling the repo when token is empty", async () => {
    await expect(getSharedBook("")).resolves.toBeNull();
    expect(findSharedBookByToken).not.toHaveBeenCalled();
  });
});
