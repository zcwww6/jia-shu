import { beforeEach, describe, expect, it, vi } from "vitest";

const { getPrismaClient } = vi.hoisted(() => ({
  getPrismaClient: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  getPrismaClient,
}));

import {
  createPlanetRelationship,
  createPlanet,
  findActivePlanet,
  findActiveRelationship,
  findScopedPlanet,
  lockActivePlanetForMemory,
  lockActivePlanetsForRelationship,
  restorePlanet,
  softDeletePlanet,
  updateActivePlanet,
} from "./planet-repo";

describe("planet repo", () => {
  beforeEach(() => {
    getPrismaClient.mockReset();
  });

  it("reads an active planet only inside the caller's galaxy scope", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "planet-1" });
    getPrismaClient.mockReturnValue({ planet: { findFirst } });

    await findActivePlanet({ userId: "user-1", galaxyId: "galaxy-1", planetId: "planet-1" });

    expect(findFirst).toHaveBeenCalledWith({
      where: { id: "planet-1", userId: "user-1", galaxyId: "galaxy-1", deletedAt: null },
    });
  });

  it("reads an archived planet inside the caller's galaxy scope for recovery", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "planet-1", deletedAt: new Date() });
    getPrismaClient.mockReturnValue({ planet: { findFirst } });

    await findScopedPlanet({ userId: "user-1", galaxyId: "galaxy-1", planetId: "planet-1" });

    expect(findFirst).toHaveBeenCalledWith({
      where: { id: "planet-1", userId: "user-1", galaxyId: "galaxy-1" },
    });
  });

  it("soft deletes with a scoped version guard and a thirty-day purge horizon", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const remove = vi.fn();
    getPrismaClient.mockReturnValue({ planet: { updateMany, delete: remove } });
    const now = new Date("2026-07-16T00:00:00.000Z");

    await softDeletePlanet({ userId: "user-1", galaxyId: "galaxy-1", planetId: "planet-1", version: 3, now });

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "planet-1", userId: "user-1", galaxyId: "galaxy-1", deletedAt: null, version: 3 },
      data: {
        archivedAt: now,
        deletedAt: now,
        purgeAfter: new Date("2026-08-15T00:00:00.000Z"),
        version: { increment: 1 },
      },
    });
    expect(remove).not.toHaveBeenCalled();
  });

  it("restores an archived planet with a scoped version guard", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    getPrismaClient.mockReturnValue({ planet: { updateMany } });

    await restorePlanet({ userId: "user-1", galaxyId: "galaxy-1", planetId: "planet-1", version: 4 });

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "planet-1",
        userId: "user-1",
        galaxyId: "galaxy-1",
        deletedAt: { not: null },
        version: 4,
      },
      data: {
        archivedAt: null,
        deletedAt: null,
        purgeAfter: null,
        version: { increment: 1 },
      },
    });
  });

  it("updates lifecycle state without persisting memorial as a planet type", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findFirst = vi.fn().mockResolvedValue({ id: "planet-1", type: "parent", lifeState: "memorial" });
    getPrismaClient.mockReturnValue({ planet: { updateMany, findFirst } });

    await updateActivePlanet({
      userId: "user-1",
      galaxyId: "galaxy-1",
      planetId: "planet-1",
      version: 2,
      data: { type: "parent", lifeState: "memorial" },
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "planet-1", userId: "user-1", galaxyId: "galaxy-1", deletedAt: null, version: 2 },
      data: { type: "parent", lifeState: "memorial", version: { increment: 1 } },
    });
  });

  it("refuses a legacy memorial type in every persistent create or update path", async () => {
    const create = vi.fn();
    const updateMany = vi.fn();
    getPrismaClient.mockReturnValue({ planet: { create, updateMany } });

    await expect(createPlanet({
      userId: "user-1",
      galaxyId: "galaxy-1",
      name: "纪念星",
      type: "memorial" as never,
      visibility: "private",
    })).rejects.toMatchObject({ code: "PLANET_TYPE_INVALID", status: 400 });
    await expect(updateActivePlanet({
      userId: "user-1",
      galaxyId: "galaxy-1",
      planetId: "planet-1",
      version: 2,
      data: { type: "memorial" as never },
    })).rejects.toMatchObject({ code: "PLANET_TYPE_INVALID", status: 400 });

    expect(create).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("creates a scoped relationship record instead of a browser-only connection rule", async () => {
    const create = vi.fn().mockResolvedValue({ id: "relationship-1" });
    getPrismaClient.mockReturnValue({ planetRelationship: { create } });

    await createPlanetRelationship({
      userId: "user-1",
      galaxyId: "galaxy-1",
      sourcePlanetId: "planet-source",
      targetPlanetId: "planet-target",
      relationshipType: "parent",
      label: "母女",
      visibility: "family",
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        galaxyId: "galaxy-1",
        sourcePlanetId: "planet-source",
        targetPlanetId: "planet-target",
        relationshipType: "parent",
        label: "母女",
        visibility: "family",
      },
    });
  });

  it("looks up an existing relationship only inside the scoped active graph", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "relationship-1" });
    getPrismaClient.mockReturnValue({ planetRelationship: { findFirst } });

    await findActiveRelationship({
      userId: "user-1",
      galaxyId: "galaxy-1",
      sourcePlanetId: "planet-source",
      targetPlanetId: "planet-target",
      relationshipType: "parent",
    });

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        galaxyId: "galaxy-1",
        sourcePlanetId: "planet-source",
        targetPlanetId: "planet-target",
        relationshipType: "parent",
        deletedAt: null,
      },
    });
  });

  it("locks the scoped active relationship pair in stable id order through a parameterized query", async () => {
    const $queryRaw = vi.fn().mockResolvedValue([{ id: "planet-a" }, { id: "planet-z" }]);
    getPrismaClient.mockReturnValue({ $queryRaw });

    await expect(lockActivePlanetsForRelationship({
      userId: "user-1",
      galaxyId: "galaxy-1",
      sourcePlanetId: "planet-z",
      targetPlanetId: "planet-a",
    })).resolves.toEqual([{ id: "planet-a" }, { id: "planet-z" }]);

    const query = $queryRaw.mock.calls[0]?.[0] as { strings: string[]; values: unknown[] };
    expect(query.strings.join("?")).toContain('ORDER BY "id" ASC');
    expect(query.strings.join("?")).toContain("FOR UPDATE");
    expect(query.strings.join("?")).toContain('"deletedAt" IS NULL');
    expect(query.values).toEqual(["user-1", "galaxy-1", "planet-a", "planet-z"]);
  });

  it("locks one scoped active planet for memory creation through a parameterized query", async () => {
    const $queryRaw = vi.fn().mockResolvedValue([{ id: "planet-1" }]);
    getPrismaClient.mockReturnValue({ $queryRaw });

    await expect(lockActivePlanetForMemory({
      userId: "user-1",
      galaxyId: "galaxy-1",
      planetId: "planet-1",
    })).resolves.toEqual([{ id: "planet-1" }]);

    const query = $queryRaw.mock.calls[0]?.[0] as { strings: string[]; values: unknown[] };
    const sql = query.strings.join("?");
    expect(sql).toContain('FROM "Planet"');
    expect(sql).toContain('"id" = ?');
    expect(sql).toContain('"archivedAt" IS NULL');
    expect(sql).toContain('"deletedAt" IS NULL');
    expect(sql).toContain("FOR UPDATE");
    expect(query.values).toEqual(["user-1", "galaxy-1", "planet-1"]);
  });
});
