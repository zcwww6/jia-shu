import { planets as mockPlanets } from "@/shared/mock/galaxy-data";
import type { Planet, PlanetType, Visibility } from "@/shared/types/galaxy";
import { getPrismaClient } from "@/server/db/client";
import {
  createGalaxyWithSelfPlanet,
  findPersonalGalaxy,
  isCreateConflict,
} from "@/server/db/galaxy-repo";

import { ensurePersonalGalaxy as ensureUserPersonalGalaxy } from "./galaxy.service";

type HomePlanetRecord = {
  id: string;
  name: string;
  type: PlanetType;
  visibility: Visibility;
  role: string | null;
  theme: string | null;
  summary: string | null;
  positionX: number | null;
  positionY: number | null;
};

interface HomeServiceDeps {
  ensurePersonalGalaxy: (userId: string) => Promise<unknown>;
  findHomePlanets: (userId: string) => Promise<HomePlanetRecord[]>;
}

const defaultPlanetByType = new Map<PlanetType, Planet>(
  mockPlanets.map((planet) => [planet.type, planet]),
);

const defaultDeps: HomeServiceDeps = {
  ensurePersonalGalaxy(userId) {
    return ensureUserPersonalGalaxy(userId, {
      findPersonalGalaxy,
      createGalaxyWithSelfPlanet,
      isCreateConflict,
    });
  },
  async findHomePlanets(userId) {
    const prisma = getPrismaClient();
    return prisma.planet.findMany({
      where: {
        galaxy: {
          userId,
        },
      },
      select: {
        id: true,
        name: true,
        type: true,
        visibility: true,
        role: true,
        theme: true,
        summary: true,
        positionX: true,
        positionY: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    });
  },
};

export async function getHomeData(
  userId: string | null | undefined,
  deps: HomeServiceDeps = defaultDeps,
) {
  if (!userId) {
    throw new Error("UNAUTHENTICATED");
  }

  await deps.ensurePersonalGalaxy(userId);

  const homePlanets = await deps.findHomePlanets(userId);

  return {
    planets: homePlanets.map((planet, index) => mapHomePlanet(planet, index)),
  };
}

function mapHomePlanet(planet: HomePlanetRecord, index: number): Planet {
  const defaults = defaultPlanetByType.get(planet.type) ?? defaultPlanetByType.get("self");

  return {
    id: planet.id,
    name: planet.name,
    type: planet.type,
    visibility: planet.visibility,
    role: planet.role ?? defaults?.role ?? "私密核心",
    theme: planet.theme ?? defaults?.theme ?? "极光家书",
    summary: planet.summary ?? defaults?.summary ?? "你自己的记忆核心，分享和共鸣前都需要再次确认。",
    position: {
      x: planet.positionX ?? defaults?.position.x ?? 48 + index * 6,
      y: planet.positionY ?? defaults?.position.y ?? 52 + index * 6,
    },
    stats: {
      memoryStars: 0,
      resonanceTracks: 0,
      bookDrafts: 0,
    },
  };
}
