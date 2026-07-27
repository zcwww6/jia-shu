import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

const mediaEnv = vi.hoisted(() => ({
  env: { MEDIA_STORAGE_ROOT: "" },
}));

vi.mock("../config/env", () => mediaEnv);

import { DomainError } from "../domain-error";
import * as mediaStore from "./media-store";
import {
  createPrivateMediaStore,
  createStorageKey,
  readPrivateAssetBytes,
  safeFileName,
  writePrivateAsset,
} from "./media-store";

const temporaryRoots: string[] = [];

async function createTemporaryRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "media-store-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
  mediaEnv.env.MEDIA_STORAGE_ROOT = "";
});

describe("media store", () => {
  it("generates an opaque derivative storage key", () => {
    const createDerivativeStorageKey = (mediaStore as typeof mediaStore & {
      createDerivativeStorageKey: (input: {
        userId: string;
        assetId: string;
        extension: string;
        variant: "normalized" | "thumbnail";
      }) => string;
    }).createDerivativeStorageKey;

    expect(createDerivativeStorageKey({
      userId: "user_123",
      assetId: "asset_abcdef",
      extension: "jpg",
      variant: "normalized",
    })).toBe("user_123/as/asset_abcdef_normalized.jpg");
  });

  it("generates a partitioned opaque storage key", () => {
    const key = createStorageKey({
      userId: "user_123",
      assetId: "asset_abcdef",
      extension: "jpg",
    });

    expect(key).toBe("user_123/as/asset_abcdef.jpg");
  });

  it("rejects a caller-controlled user path segment", () => {
    expect(() => createStorageKey({
      userId: "../user",
      assetId: "asset_abcdef",
      extension: "jpg",
    })).toThrow(DomainError);
  });

  it("rejects a caller-controlled asset path segment", () => {
    expect(() => createStorageKey({
      userId: "user_123",
      assetId: "../asset",
      extension: "jpg",
    })).toThrow(DomainError);
  });

  it("rejects a caller-controlled extension path segment", () => {
    expect(() => createStorageKey({
      userId: "user_123",
      assetId: "asset_abcdef",
      extension: "../jpg",
    })).toThrow(DomainError);
  });

  it("uses attachment when the filename is empty", () => {
    expect(safeFileName(" ")).toBe("attachment");
  });

  it("maps non-whitelisted filename characters to underscores", () => {
    expect(safeFileName("../<invo\"ice>\u0000.pdf")).toBe("..__invo_ice__.pdf");
  });

  it("limits filenames to 120 characters", () => {
    expect(safeFileName("a".repeat(121))).toHaveLength(120);
  });

  it("uses the configured media root through the public two-argument API", async () => {
    const root = await createTemporaryRoot();
    mediaEnv.env.MEDIA_STORAGE_ROOT = root;
    const key = createStorageKey({
      userId: "user_123",
      assetId: "asset_abcdef",
      extension: "jpg",
    });
    const bytes = new Uint8Array([1, 2, 3]);

    expect(writePrivateAsset).toHaveLength(2);
    await writePrivateAsset(key, bytes);

    await expect(readFile(path.join(root, "user_123", "as", "asset_abcdef.jpg")))
      .resolves.toEqual(Buffer.from(bytes));
  });

  it("uses the configured media root through the public private-read API", async () => {
    const root = await createTemporaryRoot();
    mediaEnv.env.MEDIA_STORAGE_ROOT = root;
    const key = createStorageKey({
      userId: "user_123",
      assetId: "asset_abcdef",
      extension: "jpg",
    });
    const bytes = new Uint8Array([1, 2, 3]);
    const readPrivateAsset = (mediaStore as typeof mediaStore & {
      readPrivateAsset: (storageKey: string) => Promise<AsyncIterable<Uint8Array>>;
    }).readPrivateAsset;

    await writePrivateAsset(key, bytes);
    const stream = await readPrivateAsset(key);
    const chunks: Uint8Array[] = [];

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(Buffer.concat(chunks)).toEqual(Buffer.from(bytes));
  });

  it("reads server-selected private bytes with a hard cap for a consented worker", async () => {
    const root = await createTemporaryRoot();
    mediaEnv.env.MEDIA_STORAGE_ROOT = root;
    const key = createStorageKey({
      userId: "user_123",
      assetId: "asset_abcdef",
      extension: "wav",
    });
    await writePrivateAsset(key, new Uint8Array([1, 2, 3]));

    await expect(readPrivateAssetBytes(key, 3)).resolves.toEqual(new Uint8Array([1, 2, 3]));
    await expect(readPrivateAssetBytes(key, 2)).rejects.toMatchObject({
      code: "ASSET_READ_LIMIT",
      status: 422,
    });
  });

  it("reads a generated private asset as a stream", async () => {
    const root = await createTemporaryRoot();
    const key = createStorageKey({
      userId: "user_123",
      assetId: "asset_abcdef",
      extension: "jpg",
    });
    const bytes = new Uint8Array([1, 2, 3]);
    const store = createPrivateMediaStore(root) as ReturnType<typeof createPrivateMediaStore> & {
      readPrivateAsset: (storageKey: string) => Promise<AsyncIterable<Uint8Array>>;
    };

    await store.writePrivateAsset(key, bytes);
    const stream = await store.readPrivateAsset(key);
    const chunks: Uint8Array[] = [];

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(Buffer.concat(chunks)).toEqual(Buffer.from(bytes));
  });

  it("rejects traversal and a root-prefix sibling key without writing outside root", async () => {
    const root = await createTemporaryRoot();
    const store = createPrivateMediaStore(root);
    const bytes = new Uint8Array([1, 2, 3]);
    const siblingFile = path.join(`${root}-sibling`, "escape.bin");

    const traversalError = await store.writePrivateAsset("../escape.bin", bytes)
      .catch((error: unknown) => error);
    const siblingError = await store.writePrivateAsset(siblingFile, bytes)
      .catch((error: unknown) => error);

    expect(traversalError).toBeInstanceOf(DomainError);
    expect(traversalError).toMatchObject({ code: "INVALID_STORAGE_KEY", status: 400 });
    expect(siblingError).toBeInstanceOf(DomainError);
    expect(siblingError).toMatchObject({ code: "INVALID_STORAGE_KEY", status: 400 });
    await expect(readFile(siblingFile)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not overwrite the first write for the same generated key", async () => {
    const root = await createTemporaryRoot();
    const store = createPrivateMediaStore(root);
    const key = createStorageKey({
      userId: "user_123",
      assetId: "asset_abcdef",
      extension: "jpg",
    });
    const firstBytes = new Uint8Array([1, 2, 3]);
    const secondBytes = new Uint8Array([4, 5, 6]);

    await store.writePrivateAsset(key, firstBytes);

    await expect(store.writePrivateAsset(key, secondBytes))
      .rejects.toMatchObject({ code: "EEXIST" });
    await expect(readFile(path.join(root, "user_123", "as", "asset_abcdef.jpg")))
      .resolves.toEqual(Buffer.from(firstBytes));
  });

  it("uses underscores for every non-whitelisted filename character", () => {
    expect(safeFileName("family/notes?.pdf")).toBe("family_notes_.pdf");
  });
});
