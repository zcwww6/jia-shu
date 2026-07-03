import { beforeEach, describe, expect, it, vi } from "vitest";

const { getPrismaClient } = vi.hoisted(() => ({
  getPrismaClient: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  getPrismaClient,
}));

import { createSharedBook, findSharedBookByToken } from "./shared-book-repo";

const sharedBookPayload = {
  token: "tok123abc456",
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
  createdAt: "2026-07-04T00:00:00.000Z",
};

describe("shared-book repo", () => {
  beforeEach(() => {
    getPrismaClient.mockReset();
  });

  it("writes shared books through prisma and maps the stored record", async () => {
    const create = vi.fn().mockResolvedValue({
      token: sharedBookPayload.token,
      draft: sharedBookPayload.draft,
      body: sharedBookPayload.body,
      sections: sharedBookPayload.sections,
      share: sharedBookPayload.share,
      createdAt: new Date(sharedBookPayload.createdAt),
    });
    getPrismaClient.mockReturnValue({
      sharedBook: {
        create,
      },
    });

    const result = await createSharedBook({
      userId: "user-1",
      ...sharedBookPayload,
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        token: sharedBookPayload.token,
        draft: sharedBookPayload.draft,
        body: sharedBookPayload.body,
        sections: sharedBookPayload.sections,
        share: sharedBookPayload.share,
        createdAt: new Date(sharedBookPayload.createdAt),
      },
      select: {
        token: true,
        draft: true,
        body: true,
        sections: true,
        share: true,
        createdAt: true,
      },
    });
    expect(result).toEqual(sharedBookPayload);
  });

  it("reads shared books by token through prisma and maps the result", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      token: sharedBookPayload.token,
      draft: sharedBookPayload.draft,
      body: sharedBookPayload.body,
      sections: sharedBookPayload.sections,
      share: sharedBookPayload.share,
      createdAt: new Date(sharedBookPayload.createdAt),
    });
    getPrismaClient.mockReturnValue({
      sharedBook: {
        findUnique,
      },
    });

    const result = await findSharedBookByToken(sharedBookPayload.token);

    expect(findUnique).toHaveBeenCalledWith({
      where: { token: sharedBookPayload.token },
      select: {
        token: true,
        draft: true,
        body: true,
        sections: true,
        share: true,
        createdAt: true,
      },
    });
    expect(result).toEqual(sharedBookPayload);
  });

  it("returns null when prisma finds no shared book", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    getPrismaClient.mockReturnValue({
      sharedBook: {
        findUnique,
      },
    });

    await expect(findSharedBookByToken("missing-token")).resolves.toBeNull();
  });
});
