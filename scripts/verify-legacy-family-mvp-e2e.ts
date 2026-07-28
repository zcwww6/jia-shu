import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

import { encode } from "next-auth/jwt";

type JsonRecord = Record<string, unknown>;
type VerifiedPlanet = { id: string; version: number; coverAssetId: string | null };
type VerifiedAsset = { id: string; status: string };
type VerifiedMemory = { id: string; version: number; status: string; title: string | null; summary: string | null };
type VerifiedJob = { id: string; status: string; errorCode?: string | null };
type VerifiedResonance = { id: string; version: number; status: string };
type VerifiedBook = { id: string; version: number; body: string };
type VerifiedShare = { token: string; url: string };

type Options = {
  baseUrl: string;
  envFile: string;
  appContainer: string;
  postgresContainer: string;
  includeMultimodal: boolean;
  includeAudio: boolean;
  keepArtifacts: boolean;
};

type PostgresTarget = { container: string; user: string; database: string };

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function main() {
  const options = readOptions(process.argv.slice(2));
  const env = await readEnvFile(options.envFile);
  requireEnv(env, "AUTH_SECRET");
  const postgres = await readPostgresTarget(options.postgresContainer);
  const subject = createSubject();
  let failed = true;

  try {
    await seedE2eSubject(postgres, subject);

    const requester = await authenticatedRequester(options.baseUrl, env.AUTH_SECRET, subject);
    const mom = await createPlanet(requester, {
      name: "验收妈妈星球",
      type: "parent",
      role: "妈妈",
      position: { x: 30, y: 45 },
    });
    const daughter = await createPlanet(requester, {
      name: "验收女儿星球",
      type: "child",
      role: "女儿",
      position: { x: 70, y: 55 },
    });

    await requestJson(requester, `/api/planets/${mom.id}/relationships`, {
      method: "POST",
      idempotent: true,
      body: {
        targetPlanetId: daughter.id,
        relationshipType: "child",
        label: "母女星轨",
        visibility: "family",
      },
      expectedStatus: 201,
    });

    const cover = await uploadAsset(requester, mom.id, "planet_cover", "private", onePixelPng, "family-cover.png", "image/png");
    const coveredMom = await requestJson<VerifiedPlanet>(requester, `/api/planets/${mom.id}`, {
      method: "PATCH",
      body: { version: mom.version, coverAssetId: cover.id },
      expectedStatus: 200,
    });
    requireValue(coveredMom.coverAssetId === cover.id, "星球封面没有写入 Planet。");

    const memoryA = await createAndConfirmTextMemory(requester, mom.id, {
      label: "妈妈的家庭春日聚餐",
      sourceText: "2026 家庭春日聚餐，妈妈和女儿在家庭餐桌前一起做了第一顿饭。",
    });
    const memoryB = await createAndConfirmTextMemory(requester, daughter.id, {
      label: "女儿的家庭春日聚餐",
      sourceText: "2026 家庭春日聚餐，女儿和妈妈在家庭餐桌前记下第一顿饭的味道。",
    });

    if (options.includeMultimodal) {
      await createAndConfirmUploadedMemory(requester, mom.id, {
        kind: "image",
        bytes: onePixelPng,
        name: "family-photo.png",
        mimeType: "image/png",
        label: "图片记忆验收",
      });
      await createAndConfirmUploadedMemory(requester, daughter.id, {
        kind: "document",
        bytes: Buffer.from("2026 家庭春日聚餐日记：妈妈和女儿一起做饭，记住了家的味道。", "utf8"),
        name: "family-diary.txt",
        mimeType: "text/plain",
        label: "日记记忆验收",
      });
    }

    if (options.includeAudio) {
      await createAndConfirmUploadedMemory(requester, mom.id, {
        kind: "audio",
        bytes: createPcmWave(1),
        name: "family-voice.wav",
        mimeType: "audio/wav",
        label: "语音记忆验收",
      });
    }

    const scanned = await requestJson<{ candidates: VerifiedResonance[] }>(requester, "/api/resonances/scan", {
      method: "POST",
      body: { memoryId: memoryA.id },
      expectedStatus: 200,
    });
    const candidate = scanned.candidates.find((item) => item.status === "candidate" && item.id);
    requireValue(candidate, "共鸣扫描没有返回可确认的候选星轨。");
    const confirmedResonance = await requestJson<VerifiedResonance>(requester, `/api/resonances/${candidate.id}/confirm`, {
      method: "POST",
      body: { status: "confirmed", version: candidate.version },
      expectedStatus: 200,
    });
    requireValue(confirmedResonance.status === "confirmed", "共鸣候选没有保存为 confirmed。");

    const createdBook = await requestJson<{ id: string; body: string }>(requester, "/api/books", {
      method: "POST",
      idempotent: true,
      body: {
        title: "春日餐桌家书",
        sourceMemoryIds: [memoryA.id, memoryB.id],
        sourceRange: "binary_system",
        themeTemplateKey: "亲子成长",
        visibility: "family",
      },
      expectedStatus: 201,
    });
    requireValue(Boolean(createdBook.body?.trim()), "AI 家书没有返回正文。");

    const savedBook = await requestJson<VerifiedBook>(requester, `/api/books/${createdBook.id}`, {
      method: "GET",
      expectedStatus: 200,
    });
    const editedBook = await requestJson<VerifiedBook>(requester, `/api/books/${createdBook.id}`, {
      method: "PATCH",
      body: {
        version: savedBook.version,
        title: "春日餐桌家书（已确认）",
        body: `${savedBook.body}\n\n家书闭环验收：管理员确认后保存。`,
      },
      expectedStatus: 200,
    });
    requireValue(editedBook.version > savedBook.version, "家书编辑没有递增版本。");

    const share = await requestJson<VerifiedShare>(requester, `/api/books/${createdBook.id}/shares`, {
      method: "POST",
      idempotent: true,
      body: { showBody: true, showSourceTitles: true, showOriginalText: false },
      expectedStatus: 201,
    });
    const publicBeforeRevoke = await fetch(new URL(share.url, options.baseUrl));
    requireValue(publicBeforeRevoke.status === 200, "公开家书分享在撤回前不可访问。");
    await requestJson(requester, `/api/books/${createdBook.id}/shares/${share.token}/revoke`, {
      method: "POST",
      idempotent: true,
      expectedStatus: 200,
    });
    const publicAfterRevoke = await fetch(new URL(`/share/${share.token}`, options.baseUrl), { redirect: "manual" });
    requireValue(publicAfterRevoke.status === 404, "撤回后分享链接仍可访问。");

    failed = false;
    console.log(JSON.stringify({
      status: "passed",
      verified: [
        "authenticated planets and relationship",
        "private cover upload and versioned Planet save",
        "two text AI jobs and explicit memory confirmations",
        ...(options.includeMultimodal ? ["private image AI job", "private diary AI job"] : []),
        ...(options.includeAudio ? ["private audio transcription AI job"] : []),
        "AI resonance scan and confirmation",
        "AI book generation, edit, share and revoke",
      ],
    }));
  } finally {
    if (!options.keepArtifacts) {
      await cleanupE2eSubject(postgres, options.appContainer, subject.userId);
    }
    if (failed && options.keepArtifacts) {
      console.error("E2E verifier stopped with artifacts retained by --keep-artifacts.");
    }
  }
}

function readOptions(args: string[]): Options {
  const valueAfter = (name: string, fallback: string) => {
    const index = args.indexOf(name);
    return index === -1 ? fallback : args[index + 1] ?? fallback;
  };

  return {
    baseUrl: valueAfter("--base-url", "http://localhost").replace(/\/$/, ""),
    envFile: resolve(valueAfter("--env-file", ".env.docker")),
    appContainer: valueAfter("--app-container", "jiashu-app-1"),
    postgresContainer: valueAfter("--postgres-container", "jiashu-postgres-1"),
    includeMultimodal: args.includes("--include-multimodal"),
    includeAudio: args.includes("--include-audio"),
    keepArtifacts: args.includes("--keep-artifacts"),
  };
}

async function readEnvFile(file: string) {
  const values: Record<string, string> = {};
  const source = await readFile(file, "utf8");

  for (const line of source.split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    values[key] = rawValue.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, "$1$2");
  }

  return values;
}

function requireEnv(env: Record<string, string>, key: string): asserts env is Record<string, string> & Record<typeof key, string> {
  if (!env[key]) throw new Error(`Missing ${key} in the configured environment file.`);
}

function createSubject() {
  const nonce = randomUUID().replaceAll("-", "");
  return {
    userId: `e2e_${nonce}`,
    email: `e2e-${nonce}@example.invalid`,
  };
}

async function authenticatedRequester(baseUrl: string, secret: string, subject: ReturnType<typeof createSubject>) {
  const token = await encode({
    token: { sub: subject.userId, email: subject.email, name: "家书闭环验收管理员" },
    secret,
    salt: "authjs.session-token",
  });

  return { baseUrl, cookie: `authjs.session-token=${token}` };
}

async function createPlanet(requester: Awaited<ReturnType<typeof authenticatedRequester>>, input: {
  name: string;
  type: "parent" | "child";
  role: string;
  position: { x: number; y: number };
}) {
  return requestJson<VerifiedPlanet>(requester, "/api/planets", {
    method: "POST",
    idempotent: true,
    body: { ...input, lifeState: "active", visibility: "family", theme: "亲子成长" },
    expectedStatus: 201,
  });
}

async function uploadAsset(
  requester: Awaited<ReturnType<typeof authenticatedRequester>>,
  planetId: string,
  kind: "image" | "audio" | "document" | "planet_cover",
  visibility: "private" | "family",
  bytes: Uint8Array,
  name: string,
  mimeType: string,
) {
  const form = new FormData();
  form.set("planetId", planetId);
  form.set("kind", kind);
  form.set("visibility", visibility);
  form.set("file", new Blob([copyToArrayBuffer(bytes)], { type: mimeType }), name);

  return requestJson<VerifiedAsset>(requester, "/api/assets", {
    method: "POST",
    idempotent: true,
    body: form,
    expectedStatus: 201,
  });
}

function copyToArrayBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function createAndConfirmTextMemory(
  requester: Awaited<ReturnType<typeof authenticatedRequester>>,
  planetId: string,
  input: { label: string; sourceText: string },
) {
  const draft = await requestJson<VerifiedMemory>(requester, "/api/memories", {
    method: "POST",
    idempotent: true,
    body: memoryDraftPayload(planetId, input.sourceText),
    expectedStatus: 201,
  });

  return finishMemoryAiReview(requester, draft, input.label);
}

async function createAndConfirmUploadedMemory(
  requester: Awaited<ReturnType<typeof authenticatedRequester>>,
  planetId: string,
  input: { kind: "image" | "audio" | "document"; bytes: Uint8Array; name: string; mimeType: string; label: string },
) {
  const asset = await uploadAsset(requester, planetId, input.kind, "private", input.bytes, input.name, input.mimeType);
  const draft = await requestJson<VerifiedMemory>(requester, "/api/memories", {
    method: "POST",
    idempotent: true,
    body: memoryDraftPayload(planetId, "", [asset.id]),
    expectedStatus: 201,
  });

  return finishMemoryAiReview(requester, draft, input.label);
}

function createPcmWave(durationSeconds: number) {
  const sampleRate = 8_000;
  const channels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const dataLength = sampleRate * durationSeconds * channels * bytesPerSample;
  const bytes = new Uint8Array(44 + dataLength);
  const view = new DataView(bytes.buffer);
  const encoder = new TextEncoder();
  const writeAscii = (offset: number, value: string) => bytes.set(encoder.encode(value), offset);

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(36, "data");
  view.setUint32(40, dataLength, true);

  return bytes;
}

function memoryDraftPayload(planetId: string, sourceText: string, assetIds: string[] = []) {
  return {
    planetId,
    sourceText,
    assetIds,
    visibility: "family",
    allowResonance: true,
    allowBook: true,
    occurredAtLabel: "2026 家庭春日聚餐",
  };
}

async function finishMemoryAiReview(
  requester: Awaited<ReturnType<typeof authenticatedRequester>>,
  draft: VerifiedMemory,
  label: string,
) {
  const job = await requestJson<VerifiedJob>(requester, `/api/memories/${draft.id}/ai-jobs`, {
    method: "POST",
    idempotent: true,
    body: { consent: true, purpose: "memory_extraction" },
    expectedStatus: 202,
  });
  await waitForSucceededJob(requester, job.id);
  const review = await requestJson<VerifiedMemory>(requester, `/api/memories/${draft.id}`, {
    method: "GET",
    expectedStatus: 200,
  });
  requireValue(review.status === "needs_confirmation", "AI 作业成功后没有进入待确认状态。");

  const confirmed = await requestJson<VerifiedMemory>(requester, `/api/memories/${draft.id}/confirm`, {
    method: "POST",
    body: {
      version: review.version,
      title: review.title ?? label,
      summary: review.summary ?? `${label}，由家庭管理员在验收中确认。`,
      occurredAtLabel: "2026 家庭春日聚餐",
      locationLabel: "家庭餐桌",
      people: ["妈妈", "女儿"],
    },
    expectedStatus: 200,
  });
  requireValue(confirmed.status === "confirmed", "记忆确认没有写入 confirmed 状态。");
  return confirmed;
}

async function waitForSucceededJob(requester: Awaited<ReturnType<typeof authenticatedRequester>>, jobId: string) {
  const deadline = Date.now() + 120_000;

  while (Date.now() < deadline) {
    const job = await requestJson<VerifiedJob>(requester, `/api/ai-jobs/${jobId}`, {
      method: "GET",
      expectedStatus: 200,
    });
    if (job.status === "succeeded" || job.status === "completed") return job;
    if (job.status === "failed") throw new Error(`AI job failed with safe code ${job.errorCode ?? "UNKNOWN"}.`);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error("AI job did not finish within two minutes.");
}

async function requestJson<T = JsonRecord>(
  requester: Awaited<ReturnType<typeof authenticatedRequester>>,
  path: string,
  input: { method: string; body?: unknown; idempotent?: boolean; expectedStatus: number },
) {
  const headers = new Headers({ cookie: requester.cookie });
  if (input.idempotent) headers.set("Idempotency-Key", `e2e-${randomUUID()}`);
  if (input.body !== undefined && !(input.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await fetch(new URL(path, requester.baseUrl), {
    method: input.method,
    headers,
    body: input.body instanceof FormData ? input.body : input.body === undefined ? undefined : JSON.stringify(input.body),
  });
  const body = await response.json().catch(() => ({})) as JsonRecord;

  if (response.status !== input.expectedStatus) {
    throw new Error(`Unexpected ${input.method} ${path}: HTTP ${response.status} (${typeof body.code === "string" ? body.code : "NO_CODE"}).`);
  }

  return body as T;
}

async function readPostgresTarget(container: string): Promise<PostgresTarget> {
  const [user, database] = await Promise.all([
    dockerOutput(["exec", container, "printenv", "POSTGRES_USER"]),
    dockerOutput(["exec", container, "printenv", "POSTGRES_DB"]),
  ]);

  if (!user || !database) throw new Error("PostgreSQL container is missing its database identity.");
  return { container, user, database };
}

async function seedE2eSubject(target: PostgresTarget, subject: ReturnType<typeof createSubject>) {
  await runPostgres(target, `INSERT INTO "User" ("id", "email", "name", "emailVerified", "updatedAt") VALUES (${sqlLiteral(subject.userId)}, ${sqlLiteral(subject.email)}, '家书闭环验收管理员', now(), now());`);
}

async function cleanupE2eSubject(target: PostgresTarget, appContainer: string, userId: string) {
  const user = sqlLiteral(userId);
  await runPostgres(target, [
    "BEGIN",
    `DELETE FROM "AiJob" WHERE "userId" = ${user}`,
    `DELETE FROM "IdempotencyRecord" WHERE "userId" = ${user}`,
    `DELETE FROM "SharedBook" WHERE "userId" = ${user}`,
    `DELETE FROM "BookMemory" WHERE "userId" = ${user}`,
    `DELETE FROM "ResonanceScanLease" WHERE "userId" = ${user}`,
    `DELETE FROM "ResonanceCandidate" WHERE "userId" = ${user}`,
    `UPDATE "Planet" SET "coverAssetId" = NULL WHERE "userId" = ${user}`,
    `DELETE FROM "MemoryAsset" WHERE "userId" = ${user}`,
    `DELETE FROM "Memory" WHERE "userId" = ${user}`,
    `DELETE FROM "PlanetRelationship" WHERE "userId" = ${user}`,
    `DELETE FROM "Book" WHERE "userId" = ${user}`,
    `DELETE FROM "Planet" WHERE "userId" = ${user}`,
    `DELETE FROM "Galaxy" WHERE "userId" = ${user}`,
    `DELETE FROM "User" WHERE "id" = ${user}`,
    "COMMIT",
  ].join(";\n"));
  await removeMediaDirectory(appContainer, userId);
}

async function runPostgres(target: PostgresTarget, sql: string) {
  await dockerOutput([
    "exec", target.container, "psql", "-U", target.user, "-d", target.database,
    "-v", "ON_ERROR_STOP=1", "-c", sql,
  ]);
}

function sqlLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

async function dockerOutput(args: string[]) {
  return new Promise<string>((resolvePromise, reject) => {
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    const process = spawn("docker", args, { windowsHide: true });
    process.stdout.on("data", (chunk: Buffer) => output.push(chunk));
    process.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    process.once("error", reject);
    process.once("exit", (code) => {
      if (code === 0) {
        resolvePromise(Buffer.concat(output).toString("utf8").trim());
        return;
      }
      reject(new Error(`Docker command failed (${args.slice(0, 3).join(" ")}): ${Buffer.concat(errors).toString("utf8").trim() || "no diagnostic"}`));
    });
  });
}

async function removeMediaDirectory(appContainer: string, userId: string) {
  if (!/^e2e_[a-z0-9]+$/.test(userId)) throw new Error("Refusing to remove a non-E2E media directory.");
  const mediaDirectory = `/data/media/${userId}`;
  await dockerOutput(["exec", appContainer, "sh", "-lc", `rm -rf ${mediaDirectory} && test ! -e ${mediaDirectory}`]);
}

function requireValue<T>(value: T | null | undefined | false, message: string): asserts value is T {
  if (!value) throw new Error(message);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Legacy MVP E2E verifier failed.");
  process.exitCode = 1;
});
