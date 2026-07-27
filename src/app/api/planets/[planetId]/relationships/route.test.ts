import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/server/domain-error";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
const { resolvePersonalGalaxyScope } = vi.hoisted(() => ({ resolvePersonalGalaxyScope: vi.fn() }));
const { findActivePlanet } = vi.hoisted(() => ({ findActivePlanet: vi.fn() }));
const { createFamilyRelationship } = vi.hoisted(() => ({ createFamilyRelationship: vi.fn() }));

vi.mock("@/auth", () => ({ auth }));
vi.mock("@/server/db/galaxy-repo", () => ({ resolvePersonalGalaxyScope }));
vi.mock("@/server/db/planet-repo", () => ({ findActivePlanet }));
vi.mock("@/server/services/planet.service", () => ({ createFamilyRelationship }));

import { POST } from "./route";

const sourcePlanetId = "ck8m3x8xy000000000000000";
const targetPlanetId = "ck8m3x8xy000000000000001";
const context = { params: Promise.resolve({ planetId: sourcePlanetId }) };

function request(body: unknown, headers: HeadersInit = {}) {
  return new Request(`http://localhost/api/planets/${sourcePlanetId}/relationships`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/planets/[planetId]/relationships", () => {
  beforeEach(() => {
    auth.mockReset();
    resolvePersonalGalaxyScope.mockReset();
    findActivePlanet.mockReset();
    createFamilyRelationship.mockReset();
  });

  it("rejects unauthenticated relationship creation before resolving scope", async () => {
    auth.mockResolvedValue(null);

    const response = await POST(request({ targetPlanetId, relationshipType: "parent" }), context);

    expect(response.status).toBe(401);
    expect(resolvePersonalGalaxyScope).not.toHaveBeenCalled();
  });

  it("lets the idempotent transaction perform the scoped active-pair check so a replay is not preempted", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    createFamilyRelationship.mockRejectedValue(new DomainError("PLANET_NOT_FOUND", 404, "星球不存在或无权访问。"));

    const response = await POST(request({ targetPlanetId, relationshipType: "parent" }, {
      "Idempotency-Key": "cross-galaxy-link-key01",
    }), context);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      code: "PLANET_NOT_FOUND",
      message: "星球不存在或无权访问。",
    });
    expect(findActivePlanet).not.toHaveBeenCalled();
    expect(createFamilyRelationship).toHaveBeenCalledWith(
      { userId: "user-1", galaxyId: "galaxy-1" },
      sourcePlanetId,
      expect.objectContaining({ targetPlanetId, relationshipType: "parent" }),
    );
  });

  it("requires a valid idempotency key and creates a real relationship only after scoped checks", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    createFamilyRelationship.mockResolvedValue({
      kind: "completed",
      operationId: "relationship-op-1",
      status: 201,
      response: { id: "relationship-1", sourcePlanetId, targetPlanetId, relationshipType: "parent" },
    });

    const response = await POST(request({
      targetPlanetId,
      relationshipType: "parent",
      visibility: "family",
      label: "母女",
    }, { "Idempotency-Key": "real-relationship-key01" }), context);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ id: "relationship-1", relationshipType: "parent" });
    expect(createFamilyRelationship).toHaveBeenCalledWith(
      { userId: "user-1", galaxyId: "galaxy-1" },
      sourcePlanetId,
      {
        targetPlanetId,
        relationshipType: "parent",
        visibility: "family",
        label: "母女",
        idempotencyKey: "real-relationship-key01",
      },
    );
    expect(findActivePlanet).not.toHaveBeenCalled();
  });

  it("maps self and duplicate relationship errors without exposing database constraints", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolvePersonalGalaxyScope.mockResolvedValue({ userId: "user-1", galaxyId: "galaxy-1" });
    createFamilyRelationship.mockRejectedValue(new DomainError("RELATIONSHIP_EXISTS", 409, "该星球关系已存在。"));

    const duplicate = await POST(request({ targetPlanetId, relationshipType: "parent" }, {
      "Idempotency-Key": "duplicate-relationship1",
    }), context);
    expect(duplicate.status).toBe(409);
    await expect(duplicate.json()).resolves.toEqual({
      code: "RELATIONSHIP_EXISTS",
      message: "该星球关系已存在。",
    });

    const self = await POST(request({ targetPlanetId: sourcePlanetId, relationshipType: "self" }, {
      "Idempotency-Key": "self-relationship-key1",
    }), context);
    expect(self.status).toBe(400);
    await expect(self.json()).resolves.toEqual({
      code: "RELATIONSHIP_SELF_LINK",
      message: "不能将星球与自身建立关系。",
    });
  });
});
