import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { createFamilyRelationship } from "@/server/services/planet.service";

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  expect(databaseUrl, "DATABASE_URL is required");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID().replaceAll("-", "");

  try {
    const user = await prisma.user.create({ data: { email: `relationship-race-${suffix}@example.test` } });
    const galaxy = await prisma.galaxy.create({ data: { userId: user.id, name: "Relationship race verification" } });
    const [source, target] = await Promise.all([
      prisma.planet.create({ data: { userId: user.id, galaxyId: galaxy.id, name: "Source", type: "other" } }),
      prisma.planet.create({ data: { userId: user.id, galaxyId: galaxy.id, name: "Target", type: "other" } }),
    ]);
    const scope = { userId: user.id, galaxyId: galaxy.id };
    const create = (idempotencyKey: string) => createFamilyRelationship(scope, source.id, {
      targetPlanetId: target.id,
      relationshipType: "parent",
      visibility: "private",
      idempotencyKey,
    });

    const outcomes = await Promise.allSettled([
      create(`relationship-a-${suffix}`),
      create(`relationship-b-${suffix}`),
    ]);
    const completed = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
    expect(completed.length === 1, "concurrent relationship creation did not produce exactly one winner");
    expect(rejected.length === 1, "concurrent relationship creation did not reject exactly one duplicate");

    const duplicate = rejected[0];
    expect(
      duplicate?.status === "rejected"
        && duplicate.reason instanceof Error
        && "code" in duplicate.reason
        && duplicate.reason.code === "RELATIONSHIP_EXISTS",
      "duplicate relationship did not return the safe relationship-exists error",
    );

    const relationshipCount = await prisma.planetRelationship.count({
      where: {
        userId: user.id,
        galaxyId: galaxy.id,
        sourcePlanetId: source.id,
        targetPlanetId: target.id,
        relationshipType: "parent",
        deletedAt: null,
      },
    });
    const idempotencyCount = await prisma.idempotencyRecord.count({
      where: {
        userId: user.id,
        galaxyId: galaxy.id,
        scope: `planet:${source.id}:relationship:create`,
      },
    });
    expect(relationshipCount === 1, "concurrent relationship creation persisted a duplicate relationship");
    expect(idempotencyCount === 1, "duplicate relationship failure left an idempotency record behind");

    process.stdout.write("postgres-planet-relationship-race=passed\n");
  } finally {
    await prisma.$disconnect();
  }
}

void main();
