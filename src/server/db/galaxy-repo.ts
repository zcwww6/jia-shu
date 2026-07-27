import { Prisma } from "@prisma/client";

import { getPrismaClient } from "@/server/db/client";
import { DomainError } from "@/server/domain-error";

export type PersonalGalaxyScope = {
  userId: string;
  galaxyId: string;
};

const personalGalaxyScopeSelect = { id: true, userId: true } as const;

const galaxyBootstrapInclude = {
  planets: {
    select: {
      id: true,
      name: true,
      type: true,
      visibility: true,
    },
  },
} as const;

export async function findPersonalGalaxy(userId: string) {
  const prisma = getPrismaClient();

  return prisma.galaxy.findUnique({
    where: { userId },
    include: galaxyBootstrapInclude,
  });
}

export async function resolvePersonalGalaxyScope(userId: string): Promise<PersonalGalaxyScope> {
  const galaxy = await findPersonalGalaxyScopeRecord(userId);

  if (!galaxy || galaxy.userId !== userId) {
    throw new DomainError("GALAXY_NOT_FOUND", 404, "星系不存在或无权访问。");
  }

  return { userId, galaxyId: galaxy.id };
}

/**
 * The collection write path calls this only after authenticating and validating
 * the request. Read paths must keep using resolvePersonalGalaxyScope so they
 * never create state as a side effect.
 */
export async function ensurePersonalGalaxyScopeForFirstWrite(userId: string): Promise<PersonalGalaxyScope> {
  const prisma = getPrismaClient();
  const existing = await findPersonalGalaxyScopeRecord(userId, prisma);

  if (existing) {
    return { userId, galaxyId: existing.id };
  }

  try {
    const created = await prisma.galaxy.create({
      data: { userId, name: "我的星系" },
      select: personalGalaxyScopeSelect,
    });

    return { userId, galaxyId: created.id };
  } catch (error) {
    if (!isCreateConflict(error)) {
      throw error;
    }

    const winner = await findPersonalGalaxyScopeRecord(userId, prisma);

    if (!winner) {
      throw error;
    }

    return { userId, galaxyId: winner.id };
  }
}

/**
 * Home is a read-only projection. It intentionally excludes archived planets
 * and all draft/deleted domain records so the caller never fills the galaxy
 * with demo state.
 */
export async function findHomePlanets(userId: string) {
  const prisma = getPrismaClient();

  return prisma.planet.findMany({
    where: {
      userId,
      galaxy: { userId },
      archivedAt: null,
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      type: true,
      lifeState: true,
      visibility: true,
      role: true,
      theme: true,
      summary: true,
      version: true,
      coverAssetId: true,
      positionX: true,
      positionY: true,
      relationshipsFrom: {
        where: {
          deletedAt: null,
          targetPlanet: { archivedAt: null, deletedAt: null },
        },
        select: {
          id: true,
          sourcePlanetId: true,
          targetPlanetId: true,
          relationshipType: true,
          label: true,
          visibility: true,
        },
      },
      relationshipsTo: {
        where: {
          deletedAt: null,
          sourcePlanet: { archivedAt: null, deletedAt: null },
        },
        select: {
          id: true,
          sourcePlanetId: true,
          targetPlanetId: true,
          relationshipType: true,
          label: true,
          visibility: true,
        },
      },
      memories: {
        where: { status: "confirmed", deletedAt: null },
        select: {
          id: true,
          title: true,
          allowBook: true,
          resonanceSources: {
            where: {
              status: { in: ["confirmed", "candidate"] },
              deletedAt: null,
              targetMemory: {
                deletedAt: null,
                status: "confirmed",
                planet: { archivedAt: null, deletedAt: null },
              },
            },
            select: {
              id: true,
              status: true,
              sourceMemoryId: true,
              targetMemoryId: true,
              sourceMemory: { select: { planetId: true } },
              targetMemory: { select: { planetId: true } },
              score: true,
              reason: true,
              version: true,
            },
          },
          resonanceTargets: {
            where: {
              status: { in: ["confirmed", "candidate"] },
              deletedAt: null,
              sourceMemory: {
                deletedAt: null,
                status: "confirmed",
                planet: { archivedAt: null, deletedAt: null },
              },
            },
            select: {
              id: true,
              status: true,
              sourceMemoryId: true,
              targetMemoryId: true,
              sourceMemory: { select: { planetId: true } },
              targetMemory: { select: { planetId: true } },
              score: true,
              reason: true,
              version: true,
            },
          },
          bookMemories: {
            where: {
              deletedAt: null,
              book: {
                archivedAt: null,
                deletedAt: null,
                status: { in: ["draft", "ready"] },
              },
            },
            select: {
              id: true,
              book: {
                select: {
                  id: true,
                  title: true,
                  status: true,
                },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Archived planets deliberately stay outside the explorable galaxy read model,
 * but the family administrator must be able to recover them after a refresh.
 * This compact projection is only used by the editor's restore shelf.
 */
export async function findArchivedHomePlanets(userId: string) {
  const prisma = getPrismaClient();

  return prisma.planet.findMany({
    where: {
      userId,
      galaxy: { userId },
      deletedAt: { not: null },
    },
    select: {
      id: true,
      name: true,
      type: true,
      lifeState: true,
      visibility: true,
      role: true,
      theme: true,
      summary: true,
      version: true,
      coverAssetId: true,
      positionX: true,
      positionY: true,
    },
    orderBy: { archivedAt: "desc" },
  });
}

/**
 * Reads one story inside the current administrator's personal galaxy. The
 * projection intentionally includes editable drafts and AI-curated memories
 * awaiting confirmation alongside confirmed memories, but excludes processing,
 * archived, and deleted records.
 */
export async function findPlanetStory(userId: string, planetId: string) {
  const prisma = getPrismaClient();

  return prisma.planet.findFirst({
    where: {
      id: planetId,
      userId,
      galaxy: { userId },
      archivedAt: null,
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      type: true,
      lifeState: true,
      visibility: true,
      role: true,
      theme: true,
      summary: true,
      positionX: true,
      positionY: true,
      memories: {
        where: { status: { in: ["draft", "needs_confirmation", "confirmed"] }, deletedAt: null },
        select: {
          id: true,
          title: true,
          summary: true,
          sourceText: true,
          occurredAtLabel: true,
          status: true,
          createdAt: true,
          resonanceSources: {
            where: {
              status: "confirmed",
              deletedAt: null,
              targetMemory: {
                deletedAt: null,
                status: "confirmed",
                planet: { archivedAt: null, deletedAt: null },
              },
            },
            select: {
              id: true,
              status: true,
              sourceMemoryId: true,
              targetMemoryId: true,
              sourceMemory: { select: { planetId: true } },
              targetMemory: { select: { planetId: true } },
              score: true,
              reason: true,
            },
          },
          resonanceTargets: {
            where: {
              status: "confirmed",
              deletedAt: null,
              sourceMemory: {
                deletedAt: null,
                status: "confirmed",
                planet: { archivedAt: null, deletedAt: null },
              },
            },
            select: {
              id: true,
              status: true,
              sourceMemoryId: true,
              targetMemoryId: true,
              sourceMemory: { select: { planetId: true } },
              targetMemory: { select: { planetId: true } },
              score: true,
              reason: true,
            },
          },
          bookMemories: {
            where: {
              deletedAt: null,
              book: {
                archivedAt: null,
                deletedAt: null,
                status: { in: ["draft", "ready"] },
              },
            },
            select: { id: true },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

export async function createGalaxyWithSelfPlanet({
  userId,
  galaxyName,
  selfPlanetName,
}: {
  userId: string;
  galaxyName: string;
  selfPlanetName: string;
}) {
  const prisma = getPrismaClient();

  return prisma.galaxy.create({
    data: {
      userId,
      name: galaxyName,
      planets: {
        create: {
          user: { connect: { id: userId } },
          name: selfPlanetName,
          type: "self",
          visibility: "private",
        },
      },
    },
    include: galaxyBootstrapInclude,
  });
}

export function isCreateConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function findPersonalGalaxyScopeRecord(userId: string, prisma = getPrismaClient()) {
  return prisma.galaxy.findUnique({
    where: { userId },
    select: personalGalaxyScopeSelect,
  });
}
