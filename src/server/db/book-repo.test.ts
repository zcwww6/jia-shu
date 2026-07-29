import { beforeEach, describe, expect, it, vi } from "vitest";

const { getPrismaClient } = vi.hoisted(() => ({
  getPrismaClient: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  getPrismaClient,
}));

import * as bookRepo from "./book-repo";

const { findActiveBook, softDeleteBook, updateActiveBook } = bookRepo;
const bookRepoWithSources = bookRepo as typeof bookRepo & {
  findEligibleBookSources: (input: {
    userId: string;
    galaxyId: string;
    memoryIds: string[];
  }) => Promise<unknown>;
  createGeneratedBook: (input: {
    id: string;
    userId: string;
    galaxyId: string;
    title: string;
    sourceRange: string;
    themeTemplateKey: string;
    visibility: "private" | "family" | "selected";
    draft: unknown;
    body: string;
    sections: unknown;
    sourceMemoryIds: string[];
  }, client?: unknown) => Promise<unknown>;
  findShareableBook: (input: { userId: string; galaxyId: string; bookId: string }) => Promise<unknown>;
};

describe("book repo", () => {
  beforeEach(() => {
    getPrismaClient.mockReset();
  });

  it("resets completed page review when an approved book's visible content changes", async () => {
    const current = {
      id: "book-1", userId: "user-1", galaxyId: "galaxy-1", status: "ready", version: 4,
      title: "旧标题", body: "旧正文", draft: { sourceMemoryIds: ["memory-1"], reviewedSpreadIndexes: [0, 1, 2] },
    };
    const updated = { ...current, title: "新标题", body: "新正文", status: "draft", version: 5, draft: { sourceMemoryIds: ["memory-1"], reviewedSpreadIndexes: [] } };
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findFirst = vi.fn().mockResolvedValueOnce(current).mockResolvedValueOnce(updated);
    getPrismaClient.mockReturnValue({ book: { findFirst, updateMany } });

    await expect(updateActiveBook({ userId: "user-1", galaxyId: "galaxy-1", bookId: "book-1", version: 4, title: "新标题", body: "新正文" })).resolves.toEqual(updated);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "book-1", userId: "user-1", galaxyId: "galaxy-1", deletedAt: null, version: 4 },
      data: {
        title: "新标题",
        body: "新正文",
        status: "draft",
        draft: { sourceMemoryIds: ["memory-1"], reviewedSpreadIndexes: [] },
        version: { increment: 1 },
      },
    });
  });

  it("creates a fresh review progress record when an older approved book has no draft metadata", async () => {
    const current = {
      id: "book-1", userId: "user-1", galaxyId: "galaxy-1", status: "ready", version: 4,
      title: "旧标题", body: "旧正文", draft: null,
    };
    const updated = { ...current, body: "新正文", status: "draft", version: 5, draft: { reviewedSpreadIndexes: [] } };
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findFirst = vi.fn().mockResolvedValueOnce(current).mockResolvedValueOnce(updated);
    getPrismaClient.mockReturnValue({ book: { findFirst, updateMany } });

    await expect(updateActiveBook({ userId: "user-1", galaxyId: "galaxy-1", bookId: "book-1", version: 4, body: "新正文" })).resolves.toEqual(updated);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "draft", draft: { reviewedSpreadIndexes: [] } }),
    }));
  });

  it("reads an active book only inside the caller's galaxy scope", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "book-1" });
    getPrismaClient.mockReturnValue({ book: { findFirst } });

    await findActiveBook({ userId: "user-1", galaxyId: "galaxy-1", bookId: "book-1" });

    expect(findFirst).toHaveBeenCalledWith({
      where: { id: "book-1", userId: "user-1", galaxyId: "galaxy-1", deletedAt: null },
    });
  });

  it("reads book sources only when they are confirmed, opted in, undeleted, and scoped", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "memory-1", title: "团圆饭", summary: "除夕的团圆饭。" }]);
    getPrismaClient.mockReturnValue({ memory: { findMany } });

    expect(bookRepoWithSources.findEligibleBookSources).toBeTypeOf("function");
    await bookRepoWithSources.findEligibleBookSources({
      userId: "user-1",
      galaxyId: "galaxy-1",
      memoryIds: ["memory-1", "memory-2"],
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["memory-1", "memory-2"] },
        userId: "user-1",
        galaxyId: "galaxy-1",
        deletedAt: null,
        status: "confirmed",
        allowBook: true,
      },
      select: { id: true, title: true, summary: true },
    });
  });

  it("creates a review draft and its trusted BookMemory source rows together", async () => {
    const create = vi.fn().mockResolvedValue({ id: "book-1", title: "除夕家书" });
    const $queryRaw = vi.fn().mockResolvedValue([{ id: "memory-1" }, { id: "memory-2" }]);
    const transaction = { book: { create }, $queryRaw };
    const draft = { id: "book-1", intro: "团圆。", sourceMemoryIds: ["memory-1", "memory-2"], chapters: [] };
    const sections = [{ title: "团圆", body: "围桌而坐。", sourceMemoryIds: ["memory-1", "memory-2"] }];

    expect(bookRepoWithSources.createGeneratedBook).toBeTypeOf("function");
    await bookRepoWithSources.createGeneratedBook({
      id: "book-1",
      userId: "user-1",
      galaxyId: "galaxy-1",
      title: "除夕家书",
      sourceRange: "binary_system",
      themeTemplateKey: "family_reunion",
      visibility: "family",
      draft,
      body: "团圆。\n\n团圆\n围桌而坐。",
      sections,
      sourceMemoryIds: ["memory-1", "memory-2"],
    }, transaction);

    expect(getPrismaClient).not.toHaveBeenCalled();
    expect($queryRaw).toHaveBeenCalledTimes(1);
    const lockQuery = $queryRaw.mock.calls[0]?.[0] as { strings: string[]; values: unknown[] };
    expect(lockQuery.strings.join("?").replace(/\s+/g, " ").trim()).toBe(
      'SELECT "id" FROM "Memory" WHERE "id" IN (?,?) AND "userId" = ? AND "galaxyId" = ? AND "deletedAt" IS NULL AND "status" = ? AND "allowBook" = ? ORDER BY "id" ASC FOR UPDATE',
    );
    expect(lockQuery.values).toEqual(["memory-1", "memory-2", "user-1", "galaxy-1", "confirmed", true]);

    expect(create).toHaveBeenCalledWith({
      data: {
        id: "book-1",
        userId: "user-1",
        galaxyId: "galaxy-1",
        title: "除夕家书",
        sourceRange: "binary_system",
        themeTemplateKey: "family_reunion",
        visibility: "family",
        status: "draft",
        draft,
        body: "团圆。\n\n团圆\n围桌而坐。",
        sections,
        memories: {
          create: [
            { memoryId: "memory-1", sortOrder: 0 },
            { memoryId: "memory-2", sortOrder: 1 },
          ],
        },
      },
    });
  });

  it("rejects a source that is revoked after AI preparation without creating a Book or BookMemory", async () => {
    const create = vi.fn();
    const $queryRaw = vi.fn().mockResolvedValue([{ id: "memory-1" }]);
    const transaction = { book: { create }, $queryRaw };

    await expect(bookRepoWithSources.createGeneratedBook({
      id: "book-1",
      userId: "user-1",
      galaxyId: "galaxy-1",
      title: "除夕家书",
      sourceRange: "binary_system",
      themeTemplateKey: "family_reunion",
      visibility: "family",
      draft: { id: "book-1", intro: "团圆。", sourceMemoryIds: ["memory-1", "memory-2"], chapters: [] },
      body: "团圆。\n\n团圆\n围桌而坐。",
      sections: [{ title: "团圆", body: "围桌而坐。", sourceMemoryIds: ["memory-1", "memory-2"] }],
      sourceMemoryIds: ["memory-1", "memory-2"],
    }, transaction)).rejects.toMatchObject({ code: "INVALID_BOOK_SOURCE", status: 422 });

    expect($queryRaw).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects duplicate source ids before it can create duplicate BookMemory rows", async () => {
    const create = vi.fn();
    const $queryRaw = vi.fn();
    const transaction = { book: { create }, $queryRaw };

    await expect(bookRepoWithSources.createGeneratedBook({
      id: "book-1",
      userId: "user-1",
      galaxyId: "galaxy-1",
      title: "除夕家书",
      sourceRange: "binary_system",
      themeTemplateKey: "family_reunion",
      visibility: "family",
      draft: { id: "book-1", intro: "团圆。", sourceMemoryIds: ["memory-1", "memory-1"], chapters: [] },
      body: "团圆。\n\n团圆\n围桌而坐。",
      sections: [{ title: "团圆", body: "围桌而坐。", sourceMemoryIds: ["memory-1", "memory-1"] }],
      sourceMemoryIds: ["memory-1", "memory-1"],
    }, transaction)).rejects.toMatchObject({ code: "INVALID_BOOK_SOURCE", status: 422 });

    expect($queryRaw).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("reads a ready book and only its active BookMemory sources inside scope for sharing", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    getPrismaClient.mockReturnValue({ book: { findFirst } });

    expect(bookRepoWithSources.findShareableBook).toBeTypeOf("function");
    await bookRepoWithSources.findShareableBook({
      userId: "user-1",
      galaxyId: "galaxy-1",
      bookId: "book-1",
    });

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: "book-1",
        userId: "user-1",
        galaxyId: "galaxy-1",
        status: "ready",
        deletedAt: null,
      },
      select: {
        id: true,
        title: true,
        draft: true,
        body: true,
        sections: true,
        memories: {
          where: { userId: "user-1", galaxyId: "galaxy-1", deletedAt: null },
          select: { memoryId: true },
        },
      },
    });
  });

  it("uses updateMany for book soft deletion", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    getPrismaClient.mockReturnValue({ book: { updateMany } });
    const now = new Date("2026-07-16T00:00:00.000Z");

    await softDeleteBook({ userId: "user-1", galaxyId: "galaxy-1", bookId: "book-1", version: 4, now });

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "book-1", userId: "user-1", galaxyId: "galaxy-1", deletedAt: null, version: 4 },
      data: {
        deletedAt: now,
        purgeAfter: new Date("2026-08-15T00:00:00.000Z"),
        version: { increment: 1 },
      },
    });
  });
});
