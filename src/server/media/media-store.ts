import { mkdir, open, writeFile } from "node:fs/promises";
import path from "node:path";

import { env } from "../config/env";
import { DomainError } from "../domain-error";

const OPAQUE_ID = /^[A-Za-z0-9_-]+$/;
const EXTENSION = /^[A-Za-z0-9]+$/;

function invalidStorageKey(): never {
  throw new DomainError("INVALID_STORAGE_KEY", 400);
}

function isGeneratedStorageKey(key: string) {
  if (path.isAbsolute(key)) {
    return false;
  }

  const [userId, prefix, fileName, ...rest] = key.split("/");
  const extensionIndex = fileName?.lastIndexOf(".") ?? -1;

  if (rest.length > 0 || extensionIndex < 1) {
    return false;
  }

  const assetId = fileName.slice(0, extensionIndex);
  const extension = fileName.slice(extensionIndex + 1);

  return (
    OPAQUE_ID.test(userId)
    && OPAQUE_ID.test(prefix)
    && OPAQUE_ID.test(assetId)
    && EXTENSION.test(extension)
    && prefix === assetId.slice(0, 2)
  );
}

function resolvePrivateAssetPath(root: string, key: string) {
  if (!isGeneratedStorageKey(key)) {
    invalidStorageKey();
  }

  const resolvedRoot = path.resolve(root);
  const targetPath = path.resolve(resolvedRoot, key);
  const relativePath = path.relative(resolvedRoot, targetPath);

  if (
    relativePath === ""
    || relativePath === ".."
    || relativePath.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativePath)
  ) {
    invalidStorageKey();
  }

  return targetPath;
}

export function createStorageKey(input: {
  userId: string;
  assetId: string;
  extension: string;
}) {
  if (
    !OPAQUE_ID.test(input.userId)
    || !OPAQUE_ID.test(input.assetId)
    || !EXTENSION.test(input.extension)
  ) {
    invalidStorageKey();
  }

  return `${input.userId}/${input.assetId.slice(0, 2)}/${input.assetId}.${input.extension}`;
}

export function createDerivativeStorageKey(input: {
  userId: string;
  assetId: string;
  extension: string;
  variant: "normalized" | "thumbnail";
}) {
  return createStorageKey({
    userId: input.userId,
    assetId: `${input.assetId}_${input.variant}`,
    extension: input.extension,
  });
}

export function safeFileName(fileName: string) {
  if (!fileName.trim()) {
    return "attachment";
  }

  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "attachment";
}

export function createPrivateMediaStore(root: string) {
  return {
    async writePrivateAsset(key: string, bytes: Uint8Array) {
      const targetPath = resolvePrivateAssetPath(root, key);

      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFile(targetPath, bytes, { flag: "wx" });
    },
    async readPrivateAsset(key: string) {
      const targetPath = resolvePrivateAssetPath(root, key);
      const file = await open(targetPath, "r");

      return file.createReadStream();
    },
  };
}

export async function writePrivateAsset(key: string, bytes: Uint8Array) {
  await createPrivateMediaStore(env.MEDIA_STORAGE_ROOT).writePrivateAsset(key, bytes);
}

export async function readPrivateAsset(key: string) {
  return createPrivateMediaStore(env.MEDIA_STORAGE_ROOT).readPrivateAsset(key);
}

/**
 * Worker-only convenience for server-selected keys. Callers must validate
 * ownership before reaching this helper; the cap protects a stale or corrupt
 * file from becoming an unbounded provider payload.
 */
export async function readPrivateAssetBytes(key: string, maxBytes: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new DomainError("ASSET_READ_LIMIT", 422);
  }

  const stream = await readPrivateAsset(key);
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += bytes.byteLength;

    if (totalBytes > maxBytes) {
      stream.destroy();
      throw new DomainError("ASSET_READ_LIMIT", 422);
    }

    chunks.push(bytes);
  }

  return new Uint8Array(Buffer.concat(chunks));
}
