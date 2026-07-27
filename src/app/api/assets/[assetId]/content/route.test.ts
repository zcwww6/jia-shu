// @vitest-environment node

import { Readable } from "node:stream";

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  auth,
  resolvePersonalGalaxyScope,
  findActiveAsset,
  readPrivateAsset,
  safeFileName,
} = vi.hoisted(() => ({
  auth: vi.fn(),
  resolvePersonalGalaxyScope: vi.fn(),
  findActiveAsset: vi.fn(),
  readPrivateAsset: vi.fn(),
  safeFileName: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth }));
vi.mock("@/server/db/galaxy-repo", () => ({ resolvePersonalGalaxyScope }));
vi.mock("@/server/db/asset-repo", () => ({ findActiveAsset }));
vi.mock("@/server/media/media-store", () => ({ readPrivateAsset, safeFileName }));

import { GET } from "./route";

function assetContext(assetId = "asset-1") {
  return { params: Promise.resolve({ assetId }) };
}

describe("GET /api/assets/[assetId]/content", () => {
  beforeEach(() => {
    auth.mockReset();
    resolvePersonalGalaxyScope.mockReset();
    findActiveAsset.mockReset();
    readPrivateAsset.mockReset();
    safeFileName.mockReset();
  });

  it("streams a stored owner asset with private safe response headers", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    findActiveAsset.mockResolvedValue({
      id: "asset-1",
      storageKey: "user-1/as/asset-1.jpg",
      status: "stored",
      mimeType: "image/jpeg",
      originalName: "../family photo.jpg",
    });
    safeFileName.mockReturnValue("family_photo.jpg");
    readPrivateAsset.mockResolvedValue(Readable.from([Buffer.from("asset bytes")]));

    const response = await GET(new Request("http://localhost/api/assets/asset-1/content"), assetContext());

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("asset bytes");
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Disposition")).toBe("inline; filename=family_photo.jpg");
    expect(findActiveAsset).toHaveBeenCalledWith({
      userId: "user-1",
      galaxyId: "galaxy-1",
      assetId: "asset-1",
    });
    expect(readPrivateAsset).toHaveBeenCalledWith("user-1/as/asset-1.jpg");
    expect(safeFileName).toHaveBeenCalledWith("../family photo.jpg");
  });

  it("returns the same 404 shape before scope lookup when unauthenticated", async () => {
    auth.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/assets/asset-1/content"), assetContext());

    expect(response.status).toBe(404);
    expect(resolvePersonalGalaxyScope).not.toHaveBeenCalled();
    expect(findActiveAsset).not.toHaveBeenCalled();
    expect(readPrivateAsset).not.toHaveBeenCalled();
  });

  it("returns 404 without reading when the scoped owner cannot find the asset", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    findActiveAsset.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/assets/other-owner/content"), assetContext("other-owner"));

    expect(response.status).toBe(404);
    expect(readPrivateAsset).not.toHaveBeenCalled();
  });

  it("returns the same 404 for an absent asset identifier", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    findActiveAsset.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/assets/missing/content"), assetContext("missing"));

    expect(response.status).toBe(404);
    expect(readPrivateAsset).not.toHaveBeenCalled();
  });

  it("returns 404 without reading an asset that is not stored or ready", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    findActiveAsset.mockResolvedValue({
      id: "asset-1",
      storageKey: "user-1/as/asset-1.jpg",
      status: "processing",
      mimeType: "image/jpeg",
      originalName: "photo.jpg",
    });

    const response = await GET(new Request("http://localhost/api/assets/asset-1/content"), assetContext());

    expect(response.status).toBe(404);
    expect(readPrivateAsset).not.toHaveBeenCalled();
  });

  it("returns 404 when the caller cannot resolve a personal galaxy scope", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockRejectedValue(new Error("scope lookup failed"));

    const response = await GET(new Request("http://localhost/api/assets/asset-1/content"), assetContext());

    expect(response.status).toBe(404);
    expect(findActiveAsset).not.toHaveBeenCalled();
    expect(readPrivateAsset).not.toHaveBeenCalled();
  });

  it("also streams an owner asset that is ready", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    findActiveAsset.mockResolvedValue({
      id: "asset-1",
      storageKey: "user-1/as/asset-1.jpg",
      status: "ready",
      mimeType: "image/jpeg",
      originalName: "photo.jpg",
    });
    safeFileName.mockReturnValue("photo.jpg");
    readPrivateAsset.mockResolvedValue(Readable.from([Buffer.from("ready bytes")]));

    const response = await GET(new Request("http://localhost/api/assets/asset-1/content"), assetContext());

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("ready bytes");
  });

  it("returns 404 without exposing a missing private backing file", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    findActiveAsset.mockResolvedValue({
      id: "asset-1",
      storageKey: "user-1/as/asset-1.jpg",
      status: "stored",
      mimeType: "image/jpeg",
      originalName: "photo.jpg",
    });
    readPrivateAsset.mockRejectedValue(new Error("ENOENT: /private/media/user-1/as/asset-1.jpg"));

    const response = await GET(new Request("http://localhost/api/assets/asset-1/content"), assetContext());
    const body = await response.text();

    expect(response.status).toBe(404);
    expect(body).not.toContain("ENOENT");
    expect(body).not.toContain("/private/media");
  });
});
