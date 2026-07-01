import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

import type { StoredSharedBook } from "@/shared/types/galaxy";

/**
 * 最小持久化：单文件 JSON 存储 token → 共享家书。
 * 零依赖，本地 next dev/start 跨重启存活。
 * 部署到 Vercel 等无状态平台时文件系统是临时的，第 4 周可换为 Vercel KV / Postgres。
 */
const DATA_DIR = path.join(process.cwd(), ".local-data");
const DATA_FILE = path.join(DATA_DIR, "shared-books.json");

type StoreMap = Record<string, StoredSharedBook>;

async function readStore(): Promise<StoreMap> {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw) as StoreMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeStore(store: StoreMap): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(store, null, 2), "utf8");
}

export async function saveSharedBook(
  record: Omit<StoredSharedBook, "token" | "createdAt">,
): Promise<StoredSharedBook> {
  const token = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const stored: StoredSharedBook = {
    ...record,
    token,
    createdAt: new Date().toISOString(),
  };

  const store = await readStore();
  store[token] = stored;
  await writeStore(store);

  return stored;
}

export async function getSharedBook(token: string): Promise<StoredSharedBook | null> {
  if (!token) return null;
  const store = await readStore();
  return store[token] ?? null;
}
