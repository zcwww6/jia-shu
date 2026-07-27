import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/server/domain-error";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
const { ensurePersonalGalaxyScopeForFirstWrite } = vi.hoisted(() => ({
  ensurePersonalGalaxyScopeForFirstWrite: vi.fn(),
}));
const { createFamilyPlanet } = vi.hoisted(() => ({ createFamilyPlanet: vi.fn() }));

vi.mock("@/auth", () => ({ auth }));
vi.mock("@/server/db/galaxy-repo", () => ({ ensurePersonalGalaxyScopeForFirstWrite }));
vi.mock("@/server/services/planet.service", () => ({ createFamilyPlanet }));

import { POST } from "./route";

function request(body: unknown, headers: HeadersInit = {}) {
  return new Request("http://localhost/api/planets", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/planets", () => {
  beforeEach(() => {
    auth.mockReset();
    ensurePersonalGalaxyScopeForFirstWrite.mockReset();
    createFamilyPlanet.mockReset();
  });

  it("rejects an unauthenticated request before resolving any galaxy scope", async () => {
    auth.mockResolvedValue(null);

    const response = await POST(request({ name: "妈妈", type: "parent" }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "UNAUTHENTICATED",
      message: "请先登录后再管理星球。",
    });
    expect(ensurePersonalGalaxyScopeForFirstWrite).not.toHaveBeenCalled();
  });

  it("rejects an invalid Idempotency-Key before an empty galaxy can be created", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });

    const response = await POST(request({ name: "妈妈", type: "parent" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "IDEMPOTENCY_KEY_INVALID",
      message: "幂等键格式不正确。",
    });
    expect(createFamilyPlanet).not.toHaveBeenCalled();
    expect(ensurePersonalGalaxyScopeForFirstWrite).not.toHaveBeenCalled();
  });

  it("rejects an invalid payload before an empty galaxy can be created", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });

    const response = await POST(request({ name: "   ", type: "parent" }, {
      "Idempotency-Key": "invalid-payload-key001",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "PLANET_INPUT_INVALID",
      message: "星球请求格式不正确。",
    });
    expect(ensurePersonalGalaxyScopeForFirstWrite).not.toHaveBeenCalled();
    expect(createFamilyPlanet).not.toHaveBeenCalled();
  });

  it("ensures an empty galaxy only for a valid first write and never trusts body scope ids", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    ensurePersonalGalaxyScopeForFirstWrite.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    createFamilyPlanet.mockResolvedValue({
      kind: "completed",
      operationId: "operation-1",
      status: 201,
      response: { id: "planet-1", name: "妈妈", type: "parent", lifeState: "active" },
    });

    const response = await POST(request({
      name: "妈妈",
      type: "parent",
      visibility: "family",
      position: { x: 10, y: 20 },
    }, { "Idempotency-Key": "create-planet-key-0001" }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ id: "planet-1", type: "parent" });
    expect(createFamilyPlanet).toHaveBeenCalledWith(
      { userId: "user-1", galaxyId: "galaxy-1" },
      expect.objectContaining({
        name: "妈妈",
        type: "parent",
        visibility: "family",
        position: { x: 10, y: 20 },
        idempotencyKey: "create-planet-key-0001",
      }),
    );
    expect(ensurePersonalGalaxyScopeForFirstWrite).toHaveBeenCalledWith("user-1");
  });

  it("returns the existing idempotency response without exposing transaction state", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    ensurePersonalGalaxyScopeForFirstWrite.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    createFamilyPlanet.mockResolvedValue({
      kind: "processing",
      operationId: "operation-1",
      status: 202,
    });

    const response = await POST(request({ name: "妈妈", type: "parent" }, {
      "Idempotency-Key": "processing-planet-key1",
    }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      code: "IDEMPOTENCY_PROCESSING",
      message: "请求仍在处理中，请稍后重试。",
    });
  });

  it("maps safe domain failures without leaking internal details", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    ensurePersonalGalaxyScopeForFirstWrite.mockRejectedValue(new DomainError("GALAXY_NOT_FOUND", 404, "星系不存在或无权访问。"));

    const response = await POST(request({ name: "妈妈", type: "parent" }, {
      "Idempotency-Key": "scope-failure-planet01",
    }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      code: "GALAXY_NOT_FOUND",
      message: "星系不存在或无权访问。",
    });
  });
});
