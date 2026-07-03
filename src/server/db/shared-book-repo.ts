import type { Prisma } from "@prisma/client";

import type { StoredSharedBook } from "@/shared/types/galaxy";
import { getPrismaClient } from "@/server/db/client";

type SharedBookRecord = {
  token: string;
  draft: Prisma.JsonValue;
  body: string;
  sections: Prisma.JsonValue;
  share: Prisma.JsonValue;
  createdAt: Date;
};

export async function createSharedBook(input: {
  userId: string;
  token: string;
  draft: StoredSharedBook["draft"];
  body: string;
  sections: StoredSharedBook["sections"];
  share: StoredSharedBook["share"];
  createdAt: string;
}) {
  const prisma = getPrismaClient();

  const record = await prisma.sharedBook.create({
    data: {
      userId: input.userId,
      token: input.token,
      draft: toInputJsonValue(input.draft),
      body: input.body,
      sections: toInputJsonValue(input.sections),
      share: toInputJsonValue(input.share),
      createdAt: new Date(input.createdAt),
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

  return mapStoredSharedBook(record);
}

export async function findSharedBookByToken(token: string) {
  const prisma = getPrismaClient();

  const record = await prisma.sharedBook.findUnique({
    where: { token },
    select: {
      token: true,
      draft: true,
      body: true,
      sections: true,
      share: true,
      createdAt: true,
    },
  });

  if (!record) {
    return null;
  }

  return mapStoredSharedBook(record);
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

function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
