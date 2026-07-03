import { describe, expect, it, vi } from "vitest";

import { ensurePersonalGalaxy } from "./galaxy.service";

describe("ensurePersonalGalaxy", () => {
  it("returns the existing galaxy when one already exists", async () => {
    const repo = {
      findPersonalGalaxy: vi.fn().mockResolvedValue({ id: "galaxy_1", planets: [] }),
      createGalaxyWithSelfPlanet: vi.fn(),
      isCreateConflict: vi.fn(),
    };

    const result = await ensurePersonalGalaxy("user_1", repo);

    expect(result.id).toBe("galaxy_1");
    expect(repo.createGalaxyWithSelfPlanet).not.toHaveBeenCalled();
  });

  it("creates a galaxy and a self planet for first-time users", async () => {
    const repo = {
      findPersonalGalaxy: vi.fn().mockResolvedValue(null),
      createGalaxyWithSelfPlanet: vi.fn().mockResolvedValue({ id: "galaxy_new", planets: [{ id: "planet_self" }] }),
      isCreateConflict: vi.fn(),
    };

    const result = await ensurePersonalGalaxy("user_1", repo);

    expect(repo.createGalaxyWithSelfPlanet).toHaveBeenCalledWith({
      userId: "user_1",
      galaxyName: "我的星系",
      selfPlanetName: "我的星球",
    });
    expect(result.id).toBe("galaxy_new");
  });

  it("returns the galaxy created by a concurrent request when create loses the race only for conflicts", async () => {
    const raceWinnerGalaxy = { id: "galaxy_race", planets: [{ id: "planet_self" }] };
    const createError = new Error("unique constraint");
    const repo = {
      findPersonalGalaxy: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(raceWinnerGalaxy),
      createGalaxyWithSelfPlanet: vi.fn().mockRejectedValue(createError),
      isCreateConflict: vi.fn().mockReturnValue(true),
    };

    const result = await ensurePersonalGalaxy("user_1", repo);

    expect(repo.isCreateConflict).toHaveBeenCalledWith(createError);
    expect(repo.findPersonalGalaxy).toHaveBeenNthCalledWith(1, "user_1");
    expect(repo.findPersonalGalaxy).toHaveBeenNthCalledWith(2, "user_1");
    expect(result).toEqual(raceWinnerGalaxy);
  });

  it("rethrows non-conflict create failures", async () => {
    const createError = new Error("database offline");
    const repo = {
      findPersonalGalaxy: vi.fn().mockResolvedValue(null),
      createGalaxyWithSelfPlanet: vi.fn().mockRejectedValue(createError),
      isCreateConflict: vi.fn().mockReturnValue(false),
    };

    await expect(ensurePersonalGalaxy("user_1", repo)).rejects.toBe(createError);
    expect(repo.isCreateConflict).toHaveBeenCalledWith(createError);
    expect(repo.findPersonalGalaxy).toHaveBeenCalledTimes(1);
  });

  it("rethrows the original conflict when reread still finds no galaxy", async () => {
    const createError = new Error("unique constraint");
    const repo = {
      findPersonalGalaxy: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null),
      createGalaxyWithSelfPlanet: vi.fn().mockRejectedValue(createError),
      isCreateConflict: vi.fn().mockReturnValue(true),
    };

    await expect(ensurePersonalGalaxy("user_1", repo)).rejects.toBe(createError);
    expect(repo.isCreateConflict).toHaveBeenCalledWith(createError);
    expect(repo.findPersonalGalaxy).toHaveBeenCalledTimes(2);
  });
});
