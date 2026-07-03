import crypto from "node:crypto";

import type { StoredSharedBook } from "@/shared/types/galaxy";
import { createSharedBook, findSharedBookByToken } from "@/server/db/shared-book-repo";

export async function saveSharedBook(
  record: Omit<StoredSharedBook, "token" | "createdAt"> & { userId: string },
): Promise<StoredSharedBook> {
  const token = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const createdAt = new Date().toISOString();

  return createSharedBook({
    userId: record.userId,
    draft: record.draft,
    body: record.body,
    sections: record.sections,
    share: record.share,
    token,
    createdAt,
  });
}

export async function getSharedBook(token: string): Promise<StoredSharedBook | null> {
  if (!token) return null;
  return findSharedBookByToken(token);
}
