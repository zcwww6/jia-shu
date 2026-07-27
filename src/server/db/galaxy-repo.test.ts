import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const { getPrismaClient } = vi.hoisted(() => ({
  getPrismaClient: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  getPrismaClient,
}));

import {
  createGalaxyWithSelfPlanet,
  ensurePersonalGalaxyScopeForFirstWrite,
  findHomePlanets,
  findPlanetStory,
  resolvePersonalGalaxyScope,
} from "./galaxy-repo";

describe("galaxy repo", () => {
  beforeEach(() => {
    getPrismaClient.mockReset();
  });

  it("connects the nested self planet to the galaxy owner through the user relation", async () => {
    const create = vi.fn().mockResolvedValue({ id: "galaxy-1", planets: [] });
    getPrismaClient.mockReturnValue({
      galaxy: {
        create,
      },
    });

    await createGalaxyWithSelfPlanet({
      userId: "user-1",
      galaxyName: "我的星系",
      selfPlanetName: "我的星球",
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        name: "我的星系",
        planets: {
          create: {
            user: { connect: { id: "user-1" } },
            name: "我的星球",
            type: "self",
            visibility: "private",
          },
        },
      },
      include: {
        planets: {
          select: {
            id: true,
            name: true,
            type: true,
            visibility: true,
          },
        },
      },
    });
  });

  it("resolves the administrator's personal galaxy as a reusable user and galaxy scope", async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: "galaxy-1", userId: "user-1" });
    getPrismaClient.mockReturnValue({
      galaxy: {
        findUnique,
      },
    });

    await expect(resolvePersonalGalaxyScope("user-1")).resolves.toEqual({
      userId: "user-1",
      galaxyId: "galaxy-1",
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      select: { id: true, userId: true },
    });
  });

  it("does not create a scope when the personal galaxy is absent", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    getPrismaClient.mockReturnValue({
      galaxy: {
        findUnique,
      },
    });

    await expect(resolvePersonalGalaxyScope("user-1")).rejects.toMatchObject({
      code: "GALAXY_NOT_FOUND",
      status: 404,
    });
  });

  it("creates an empty personal galaxy only for an explicit first write", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const create = vi.fn().mockResolvedValue({ id: "galaxy-new", userId: "user-1" });
    getPrismaClient.mockReturnValue({ galaxy: { findUnique, create } });

    await expect(ensurePersonalGalaxyScopeForFirstWrite("user-1")).resolves.toEqual({
      userId: "user-1",
      galaxyId: "galaxy-new",
    });

    expect(findUnique).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      select: { id: true, userId: true },
    });
    expect(create).toHaveBeenCalledWith({
      data: { userId: "user-1", name: "我的星系" },
      select: { id: true, userId: true },
    });
  });

  it("rereads the unique-constraint winner so concurrent first writes share one galaxy", async () => {
    const uniqueConflict = new Prisma.PrismaClientKnownRequestError("duplicate", {
      code: "P2002",
      clientVersion: "test",
    });
    const findUnique = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "galaxy-winner", userId: "user-1" });
    const create = vi.fn().mockRejectedValue(uniqueConflict);
    getPrismaClient.mockReturnValue({ galaxy: { findUnique, create } });

    await expect(ensurePersonalGalaxyScopeForFirstWrite("user-1")).resolves.toEqual({
      userId: "user-1",
      galaxyId: "galaxy-winner",
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it("reads only active planets and their confirmed, active home aggregates", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    getPrismaClient.mockReturnValue({
      planet: { findMany },
    });

    await findHomePlanets("user-1");

    expect(findMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        galaxy: { userId: "user-1" },
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
  });

  it("reads one owned active planet with draft, AI-review, and confirmed story memories", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    getPrismaClient.mockReturnValue({
      planet: { findFirst },
    });

    await findPlanetStory("user-1", "planet-1");

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: "planet-1",
        userId: "user-1",
        galaxy: { userId: "user-1" },
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
  });
});
