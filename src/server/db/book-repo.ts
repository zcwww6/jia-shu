import { Prisma } from "@prisma/client";

import { getPrismaClient } from "@/server/db/client";
import { DomainError } from "@/server/domain-error";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

type BookDatabaseClient = Pick<Prisma.TransactionClient, "book" | "$queryRaw">;

export type CreateGeneratedBookInput = {
  id: string;
  userId: string;
  galaxyId: string;
  title: string;
  sourceRange: string;
  themeTemplateKey: string;
  visibility: "private" | "family" | "selected";
  draft: Prisma.InputJsonValue;
  body: string;
  sections: Prisma.InputJsonValue;
  sourceMemoryIds: string[];
};

export async function findActiveBook(input: {
  userId: string;
  galaxyId: string;
  bookId: string;
}) {
  const prisma = getPrismaClient();

  return prisma.book.findFirst({
    where: {
      id: input.bookId,
      userId: input.userId,
      galaxyId: input.galaxyId,
      deletedAt: null,
    },
  });
}

export async function updateActiveBook(input: { userId: string; galaxyId: string; bookId: string; version: number; body?: string; title?: string | null }) {
  const result = await getPrismaClient().book.updateMany({ where: { id: input.bookId, userId: input.userId, galaxyId: input.galaxyId, deletedAt: null, version: input.version }, data: { ...(input.body !== undefined ? { body: input.body } : {}), ...(input.title !== undefined ? { title: input.title } : {}), version: { increment: 1 } } });
  if (result.count !== 1) throw new DomainError("VERSION_CONFLICT", 409, "家书已被更新，请刷新后再保存。");
  return findActiveBook(input);
}

export async function listBookSummaries(input: { userId: string; galaxyId: string }) {
  return getPrismaClient().book.findMany({
    where: { userId: input.userId, galaxyId: input.galaxyId, deletedAt: null, status: { in: ["draft", "ready"] } },
    select: { id: true, title: true, status: true, updatedAt: true, _count: { select: { memories: true } } },
    orderBy: { updatedAt: "desc" },
  });
}

export async function findEligibleBookSources(input: {
  userId: string;
  galaxyId: string;
  memoryIds: string[];
}) {
  const prisma = getPrismaClient();

  return prisma.memory.findMany({
    where: {
      id: { in: input.memoryIds },
      userId: input.userId,
      galaxyId: input.galaxyId,
      deletedAt: null,
      status: "confirmed",
      allowBook: true,
    },
    select: { id: true, title: true, summary: true },
  });
}

export async function findShareableBook(
  input: { userId: string; galaxyId: string; bookId: string },
  client?: BookDatabaseClient,
) {
  const prisma = client ?? getPrismaClient();

  return prisma.book.findFirst({
    where: {
      id: input.bookId,
      userId: input.userId,
      galaxyId: input.galaxyId,
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
        where: { userId: input.userId, galaxyId: input.galaxyId, deletedAt: null },
        select: { memoryId: true },
      },
    },
  });
}

export async function createGeneratedBook(
  input: CreateGeneratedBookInput,
  client: BookDatabaseClient,
) {
  const sourceMemoryIds = [...new Set(input.sourceMemoryIds)];

  if (sourceMemoryIds.length === 0 || sourceMemoryIds.length !== input.sourceMemoryIds.length) {
    throw invalidBookSource();
  }

  const lockedSources = await client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "Memory"
    WHERE "id" IN (${Prisma.join(sourceMemoryIds)})
      AND "userId" = ${input.userId}
      AND "galaxyId" = ${input.galaxyId}
      AND "deletedAt" IS NULL
      AND "status" = ${"confirmed"}
      AND "allowBook" = ${true}
    ORDER BY "id" ASC
    FOR UPDATE
  `);
  const lockedSourceIds = new Set(lockedSources.map((source) => source.id));

  if (lockedSourceIds.size !== sourceMemoryIds.length || sourceMemoryIds.some((id) => !lockedSourceIds.has(id))) {
    throw invalidBookSource();
  }

  return client.book.create({
    data: {
      id: input.id,
      userId: input.userId,
      galaxyId: input.galaxyId,
      title: input.title,
      sourceRange: input.sourceRange,
      themeTemplateKey: input.themeTemplateKey,
      visibility: input.visibility,
      status: "ready",
      draft: input.draft,
      body: input.body,
      sections: input.sections,
      memories: {
        create: sourceMemoryIds.map((memoryId, sortOrder) => ({
          memoryId,
          sortOrder,
        })),
      },
    },
  });
}

export async function softDeleteBook(input: {
  userId: string;
  galaxyId: string;
  bookId: string;
  version: number;
  now?: Date;
}) {
  const prisma = getPrismaClient();
  const now = input.now ?? new Date();
  const result = await prisma.book.updateMany({
    where: {
      id: input.bookId,
      userId: input.userId,
      galaxyId: input.galaxyId,
      deletedAt: null,
      version: input.version,
    },
    data: {
      deletedAt: now,
      purgeAfter: new Date(now.getTime() + THIRTY_DAYS_MS),
      version: { increment: 1 },
    },
  });

  if (result.count !== 1) {
    throw new DomainError("VERSION_CONFLICT", 409);
  }
}

function invalidBookSource() {
  return new DomainError(
    "INVALID_BOOK_SOURCE",
    422,
    "家书来源必须是当前星系中已确认、未删除且已授权生成家书的记忆。",
  );
}
