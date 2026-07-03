import { prisma } from "@/server/db/client";

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
