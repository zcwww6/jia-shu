export interface GalaxyBootstrapRecord {
  id: string;
  planets: Array<{
    id: string;
  }>;
}

export interface GalaxyBootstrapRepo {
  findPersonalGalaxy(userId: string): Promise<GalaxyBootstrapRecord | null>;
  createGalaxyWithSelfPlanet(input: {
    userId: string;
    galaxyName: string;
    selfPlanetName: string;
  }): Promise<GalaxyBootstrapRecord>;
}

const PERSONAL_GALAXY_NAME = "我的星系";
const SELF_PLANET_NAME = "我的星球";

export async function ensurePersonalGalaxy(userId: string, repo: GalaxyBootstrapRepo) {
  const existingGalaxy = await repo.findPersonalGalaxy(userId);

  if (existingGalaxy) {
    return existingGalaxy;
  }

  return repo.createGalaxyWithSelfPlanet({
    userId,
    galaxyName: PERSONAL_GALAXY_NAME,
    selfPlanetName: SELF_PLANET_NAME,
  });
}
