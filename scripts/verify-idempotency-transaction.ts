import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { prismaIdempotencyRepository } from "@/server/db/idempotency-repo";
import { executeIdempotentDbOperation } from "@/server/services/idempotency.service";

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
    const user = await prisma.user.create({ data: { email: `idempotency-${suffix}@example.test` } });
    const galaxy = await prisma.galaxy.create({ data: { userId: user.id, name: "Idempotency verification" } });
    const request = {
      userId: user.id,
      galaxyId: galaxy.id,
      scope: "verification:transaction",
      key: `verification-${suffix}`,
      requestHash: `hash-${suffix}`,
    };

    let callbackFailureObserved = false;
    try {
      await executeIdempotentDbOperation(
        prisma,
        prismaIdempotencyRepository,
        request,
        async (transaction) => {
          await transaction.planet.create({
            data: {
              userId: user.id,
              galaxyId: galaxy.id,
              name: "Must roll back",
              type: "other",
            },
          });
          throw new Error("controlled callback failure");
        },
      );
    } catch (error) {
      expect(error instanceof Error && error.message === "controlled callback failure", "unexpected rollback error");
      callbackFailureObserved = true;
    }
    expect(callbackFailureObserved, "controlled transaction failure unexpectedly succeeded");

    const rolledBackPlanetCount = await prisma.planet.count({ where: { userId: user.id, galaxyId: galaxy.id } });
    const rolledBackRecordCount = await prisma.idempotencyRecord.count({
      where: { userId: user.id, galaxyId: galaxy.id, scope: request.scope, key: request.key },
    });
    expect(rolledBackPlanetCount === 0, "failed callback left a planet row behind");
    expect(rolledBackRecordCount === 0, "failed callback left an idempotency record behind");

    const completed = await executeIdempotentDbOperation(
      prisma,
      prismaIdempotencyRepository,
      request,
      async (transaction, operationId) => {
        const planet = await transaction.planet.create({
          data: {
            userId: user.id,
            galaxyId: galaxy.id,
            name: "Committed after retry",
            type: "other",
          },
        });
        return {
          resourceType: "planet",
          resourceId: planet.id,
          result: { id: planet.id },
          response: { id: planet.id, operationId },
          responseStatus: 201,
        };
      },
    );
    expect(completed.kind === "completed" && completed.status === 201, "same key could not complete after rollback");

    const completedPlanetCount = await prisma.planet.count({ where: { userId: user.id, galaxyId: galaxy.id } });
    const completedRecord = await prisma.idempotencyRecord.findUnique({
      where: { userId_galaxyId_scope_key: { userId: user.id, galaxyId: galaxy.id, scope: request.scope, key: request.key } },
    });
    expect(completedPlanetCount === 1, "successful retry did not persist exactly one planet");
    expect(completedRecord?.status === "completed", "successful retry did not complete its idempotency record");

    process.stdout.write("postgres-idempotency-transaction=passed\n");
  } finally {
    await prisma.$disconnect();
  }
}

void main();
