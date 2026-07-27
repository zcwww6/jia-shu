import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import {
  claimOneQueuedAiJob,
  completeMemoryAiJob,
  renewMemoryAiJobLease,
} from "@/server/db/ai-job-repo";

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  expect(databaseUrl, "DATABASE_URL is required");

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  const suffix = randomUUID().replaceAll("-", "");
  const now = new Date();
  const oldLeaseToken = `old-${suffix}`;

  try {
    const user = await prisma.user.create({
      data: { email: `lease-race-${suffix}@example.test` },
    });
    const galaxy = await prisma.galaxy.create({
      data: { userId: user.id, name: "Lease race verification" },
    });
    const planet = await prisma.planet.create({
      data: {
        userId: user.id,
        galaxyId: galaxy.id,
        name: "Verification planet",
        type: "other",
      },
    });
    const memory = await prisma.memory.create({
      data: {
        userId: user.id,
        galaxyId: galaxy.id,
        planetId: planet.id,
        sourceText: "Lease race verification memory.",
        status: "processing",
      },
    });
    const job = await prisma.aiJob.create({
      data: {
        userId: user.id,
        galaxyId: galaxy.id,
        planetId: planet.id,
        memoryId: memory.id,
        kind: "text_extraction",
        status: "processing",
        consentCapturedAt: now,
        requestHash: `request-${suffix}`,
        attempts: 1,
        leaseToken: oldLeaseToken,
        leaseExpiresAt: new Date(now.getTime() - 1_000),
      },
    });

    const replacement = await claimOneQueuedAiJob({ now });
    expect(replacement?.id === job.id, "replacement worker did not claim the expired job");
    expect(replacement.leaseToken !== oldLeaseToken, "replacement worker reused the old lease token");

    const oldRenewal = await renewMemoryAiJobLease({
      job: {
        id: job.id,
        userId: user.id,
        galaxyId: galaxy.id,
        leaseToken: oldLeaseToken,
      },
      now,
    });
    expect(oldRenewal === null, "old worker unexpectedly renewed the replacement lease");

    const replacementRenewal = await renewMemoryAiJobLease({ job: replacement, now });
    expect(replacementRenewal instanceof Date, "replacement worker could not renew its lease");

    let oldWorkerRejected = false;
    try {
      await completeMemoryAiJob({
        job: {
          id: job.id,
          userId: user.id,
          galaxyId: galaxy.id,
          memoryId: memory.id,
          leaseToken: oldLeaseToken,
        },
        memoryVersion: memory.version,
        draft: {
          title: "Old worker must not win",
          summary: "This draft must never be persisted.",
          locationLabel: null,
          people: [],
          emotions: [],
          uncertainFields: [],
        },
        now,
      });
    } catch (error) {
      expect(
        error instanceof Error && "code" in error && error.code === "AI_JOB_LEASE_LOST",
        "old worker failed with an unexpected error",
      );
      oldWorkerRejected = true;
    }
    expect(oldWorkerRejected, "old worker unexpectedly completed the reclaimed job");

    const afterOldCompletion = await prisma.aiJob.findUniqueOrThrow({ where: { id: job.id } });
    const memoryAfterOldCompletion = await prisma.memory.findUniqueOrThrow({ where: { id: memory.id } });
    expect(afterOldCompletion.status === "processing", "old worker changed the reclaimed job status");
    expect(afterOldCompletion.leaseToken === replacement.leaseToken, "old worker overwrote the replacement lease");
    expect(memoryAfterOldCompletion.status === "processing", "old worker advanced the memory");
    expect(memoryAfterOldCompletion.title === null, "old worker persisted its draft");

    await completeMemoryAiJob({
      job: replacement,
      memoryVersion: memory.version,
      draft: {
        title: "Replacement worker wins",
        summary: "The current lease completed successfully.",
        locationLabel: null,
        people: [],
        emotions: [],
        uncertainFields: [],
      },
      now: new Date(now.getTime() + 1),
    });

    const completedJob = await prisma.aiJob.findUniqueOrThrow({ where: { id: job.id } });
    const completedMemory = await prisma.memory.findUniqueOrThrow({ where: { id: memory.id } });
    expect(completedJob.status === "succeeded", "replacement worker did not complete the job");
    expect(completedMemory.status === "needs_confirmation", "replacement worker did not advance the memory");
    expect(completedMemory.title === "Replacement worker wins", "replacement draft was not persisted");

    process.stdout.write("postgres-ai-job-lease-race=passed\n");
  } finally {
    await prisma.$disconnect();
  }
}

void main();
