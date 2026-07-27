import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/server/domain-error";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
const { resolvePersonalGalaxyScope } = vi.hoisted(() => ({ resolvePersonalGalaxyScope: vi.fn() }));
const { createAssetBackedMemory } = vi.hoisted(() => ({ createAssetBackedMemory: vi.fn() }));

vi.mock("@/auth", () => ({ auth }));
vi.mock("@/server/db/galaxy-repo", () => ({ resolvePersonalGalaxyScope }));
vi.mock("@/server/services/memory.service", () => ({ createAssetBackedMemory }));

import { POST } from "./route";

const planetId = "ck8m3x8xy000000000000000";

function request(body: unknown, headers: HeadersInit = {}) {
  return new Request("http://localhost/api/memories", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/memories", () => {
  beforeEach(() => {
    auth.mockReset();
    resolvePersonalGalaxyScope.mockReset();
    createAssetBackedMemory.mockReset();
  });

  it("rejects unauthenticated creation before looking up a personal galaxy", async () => {
    auth.mockResolvedValue(null);

    const response = await POST(request({ planetId, sourceText: "一段记忆" }, {
      "Idempotency-Key": "memory-create-key-00001",
    }));

    expect(response.status).toBe(401);
    expect(resolvePersonalGalaxyScope).not.toHaveBeenCalled();
    expect(createAssetBackedMemory).not.toHaveBeenCalled();
  });

  it("rejects a missing idempotency key or an invalid memory body before resolving scope", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });

    const missingKey = await POST(request({ planetId, sourceText: "一段记忆" }));
    expect(missingKey.status).toBe(400);
    await expect(missingKey.json()).resolves.toMatchObject({ code: "IDEMPOTENCY_KEY_INVALID" });

    const invalidBody = await POST(request({ planetId: "planet-1", sourceText: "一段记忆" }, {
      "Idempotency-Key": "memory-create-key-00001",
    }));
    expect(invalidBody.status).toBe(400);
    await expect(invalidBody.json()).resolves.toMatchObject({ code: "MEMORY_INPUT_INVALID" });
    expect(resolvePersonalGalaxyScope).not.toHaveBeenCalled();
    expect(createAssetBackedMemory).not.toHaveBeenCalled();
  });

  it("creates a scoped safe draft DTO instead of trusting a browser galaxy id", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    createAssetBackedMemory.mockResolvedValue({
      kind: "completed",
      operationId: "operation-1",
      status: 201,
      response: {
        id: "memory-1",
        planetId,
        sourceText: "一段记忆",
        title: null,
        summary: null,
        tags: null,
        occurredAtLabel: null,
        visibility: "private",
        allowResonance: false,
        allowBook: false,
        status: "draft",
        confirmedAt: null,
        version: 1,
      },
    });

    const response = await POST(request({
      planetId,
      sourceText: "一段记忆",
      visibility: "private",
      galaxyId: "attacker-galaxy",
    }, { "Idempotency-Key": "memory-create-key-00001" }));

    expect(response.status).toBe(400);
    expect(createAssetBackedMemory).not.toHaveBeenCalled();

    const safeResponse = await POST(request({ planetId, sourceText: "一段记忆", visibility: "private" }, {
      "Idempotency-Key": "memory-create-key-00001",
    }));
    expect(safeResponse.status).toBe(201);
    await expect(safeResponse.json()).resolves.toMatchObject({ status: "draft", confirmedAt: null });
    expect(createAssetBackedMemory).toHaveBeenCalledWith(
      { userId: "user-1", galaxyId: "galaxy-1" },
      expect.objectContaining({ planetId, sourceText: "一段记忆", idempotencyKey: "memory-create-key-00001" }),
    );
  });

  it("maps a service idempotency conflict without exposing persistence details", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    createAssetBackedMemory.mockRejectedValue(new DomainError("IDEMPOTENCY_CONFLICT", 409, "幂等请求与原始请求不一致。"));

    const response = await POST(request({ planetId, sourceText: "一段记忆" }, {
      "Idempotency-Key": "memory-create-key-00001",
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      code: "IDEMPOTENCY_CONFLICT",
      message: "幂等请求与原始请求不一致。",
    });
  });

  it("accepts only browser-safe asset ids and optional text when creating a draft", async () => {
    const imageAssetId = "e4c4ac66-3c6a-4c65-9d2a-d3b25e45be36";
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    createAssetBackedMemory.mockResolvedValue({
      kind: "completed",
      operationId: "operation-1",
      status: 201,
      response: {
        id: "memory-asset-1",
        planetId,
        sourceText: "照片拍摄在搬家那天。",
        title: null,
        summary: null,
        tags: null,
        occurredAtLabel: null,
        visibility: "private",
        allowResonance: false,
        allowBook: false,
        status: "draft",
        confirmedAt: null,
        version: 1,
      },
    });

    const response = await POST(request({
      planetId,
      assetIds: [imageAssetId],
      sourceText: "照片拍摄在搬家那天。",
      visibility: "private",
    }, { "Idempotency-Key": "memory-asset-create-key-01" }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      id: "memory-asset-1",
      status: "draft",
      confirmedAt: null,
    });
    expect(createAssetBackedMemory).toHaveBeenCalledWith(
      { userId: "user-1", galaxyId: "galaxy-1" },
      {
        planetId,
        assetIds: [imageAssetId],
        sourceText: "照片拍摄在搬家那天。",
        visibility: "private",
        idempotencyKey: "memory-asset-create-key-01",
      },
    );
  });
});
