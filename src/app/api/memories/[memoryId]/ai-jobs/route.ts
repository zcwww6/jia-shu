import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { resolvePersonalGalaxyScope } from "@/server/db/galaxy-repo";
import { DomainError } from "@/server/domain-error";
import { createMemoryAiJob } from "@/server/services/ai-job.service";
import { idempotencyKeySchema } from "@/server/validation/domain-schemas";

type MemoryContext = {
  params: Promise<{ memoryId: string }>;
};

export async function POST(request: Request, context: MemoryContext) {
  try {
    const scope = await requireScope();
    const { memoryId } = await context.params;
    const payload = await readPayload(request);
    const idempotencyKey = readIdempotencyKey(request);
    const result = await createMemoryAiJob(scope, memoryId, { ...payload, idempotencyKey });

    return idempotencyResponse(result);
  } catch (error) {
    return aiJobErrorResponse(error);
  }
}

async function requireScope() {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    throw new DomainError("UNAUTHENTICATED", 401, "请先登录后再使用智能整理记忆。");
  }

  return resolvePersonalGalaxyScope(userId);
}

async function readPayload(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw invalidPayload();
  }

  if (!isCreateJobPayload(body)) {
    throw invalidPayload();
  }

  return body;
}

function isCreateJobPayload(value: unknown): value is {
  consent: true;
  purpose?: "memory_extraction";
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const body = value as { consent?: unknown; purpose?: unknown };
  const allowedKeys = new Set(["consent", "purpose"]);
  return (
    Object.keys(body).every((key) => allowedKeys.has(key))
    && body.consent === true
    && (body.purpose === undefined || body.purpose === "memory_extraction")
  );
}

function readIdempotencyKey(request: Request) {
  const parsed = idempotencyKeySchema.safeParse(request.headers.get("Idempotency-Key") ?? "");

  if (!parsed.success) {
    throw new DomainError("IDEMPOTENCY_KEY_INVALID", 400, "幂等键格式不正确。");
  }

  return parsed.data;
}

function idempotencyResponse(result: Awaited<ReturnType<typeof createMemoryAiJob>>) {
  if (result.kind === "completed") {
    return NextResponse.json(result.response, { status: result.status });
  }

  if (result.kind === "processing") {
    return NextResponse.json({ code: "IDEMPOTENCY_PROCESSING", message: "请求仍在处理中，请稍后重试。" }, { status: result.status });
  }

  return NextResponse.json({
    code: "IDEMPOTENCY_EXPIRED",
    message: "幂等请求已过期，请先确认结果后再重试。",
  }, { status: result.status });
}

function invalidPayload() {
  return new DomainError("AI_JOB_INPUT_INVALID", 400, "AI 作业请求格式不正确。");
}

function aiJobErrorResponse(error: unknown) {
  if (error instanceof DomainError) {
    return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
  }

  return NextResponse.json({ code: "INTERNAL_ERROR", message: "请求无法完成，请稍后重试。" }, { status: 500 });
}
