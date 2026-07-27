import { describe, expect, it, vi } from "vitest";

import {
  archiveLegacyPlanet,
  createLegacyPlanet,
  createLegacyRelationship,
  restoreLegacyPlanet,
  updateLegacyPlanet,
} from "./legacy-galaxy-api";

describe("legacy galaxy API bridge", () => {
  it("creates a family planet through the authenticated persistence endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "planet-1", version: 1 }), { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await createLegacyPlanet({
      name: "妈妈",
      type: "parent",
      lifeState: "active",
      visibility: "private",
      role: "母亲",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/planets",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "Idempotency-Key": expect.any(String),
        }),
        body: JSON.stringify({
          name: "妈妈",
          type: "parent",
          lifeState: "active",
          visibility: "private",
          role: "母亲",
        }),
      }),
    );
  });

  it("saves a manual family connection through the scoped relationship endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "relationship-1" }), { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await createLegacyRelationship({
      sourcePlanetId: "planet-a",
      targetPlanetId: "planet-b",
      relationshipType: "other",
      label: "手动配置星轨",
      visibility: "family",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/planets/planet-a/relationships",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Idempotency-Key": expect.any(String) }),
        body: JSON.stringify({
          targetPlanetId: "planet-b",
          relationshipType: "other",
          label: "手动配置星轨",
          visibility: "family",
        }),
      }),
    );
  });

  it("uses version-bound endpoints to edit, archive, and restore a family planet", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "planet-1", version: 3 }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await updateLegacyPlanet({
      id: "planet-1",
      version: 2,
      name: "母亲星",
      visibility: "family",
      theme: "暖夜星环",
    });
    await archiveLegacyPlanet("planet-1", 3);
    await restoreLegacyPlanet("planet-1", 4);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/planets/planet-1",
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({ "If-Match-Version": "2" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/planets/planet-1",
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({ "If-Match-Version": "3" }),
        body: JSON.stringify({ version: 3 }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/planets/planet-1/restore",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "If-Match-Version": "4" }),
        body: JSON.stringify({ version: 4 }),
      }),
    );
  });
});
