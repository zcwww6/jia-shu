import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { StoredSharedBook } from "@/shared/types/galaxy";
import { createSharedBook, findSharedBookByToken } from "@/server/db/shared-book-repo";

const LEGACY_SHARED_BOOKS_FILE = path.join(process.cwd(), ".local-data", "shared-books.json");

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

  const stored = await findSharedBookByToken(token);
  if (stored) {
    return stored;
  }

  return readLegacySharedBook(token);
}

async function readLegacySharedBook(token: string): Promise<StoredSharedBook | null> {
  try {
    const raw = await readFile(LEGACY_SHARED_BOOKS_FILE, "utf8");
    const parsed = JSON.parse(raw) as Record<string, StoredSharedBook>;
    return parsed[token] ?? null;
  } catch {
    return null;
  }
}
