import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/server/domain-error";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
const { resolvePersonalGalaxyScope } = vi.hoisted(() => ({ resolvePersonalGalaxyScope: vi.fn() }));
const { findActivePlanet } = vi.hoisted(() => ({ findActivePlanet: vi.fn() }));
const { archiveFamilyPlanet, updateFamilyPlanet } = vi.hoisted(() => ({
  archiveFamilyPlanet: vi.fn(),
  updateFamilyPlanet: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth }));
vi.mock("@/server/db/galaxy-repo", () => ({ resolvePersonalGalaxyScope }));
vi.mock("@/server/db/planet-repo", () => ({ findActivePlanet }));
vi.mock("@/server/services/planet.service", () => ({ archiveFamilyPlanet, updateFamilyPlanet }));

import { DELETE, PATCH } from "./route";

const planetId = "ck8m3x8xy000000000000000";
const context = { params: Promise.resolve({ planetId }) };

function request(method: string, body?: unknown, headers: HeadersInit = {}) {
  return new Request(`http://localhost/api/planets/${planetId}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function activePlanet() {
  return { id: planetId, userId: "user-1", galaxyId: "galaxy-1", deletedAt: null };
}

describe("PATCH /api/planets/[planetId]", () => {
  beforeEach(() => {
    auth.mockReset();
    resolvePersonalGalaxyScope.mockReset();
    findActivePlanet.mockReset();
    archiveFamilyPlanet.mockReset();
    updateFamilyPlanet.mockReset();
  });

  it("rejects unauthenticated updates before reading a scope or browser planet id", async () => {
    auth.mockResolvedValue(null);

    const response = await PATCH(request("PATCH", { version: 2, name: "妈妈" }), context);

    expect(response.status).toBe(401);
    expect(resolvePersonalGalaxyScope).not.toHaveBeenCalled();
    expect(findActivePlanet).not.toHaveBeenCalled();
  });

  it("checks the active planet in the resolved owner scope before updating", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    findActivePlanet.mockResolvedValue(null);

    const response = await PATCH(request("PATCH", { version: 2, name: "妈妈" }), context);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      code: "PLANET_NOT_FOUND",
      message: "星球不存在或无权访问。",
    });
    expect(findActivePlanet).toHaveBeenCalledWith({ userId: "user-1", galaxyId: "galaxy-1", planetId });
    expect(updateFamilyPlanet).not.toHaveBeenCalled();
  });

  it("accepts If-Match-Version as the update lock and passes only the scoped resource to the service", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    findActivePlanet.mockResolvedValue(activePlanet());
    updateFamilyPlanet.mockResolvedValue({ id: planetId, name: "新名字", version: 3 });

    const response = await PATCH(request("PATCH", { name: "新名字", lifeState: "memorial" }, {
      "If-Match-Version": "2",
    }), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: planetId, version: 3 });
    expect(updateFamilyPlanet).toHaveBeenCalledWith(
      { userId: "user-1", galaxyId: "galaxy-1" },
      planetId,
      { version: 2, name: "新名字", lifeState: "memorial" },
    );
  });

  it("returns the exact version conflict payload without overwriting another update", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    findActivePlanet.mockResolvedValue(activePlanet());
    updateFamilyPlanet.mockRejectedValue(new DomainError(
      "VERSION_CONFLICT",
      409,
      "这颗星球已在另一处更新，请刷新后重试。",
    ));

    const response = await PATCH(request("PATCH", { version: 2, name: "新名字" }), context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      code: "VERSION_CONFLICT",
      message: "这颗星球已在另一处更新，请刷新后重试。",
    });
  });
});

describe("DELETE /api/planets/[planetId]", () => {
  beforeEach(() => {
    auth.mockReset();
    resolvePersonalGalaxyScope.mockReset();
    findActivePlanet.mockReset();
    archiveFamilyPlanet.mockReset();
    updateFamilyPlanet.mockReset();
  });

  it("archives a scoped active planet using the optimistic version instead of deleting it", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    findActivePlanet.mockResolvedValue(activePlanet());
    archiveFamilyPlanet.mockResolvedValue({ id: planetId, version: 3, archived: true });

    const response = await DELETE(request("DELETE", {}, { "If-Match-Version": "2" }), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: planetId, version: 3, archived: true });
    expect(archiveFamilyPlanet).toHaveBeenCalledWith({ userId: "user-1", galaxyId: "galaxy-1" }, planetId, 2);
  });

  it("rejects a missing version before an archive mutation is attempted", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    findActivePlanet.mockResolvedValue(activePlanet());

    const response = await DELETE(request("DELETE", {}), context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "PLANET_INPUT_INVALID",
      message: "星球请求格式不正确。",
    });
    expect(archiveFamilyPlanet).not.toHaveBeenCalled();
  });
});
