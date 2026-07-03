import { describe, expect, it, vi } from "vitest";

import { ensurePersonalGalaxy } from "./galaxy.service";

describe("ensurePersonalGalaxy", () => {
  it("returns the existing galaxy when one already exists", async () => {
    const repo = {
      findPersonalGalaxy: vi.fn().mockResolvedValue({ id: "galaxy_1", planets: [] }),
      createGalaxyWithSelfPlanet: vi.fn(),
    };

    const result = await ensurePersonalGalaxy("user_1", repo);

    expect(result.id).toBe("galaxy_1");
    expect(repo.createGalaxyWithSelfPlanet).not.toHaveBeenCalled();
  });

  it("creates a galaxy and a self planet for first-time users", async () => {
    const repo = {
      findPersonalGalaxy: vi.fn().mockResolvedValue(null),
      createGalaxyWithSelfPlanet: vi.fn().mockResolvedValue({ id: "galaxy_new", planets: [{ id: "planet_self" }] }),
    };

    const result = await ensurePersonalGalaxy("user_1", repo);

    expect(repo.createGalaxyWithSelfPlanet).toHaveBeenCalledWith({
      userId: "user_1",
      galaxyName: "我的星系",
      selfPlanetName: "我的星球",
    });
    expect(result.id).toBe("galaxy_new");
  });
});
