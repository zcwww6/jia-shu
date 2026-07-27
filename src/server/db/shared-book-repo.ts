import type { Prisma, PrismaClient } from "@prisma/client";

import type { StoredSharedBook } from "@/shared/types/galaxy";
import { getPrismaClient } from "@/server/db/client";

type SharedBookDatabaseClient = Pick<PrismaClient, "sharedBook">;

type SharedBookRecord = {
  token: string;
  draft: Prisma.JsonValue;
  body: string;
  sections: Prisma.JsonValue;
  share: Prisma.JsonValue;
  createdAt: Date;
};

export type CreateSharedBookSnapshotInput = {
  userId: string;
  galaxyId: string;
  bookId: string;
  legacySnapshot: false;
  token: string;
  draft: Prisma.InputJsonValue;
  body: string;
  sections: Prisma.InputJsonValue;
  share: Prisma.InputJsonValue;
};

const sharedBookSelect = {
  token: true,
  draft: true,
  body: true,
  sections: true,
  share: true,
  createdAt: true,
} as const;

export async function createSharedBookSnapshot(
  input: CreateSharedBookSnapshotInput,
  client?: SharedBookDatabaseClient,
) {
  const prisma = client ?? getPrismaClient();

  return prisma.sharedBook.create({
    data: {
      userId: input.userId,
      galaxyId: input.galaxyId,
      bookId: input.bookId,
      legacySnapshot: false,
      token: input.token,
      draft: input.draft,
      body: input.body,
      sections: input.sections,
      share: input.share,
    },
    select: { id: true, token: true },
  });
}

export async function findSharedBookByToken(token: string) {
  const prisma = getPrismaClient();
  const record = await prisma.sharedBook.findFirst({
    where: { token, bookId: { not: null }, legacySnapshot: false, revokedAt: null },
    select: sharedBookSelect,
  });

  return record ? mapStoredSharedBook(record) : null;
}

export async function listActiveBookShareSummaries(input: {
  userId: string;
  galaxyId: string;
  bookId: string;
}) {
  const records = await getPrismaClient().sharedBook.findMany({
    where: {
      userId: input.userId,
      galaxyId: input.galaxyId,
      bookId: input.bookId,
      legacySnapshot: false,
      revokedAt: null,
    },
    select: { token: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  return records.map((record) => ({ token: record.token, createdAt: record.createdAt.toISOString() }));
}

export async function revokeSharedBookSnapshot(
  input: {
    userId: string;
    galaxyId: string;
    bookId: string;
    token: string;
    now?: Date;
  },
  client?: SharedBookDatabaseClient,
) {
  const prisma = client ?? getPrismaClient();
  const record = await prisma.sharedBook.findFirst({
    where: {
      userId: input.userId,
      galaxyId: input.galaxyId,
      bookId: input.bookId,
      token: input.token,
      legacySnapshot: false,
    },
    select: { id: true, revokedAt: true },
  });

  if (!record) {
    return null;
  }

  if (record.revokedAt) {
    return { kind: "already_revoked" as const, id: record.id };
  }

  const result = await prisma.sharedBook.updateMany({
    where: {
      id: record.id,
      userId: input.userId,
      galaxyId: input.galaxyId,
      bookId: input.bookId,
      token: input.token,
      legacySnapshot: false,
      revokedAt: null,
    },
    data: { revokedAt: input.now ?? new Date() },
  });

  return result.count === 1
    ? { kind: "revoked" as const, id: record.id }
    : { kind: "already_revoked" as const, id: record.id };
}

function mapStoredSharedBook(record: SharedBookRecord): StoredSharedBook {
  return {
    token: record.token,
    draft: record.draft as unknown as StoredSharedBook["draft"],
    body: record.body,
    sections: record.sections as unknown as StoredSharedBook["sections"],
    share: record.share as unknown as StoredSharedBook["share"],
    createdAt: record.createdAt.toISOString(),
  };
}
