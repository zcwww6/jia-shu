import { beforeEach, describe, expect, it, vi } from "vitest";

const { getPrismaClient } = vi.hoisted(() => ({
  getPrismaClient: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  getPrismaClient,
}));

import * as sharedBookRepo from "./shared-book-repo";

const sharedBookRepoWithSnapshots = sharedBookRepo as typeof sharedBookRepo & {
  createSharedBookSnapshot: (input: {
    userId: string;
    galaxyId: string;
    bookId: string;
    legacySnapshot: false;
    token: string;
    draft: unknown;
    body: string;
    sections: unknown;
    share: unknown;
  }) => Promise<unknown>;
  revokeSharedBookSnapshot: (input: {
    userId: string;
    galaxyId: string;
    bookId: string;
    token: string;
    now?: Date;
  }) => Promise<unknown>;
};

const snapshot = {
  userId: "user-1",
  galaxyId: "galaxy-1",
  bookId: "book-1",
  legacySnapshot: false as const,
  token: "a".repeat(64),
  draft: {
    id: "book-1",
    title: "除夕家书",
    sourceRange: "binary_system",
    themeTemplateKey: "family_reunion",
    sourceMemoryIds: ["memory-1"],
    sourceLabels: { "memory-1": "妈妈的除夕回忆" },
    intro: "已保存的 AI 前言。",
    chapters: [{ title: "围桌", sourceMemoryIds: ["memory-1"] }],
  },
  body: "已保存的 AI 正文。",
  sections: [{
    title: "围桌",
    body: "已保存的 AI 章节。",
    sourceMemoryIds: ["memory-1"],
    sourceLabels: ["妈妈的除夕回忆"],
  }],
  share: { showBody: true, showSourceTitles: true, showOriginalText: false },
};

describe("shared-book repo", () => {
  beforeEach(() => {
    getPrismaClient.mockReset();
  });

  it("creates only a scoped, book-linked immutable snapshot", async () => {
    const create = vi.fn().mockResolvedValue({ id: "shared-1", token: snapshot.token });
    getPrismaClient.mockReturnValue({ sharedBook: { create } });

    expect(sharedBookRepoWithSnapshots.createSharedBookSnapshot).toBeTypeOf("function");
    await sharedBookRepoWithSnapshots.createSharedBookSnapshot(snapshot);

    expect(create).toHaveBeenCalledWith({
      data: snapshot,
      select: { id: true, token: true },
    });
  });

  it("reads only non-legacy, book-linked, non-revoked snapshots by token", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      token: snapshot.token,
      draft: snapshot.draft,
      body: snapshot.body,
      sections: snapshot.sections,
      share: snapshot.share,
      createdAt: new Date("2026-07-19T00:00:00.000Z"),
    });
    getPrismaClient.mockReturnValue({ sharedBook: { findFirst } });

    await expect(sharedBookRepo.findSharedBookByToken(snapshot.token)).resolves.toEqual({
      token: snapshot.token,
      draft: snapshot.draft,
      body: snapshot.body,
      sections: snapshot.sections,
      share: snapshot.share,
      createdAt: "2026-07-19T00:00:00.000Z",
    });

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        token: snapshot.token,
        bookId: { not: null },
        legacySnapshot: false,
        revokedAt: null,
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
  });

  it("does not return an unlinked historical raw snapshot to a public token lookup", async () => {
    const rawLegacyRecord = {
      token: snapshot.token,
      draft: { title: "浏览器伪造的草稿" },
      body: "浏览器伪造的正文",
      sections: [{ title: "伪造章节", body: "不应公开" }],
      share: { showBody: true, showSourceTitles: true, showOriginalText: true },
      createdAt: new Date("2026-07-19T00:00:00.000Z"),
    };
    const findFirst = vi.fn().mockImplementation(async ({ where }: {
      where: { bookId?: { not?: null } };
    }) => (where.bookId?.not === null ? null : rawLegacyRecord));
    getPrismaClient.mockReturnValue({ sharedBook: { findFirst } });

    await expect(sharedBookRepo.findSharedBookByToken(snapshot.token)).resolves.toBeNull();
  });

  it("revokes only the matching owner, galaxy, book, and token", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "shared-1", revokedAt: null });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    getPrismaClient.mockReturnValue({ sharedBook: { findFirst, updateMany } });
    const now = new Date("2026-07-19T00:00:00.000Z");

    expect(sharedBookRepoWithSnapshots.revokeSharedBookSnapshot).toBeTypeOf("function");
    await expect(sharedBookRepoWithSnapshots.revokeSharedBookSnapshot({
      userId: "user-1",
      galaxyId: "galaxy-1",
      bookId: "book-1",
      token: snapshot.token,
      now,
    })).resolves.toEqual({ kind: "revoked", id: "shared-1" });

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        galaxyId: "galaxy-1",
        bookId: "book-1",
        token: snapshot.token,
        legacySnapshot: false,
      },
      select: { id: true, revokedAt: true },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "shared-1",
        userId: "user-1",
        galaxyId: "galaxy-1",
        bookId: "book-1",
        token: snapshot.token,
        legacySnapshot: false,
        revokedAt: null,
      },
      data: { revokedAt: now },
    });
  });

  it("treats an already-revoked owned snapshot as a successful no-op", async () => {
    const revokedAt = new Date("2026-07-19T00:00:00.000Z");
    const findFirst = vi.fn().mockResolvedValue({ id: "shared-1", revokedAt });
    const updateMany = vi.fn();
    getPrismaClient.mockReturnValue({ sharedBook: { findFirst, updateMany } });

    await expect(sharedBookRepoWithSnapshots.revokeSharedBookSnapshot({
      userId: "user-1",
      galaxyId: "galaxy-1",
      bookId: "book-1",
      token: snapshot.token,
    })).resolves.toEqual({ kind: "already_revoked", id: "shared-1" });
    expect(updateMany).not.toHaveBeenCalled();
  });
});
