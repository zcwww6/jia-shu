import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { join } from "node:path";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import {
  MEMORY_EXTRACTION_PURPOSE,
  memoryAiSnapshotHash,
} from "@/server/ai/memory-ai-contract";

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function waitFor<T>(read: () => Promise<T | null>, message: string): Promise<T> {
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    const value = await read();
    if (value) {
      return value;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(message);
}

function startWorker(env: NodeJS.ProcessEnv): ChildProcess {
  return spawn(process.execPath, [join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), "src/server/worker.ts"], {
    cwd: process.cwd(),
    env,
    stdio: "ignore",
  });
}

async function stopWorker(worker: ChildProcess | undefined) {
  if (!worker || worker.exitCode !== null) {
    return;
  }

  worker.kill();
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 2_000);
    worker.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function startProvider() {
  let calls = 0;
  let firstRequestSeen: (() => void) | undefined;
  const firstRequest = new Promise<void>((resolve) => {
    firstRequestSeen = resolve;
  });

  const server = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/chat/completions") {
      response.writeHead(404).end();
      return;
    }

    calls += 1;

    if (calls === 1) {
      firstRequestSeen?.();
      return;
    }

    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            title: "Restart recovery",
            summary: "A replacement worker safely completed the queued memory.",
            locationLabel: null,
            people: [],
            emotions: [],
            uncertainFields: [],
          }),
        },
      }],
    }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  expect(address && typeof address !== "string", "controlled provider did not expose a local port");

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    firstRequest,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  expect(databaseUrl, "DATABASE_URL is required");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const provider = await startProvider();
  const suffix = randomUUID().replaceAll("-", "");
  let firstWorker: ChildProcess | undefined;
  let replacementWorker: ChildProcess | undefined;

  try {
    const user = await prisma.user.create({ data: { email: `worker-restart-${suffix}@example.test` } });
    const galaxy = await prisma.galaxy.create({ data: { userId: user.id, name: "Worker restart verification" } });
    const planet = await prisma.planet.create({
      data: { userId: user.id, galaxyId: galaxy.id, name: "Verification planet", type: "other" },
    });
    const memory = await prisma.memory.create({
      data: {
        userId: user.id,
        galaxyId: galaxy.id,
        planetId: planet.id,
        sourceText: "A synthetic memory used only for restart verification.",
        status: "processing",
      },
    });
    const requestHash = memoryAiSnapshotHash({
      memoryId: memory.id,
      sourceText: memory.sourceText,
      version: memory.version,
      purpose: MEMORY_EXTRACTION_PURPOSE,
      assets: [],
    });
    const job = await prisma.aiJob.create({
      data: {
        userId: user.id,
        galaxyId: galaxy.id,
        planetId: planet.id,
        memoryId: memory.id,
        kind: "text_extraction",
        consentCapturedAt: new Date(),
        requestHash,
      },
    });
    const workerEnv = {
      ...process.env,
      DATABASE_URL: databaseUrl,
      OPENAI_API_KEY: "verification-key",
      OPENAI_MODEL: "verification-model",
      OPENAI_BASE_URL: provider.baseUrl,
      OPENAI_VISION_MODEL: "",
      OPENAI_TRANSCRIPTION_MODEL: "",
      OPENAI_EMBEDDING_MODEL: "",
    };

    firstWorker = startWorker(workerEnv);
    await provider.firstRequest;

    const firstClaim = await waitFor(
      async () => prisma.aiJob.findFirst({
        where: { id: job.id, status: "processing", leaseToken: { not: null } },
      }),
      "first worker did not claim the job before provider work",
    );
    await stopWorker(firstWorker);
    firstWorker = undefined;

    await prisma.aiJob.update({
      where: { id: job.id },
      data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
    });

    replacementWorker = startWorker(workerEnv);
    const completed = await waitFor(
      async () => prisma.aiJob.findFirst({ where: { id: job.id, status: "succeeded" } }),
      "replacement worker did not complete the reclaimed job",
    );
    const completedMemory = await prisma.memory.findUniqueOrThrow({ where: { id: memory.id } });

    expect(firstClaim.leaseToken !== completed.leaseToken, "replacement worker retained the stopped worker lease");
    expect(completed.attempts === 2, "replacement worker did not record a second processing attempt");
    expect(completedMemory.status === "needs_confirmation", "replacement worker did not advance the memory for review");
    expect(completedMemory.title === "Restart recovery", "replacement worker did not persist the controlled provider draft");

    process.stdout.write("postgres-ai-job-worker-restart=passed\n");
  } finally {
    await stopWorker(firstWorker);
    await stopWorker(replacementWorker);
    await provider.close();
    await prisma.$disconnect();
  }
}

void main();
