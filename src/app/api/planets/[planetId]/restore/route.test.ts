import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
const { resolvePersonalGalaxyScope } = vi.hoisted(() => ({ resolvePersonalGalaxyScope: vi.fn() }));
const { findScopedPlanet } = vi.hoisted(() => ({ findScopedPlanet: vi.fn() }));
const { restoreFamilyPlanet } = vi.hoisted(() => ({ restoreFamilyPlanet: vi.fn() }));

vi.mock("@/auth", () => ({ auth }));
vi.mock("@/server/db/galaxy-repo", () => ({ resolvePersonalGalaxyScope }));
vi.mock("@/server/db/planet-repo", () => ({ findScopedPlanet }));
vi.mock("@/server/services/planet.service", () => ({ restoreFamilyPlanet }));

import { POST } from "./route";

const planetId = "ck8m3x8xy000000000000000";
const context = { params: Promise.resolve({ planetId }) };

function request(body: unknown = {}, headers: HeadersInit = {}) {
  return new Request(`http://localhost/api/planets/${planetId}/restore`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/planets/[planetId]/restore", () => {
  beforeEach(() => {
    auth.mockReset();
    resolvePersonalGalaxyScope.mockReset();
    findScopedPlanet.mockReset();
    restoreFamilyPlanet.mockReset();
  });

  it("requires authentication before resolving a restorable planet", async () => {
    auth.mockResolvedValue(null);

    const response = await POST(request({ version: 3 }), context);

    expect(response.status).toBe(401);
    expect(resolvePersonalGalaxyScope).not.toHaveBeenCalled();
  });

  it("restores only an archived planet found in the administrator scope with a version lock", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    findScopedPlanet.mockResolvedValue({ id: planetId, deletedAt: new Date(), archivedAt: new Date() });
    restoreFamilyPlanet.mockResolvedValue({ id: planetId, version: 4, archived: false });

    const response = await POST(request({}, { "If-Match-Version": "3" }), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: planetId, version: 4, archived: false });
    expect(findScopedPlanet).toHaveBeenCalledWith({ userId: "user-1", galaxyId: "galaxy-1", planetId });
    expect(restoreFamilyPlanet).toHaveBeenCalledWith({ userId: "user-1", galaxyId: "galaxy-1" }, planetId, 3);
  });

  it("does not reveal or restore a foreign or already-active planet", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    findScopedPlanet.mockResolvedValue(null);

    const response = await POST(request({ version: 3 }), context);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      code: "PLANET_NOT_FOUND",
      message: "星球不存在或无权访问。",
    });
    expect(restoreFamilyPlanet).not.toHaveBeenCalled();
  });
});
