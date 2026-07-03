import { Prisma } from "@prisma/client";

import { getPrismaClient } from "@/server/db/client";

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
          userId,
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
