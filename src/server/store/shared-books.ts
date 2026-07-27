import { randomBytes } from "node:crypto";

import type { StoredSharedBook } from "@/shared/types/galaxy";
import { findSharedBookByToken } from "@/server/db/shared-book-repo";

/**
 * Share tokens are generated exclusively on the server. 32 random bytes make
 * the public token unguessable while preserving a URL-safe representation.
 */
export function createSharedBookToken() {
  return randomBytes(32).toString("base64url");
}

export async function getSharedBook(token: string): Promise<StoredSharedBook | null> {
  if (!token) {
    return null;
  }

  return findSharedBookByToken(token);
}
