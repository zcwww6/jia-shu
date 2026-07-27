import { beforeEach, describe, expect, it, vi } from "vitest";

const { findSharedBookByToken } = vi.hoisted(() => ({
  findSharedBookByToken: vi.fn(),
}));

vi.mock("@/server/db/shared-book-repo", () => ({
  findSharedBookByToken,
}));

import { createSharedBookToken, getSharedBook } from "./shared-books";

describe("shared-books store", () => {
  beforeEach(() => {
    findSharedBookByToken.mockReset();
  });

  it("creates URL-safe server-random share tokens with at least 256 bits of entropy", () => {
    const first = createSharedBookToken();
    const second = createSharedBookToken();

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
  });

  it("reads a shared book only through the snapshot repo by token", async () => {
    const storedBook = {
      token: "known-token",
      draft: {
        id: "book-1",
        title: "除夕家书",
        sourceRange: "binary_system" as const,
        themeTemplateKey: "family_reunion",
        sourceMemoryIds: ["memory-1"],
        intro: "已保存的 AI 前言。",
        chapters: [],
      },
      body: "已保存的 AI 正文。",
      sections: [{ title: "围桌", body: "已保存的 AI 章节。", sourceMemoryIds: ["memory-1"] }],
      share: { showBody: true, showSourceTitles: true, showOriginalText: false },
      createdAt: "2026-07-19T00:00:00.000Z",
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
