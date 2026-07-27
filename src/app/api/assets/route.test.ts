// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/server/domain-error";

const VALID_PLANET_ID = "ck8m3x8xy000000000000000";

const {
  auth,
  resolvePersonalGalaxyScope,
  findActivePlanet,
  createAsset,
  updateAssetStatus,
  validateAsset,
  createStorageKey,
  createDerivativeStorageKey,
  writePrivateAsset,
} = vi.hoisted(() => ({
  auth: vi.fn(),
  resolvePersonalGalaxyScope: vi.fn(),
  findActivePlanet: vi.fn(),
  createAsset: vi.fn(),
  updateAssetStatus: vi.fn(),
  validateAsset: vi.fn(),
  createStorageKey: vi.fn(),
  createDerivativeStorageKey: vi.fn(),
  writePrivateAsset: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth }));
vi.mock("@/server/db/galaxy-repo", () => ({ resolvePersonalGalaxyScope }));
vi.mock("@/server/db/planet-repo", () => ({ findActivePlanet }));
vi.mock("@/server/db/asset-repo", () => ({ createAsset, updateAssetStatus }));
vi.mock("@/server/media/asset-validation", () => ({ validateAsset }));
vi.mock("@/server/media/media-store", () => ({
  createStorageKey,
  createDerivativeStorageKey,
  writePrivateAsset,
}));

import { POST } from "./route";

function multipartRequest(input: {
  planetId?: string;
  kind?: string;
  visibility?: string;
  file?: { bytes?: Uint8Array; type?: string; name?: string };
} = {}) {
  const form = new FormData();
  const sourceBytes = input.file?.bytes ?? new Uint8Array([1, 2, 3]);
  const blobBytes = new Uint8Array(sourceBytes.byteLength);
  blobBytes.set(sourceBytes);

  form.set("file", new Blob([
    blobBytes,
  ], { type: input.file?.type ?? "image/jpeg" }), input.file?.name ?? "photo.jpg");
  form.set("planetId", input.planetId ?? VALID_PLANET_ID);
  form.set("kind", input.kind ?? "image");

  if (input.visibility !== undefined) {
    form.set("visibility", input.visibility);
  }

  return new Request("http://localhost/api/assets", {
    method: "POST",
    body: form,
  });
}

function malformedMultipartRequest() {
  const form = new FormData();
  form.set("planetId", VALID_PLANET_ID);
  form.set("kind", "image");

  return new Request("http://localhost/api/assets", {
    method: "POST",
    body: form,
  });
}

describe("POST /api/assets", () => {
  beforeEach(() => {
    auth.mockReset();
    resolvePersonalGalaxyScope.mockReset();
    findActivePlanet.mockReset();
    createAsset.mockReset();
    updateAssetStatus.mockReset();
    validateAsset.mockReset();
    createStorageKey.mockReset();
    createDerivativeStorageKey.mockReset();
    writePrivateAsset.mockReset();
  });

  it("stores validated bytes privately and returns a safe stored asset DTO", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    findActivePlanet.mockResolvedValue({ id: VALID_PLANET_ID });
    validateAsset.mockResolvedValue({
      trustedMime: "image/jpeg",
      extension: "jpg",
      kind: "image",
      sizeBytes: 3,
      metadata: { width: 640, height: 480 },
      derivatives: {
        normalizedBytes: new Uint8Array([4, 5]),
        thumbnailBytes: new Uint8Array([6, 7]),
      },
    });
    createStorageKey.mockReturnValue("user-1/as/original.jpg");
    createDerivativeStorageKey
      .mockReturnValueOnce("user-1/as/normalized.jpg")
      .mockReturnValueOnce("user-1/as/thumbnail.jpg");
    createAsset.mockImplementation(async (input) => ({
      ...input,
      createdAt: new Date("2026-07-17T00:00:00.000Z"),
    }));
    writePrivateAsset.mockResolvedValue(undefined);
    updateAssetStatus.mockResolvedValue(undefined);

    const response = await POST(multipartRequest());
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(validateAsset).toHaveBeenCalledWith({
      declaredMime: "image/jpeg",
      bytes: new Uint8Array([1, 2, 3]),
      originalName: "photo.jpg",
      kind: "image",
    });
    expect(createAsset).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      galaxyId: "galaxy-1",
      planetId: VALID_PLANET_ID,
      kind: "image",
      visibility: "private",
      storageKey: "user-1/as/original.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 3,
      sha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
      originalName: "photo.jpg",
      width: 640,
      height: 480,
      normalizedStorageKey: "user-1/as/normalized.jpg",
      thumbnailStorageKey: "user-1/as/thumbnail.jpg",
      status: "processing",
    }));
    expect(writePrivateAsset).toHaveBeenNthCalledWith(1, "user-1/as/original.jpg", new Uint8Array([1, 2, 3]));
    expect(writePrivateAsset).toHaveBeenNthCalledWith(2, "user-1/as/normalized.jpg", new Uint8Array([4, 5]));
    expect(writePrivateAsset).toHaveBeenNthCalledWith(3, "user-1/as/thumbnail.jpg", new Uint8Array([6, 7]));
    expect(updateAssetStatus).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      galaxyId: "galaxy-1",
      status: "stored",
    }));
    expect(body).toMatchObject({
      planetId: VALID_PLANET_ID,
      kind: "image",
      visibility: "private",
      mimeType: "image/jpeg",
      sizeBytes: 3,
      originalName: "photo.jpg",
      width: 640,
      height: 480,
      status: "stored",
    });
    expect(JSON.stringify(body)).not.toMatch(/storageKey|sha256|normalizedStorageKey|thumbnailStorageKey/i);
  });

  it.each([
    { label: "PNG", mimeType: "image/png", extension: "png", originalName: "photo.png" },
    { label: "WebP", mimeType: "image/webp", extension: "webp", originalName: "photo.webp" },
  ])("keeps the normalized $label extension but writes JPEG thumbnail bytes under a .jpg key", async ({
    mimeType,
    extension,
    originalName,
  }) => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    findActivePlanet.mockResolvedValue({ id: VALID_PLANET_ID });
    validateAsset.mockResolvedValue({
      trustedMime: mimeType,
      extension,
      kind: "image",
      sizeBytes: 3,
      metadata: { width: 640, height: 480 },
      derivatives: {
        normalizedBytes: new Uint8Array([4, 5]),
        thumbnailBytes: new Uint8Array([6, 7]),
      },
    });
    createStorageKey.mockReturnValue(`user-1/as/original.${extension}`);
    createDerivativeStorageKey.mockImplementation(({ variant, extension: derivativeExtension }) => (
      `user-1/as/${variant}.${derivativeExtension}`
    ));
    createAsset.mockImplementation(async (input) => ({
      ...input,
      createdAt: new Date("2026-07-17T00:00:00.000Z"),
    }));
    writePrivateAsset.mockResolvedValue(undefined);
    updateAssetStatus.mockResolvedValue(undefined);

    const response = await POST(multipartRequest({
      file: { bytes: new Uint8Array([1, 2, 3]), type: mimeType, name: originalName },
    }));

    expect(response.status).toBe(201);
    expect(createDerivativeStorageKey).toHaveBeenNthCalledWith(1, expect.objectContaining({
      extension,
      variant: "normalized",
    }));
    expect(createDerivativeStorageKey).toHaveBeenNthCalledWith(2, expect.objectContaining({
      extension: "jpg",
      variant: "thumbnail",
    }));
    expect(writePrivateAsset).toHaveBeenNthCalledWith(2, `user-1/as/normalized.${extension}`, new Uint8Array([4, 5]));
    expect(writePrivateAsset).toHaveBeenNthCalledWith(3, "user-1/as/thumbnail.jpg", new Uint8Array([6, 7]));
  });

  it("rejects an empty text/plain upload before creating or writing an asset", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    findActivePlanet.mockResolvedValue({ id: VALID_PLANET_ID });
    validateAsset.mockResolvedValue({
      trustedMime: "text/plain",
      extension: "txt",
      kind: "document",
      sizeBytes: 0,
      metadata: { extractedText: "" },
      derivatives: {},
    });
    createStorageKey.mockReturnValue("user-1/as/original.txt");
    createAsset.mockImplementation(async (input) => ({
      ...input,
      createdAt: new Date("2026-07-17T00:00:00.000Z"),
    }));
    writePrivateAsset.mockResolvedValue(undefined);
    updateAssetStatus.mockResolvedValue(undefined);

    const response = await POST(multipartRequest({
      kind: "document",
      file: { bytes: new Uint8Array(), type: "text/plain", name: "empty.txt" },
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "ASSET_UPLOAD_INVALID",
      message: "上传内容格式不正确。",
    });
    expect(createAsset).not.toHaveBeenCalled();
    expect(writePrivateAsset).not.toHaveBeenCalled();
  });

  it("rejects an empty Markdown upload before creating or writing an asset", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    findActivePlanet.mockResolvedValue({ id: VALID_PLANET_ID });
    validateAsset.mockResolvedValue({
      trustedMime: "text/markdown",
      extension: "md",
      kind: "document",
      sizeBytes: 0,
      metadata: { extractedText: "" },
      derivatives: {},
    });
    createStorageKey.mockReturnValue("user-1/as/original.md");
    createAsset.mockImplementation(async (input) => ({
      ...input,
      createdAt: new Date("2026-07-17T00:00:00.000Z"),
    }));
    writePrivateAsset.mockResolvedValue(undefined);
    updateAssetStatus.mockResolvedValue(undefined);

    const response = await POST(multipartRequest({
      kind: "document",
      file: { bytes: new Uint8Array(), type: "text/markdown", name: "empty.md" },
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "ASSET_UPLOAD_INVALID",
      message: "上传内容格式不正确。",
    });
    expect(createAsset).not.toHaveBeenCalled();
    expect(writePrivateAsset).not.toHaveBeenCalled();
  });

  it("rejects a validated asset with a nonpositive trusted size before creating or writing", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    findActivePlanet.mockResolvedValue({ id: VALID_PLANET_ID });
    validateAsset.mockResolvedValue({
      trustedMime: "text/plain",
      extension: "txt",
      kind: "document",
      sizeBytes: 0,
      metadata: { extractedText: "a" },
      derivatives: {},
    });
    createStorageKey.mockReturnValue("user-1/as/original.txt");
    createAsset.mockImplementation(async (input) => ({
      ...input,
      createdAt: new Date("2026-07-17T00:00:00.000Z"),
    }));
    writePrivateAsset.mockResolvedValue(undefined);
    updateAssetStatus.mockResolvedValue(undefined);

    const response = await POST(multipartRequest({
      kind: "document",
      file: { bytes: new Uint8Array([97]), type: "text/plain", name: "memory.txt" },
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "ASSET_UPLOAD_INVALID",
      message: "上传内容格式不正确。",
    });
    expect(createAsset).not.toHaveBeenCalled();
    expect(writePrivateAsset).not.toHaveBeenCalled();
  });

  it("returns 401 before resolving a scope when the caller is not signed in", async () => {
    auth.mockResolvedValue(null);

    const response = await POST(multipartRequest());

    expect(response.status).toBe(401);
    expect(resolvePersonalGalaxyScope).not.toHaveBeenCalled();
    expect(createAsset).not.toHaveBeenCalled();
  });

  it("does not upload into a planet outside the caller's personal galaxy", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    findActivePlanet.mockResolvedValue(null);

    const response = await POST(multipartRequest());

    expect(response.status).toBe(404);
    expect(validateAsset).not.toHaveBeenCalled();
    expect(createAsset).not.toHaveBeenCalled();
    expect(writePrivateAsset).not.toHaveBeenCalled();
  });

  it("returns a safe DomainError response when upload validation rejects the file", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    findActivePlanet.mockResolvedValue({ id: VALID_PLANET_ID });
    validateAsset.mockRejectedValue(new DomainError("ASSET_MIME_MISMATCH", 415, "文件类型与内容不匹配。"));

    const response = await POST(multipartRequest());

    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toEqual({
      code: "ASSET_MIME_MISMATCH",
      message: "文件类型与内容不匹配。",
    });
    expect(createAsset).not.toHaveBeenCalled();
    expect(writePrivateAsset).not.toHaveBeenCalled();
  });

  it("marks the asset failed and hides storage details when a private write fails", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    findActivePlanet.mockResolvedValue({ id: VALID_PLANET_ID });
    validateAsset.mockResolvedValue({
      trustedMime: "image/jpeg",
      extension: "jpg",
      kind: "image",
      sizeBytes: 3,
      metadata: { width: 640, height: 480 },
      derivatives: {},
    });
    createStorageKey.mockReturnValue("user-1/as/original.jpg");
    createAsset.mockImplementation(async (input) => ({
      ...input,
      createdAt: new Date("2026-07-17T00:00:00.000Z"),
    }));
    writePrivateAsset.mockRejectedValue(new Error("EACCES: /private/media/original.jpg"));
    updateAssetStatus.mockResolvedValue(undefined);

    const response = await POST(multipartRequest());
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(body)).toEqual({
      code: "ASSET_STORAGE_FAILED",
      message: "资源保存失败，请稍后重试。",
    });
    expect(body).not.toContain("EACCES");
    expect(body).not.toContain("/private/media");
    expect(updateAssetStatus).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  });

  it("returns a generic 500 without leaking unknown implementation failures", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockRejectedValue(new Error("sharp failed at /private/media/secret.jpg"));

    const response = await POST(multipartRequest());
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(body)).toEqual({
      code: "INTERNAL_ERROR",
      message: "请求无法完成，请稍后重试。",
    });
    expect(body).not.toContain("sharp");
    expect(body).not.toContain("/private/media");
  });

  it("rejects malformed multipart uploads before resolving the target planet", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });

    const response = await POST(malformedMultipartRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "ASSET_UPLOAD_INVALID",
      message: "上传内容格式不正确。",
    });
    expect(findActivePlanet).not.toHaveBeenCalled();
    expect(validateAsset).not.toHaveBeenCalled();
  });

  it("rejects a request whose multipart body cannot be parsed", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    const malformedRequest = {
      formData: vi.fn().mockRejectedValue(new Error("invalid multipart boundary")),
    } as unknown as Request;

    const response = await POST(malformedRequest);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "ASSET_UPLOAD_INVALID",
      message: "上传内容格式不正确。",
    });
    expect(findActivePlanet).not.toHaveBeenCalled();
  });

  it("rejects an unrecognized asset kind before it reaches validation", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });

    const response = await POST(multipartRequest({ kind: "text" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "ASSET_UPLOAD_INVALID",
      message: "上传内容格式不正确。",
    });
    expect(validateAsset).not.toHaveBeenCalled();
  });

  it("rejects an unsupported asset visibility", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });

    const response = await POST(multipartRequest({ visibility: "public" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "ASSET_UPLOAD_INVALID",
      message: "上传内容格式不正确。",
    });
    expect(validateAsset).not.toHaveBeenCalled();
  });

  it("rejects an invalid planet CUID before scope-bound planet lookup or storage", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });

    const response = await POST(multipartRequest({ planetId: "planet-1" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "ASSET_UPLOAD_INVALID",
      message: "上传内容格式不正确。",
    });
    expect(findActivePlanet).not.toHaveBeenCalled();
    expect(createAsset).not.toHaveBeenCalled();
    expect(writePrivateAsset).not.toHaveBeenCalled();
  });

  it("rejects a missing planet identifier before it can be scoped", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });

    const response = await POST(multipartRequest({ planetId: "" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "ASSET_UPLOAD_INVALID",
      message: "上传内容格式不正确。",
    });
    expect(findActivePlanet).not.toHaveBeenCalled();
  });
});
