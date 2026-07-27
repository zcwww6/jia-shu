import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { resolvePersonalGalaxyScope } from "@/server/db/galaxy-repo";
import { DomainError } from "@/server/domain-error";
import { createAssetBackedMemory } from "@/server/services/memory.service";
import { createMemorySchema, idempotencyKeySchema } from "@/server/validation/domain-schemas";

export async function POST(request: Request) {
  try {
    const session = await auth();
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ code: "UNAUTHENTICATED", message: "请先登录后再管理记忆。" }, { status: 401 });
    }

    const idempotencyKey = readIdempotencyKey(request);
    const payload = await readPayload(request);
    const scope = await resolvePersonalGalaxyScope(userId);
    const result = await createAssetBackedMemory(scope, { ...payload, idempotencyKey });

    return idempotencyResponse(result);
  } catch (error) {
    return memoryErrorResponse(error);
  }
}

async function readPayload(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw invalidPayload();
  }

  const parsed = createMemorySchema.safeParse(body);

  if (!parsed.success) {
    throw invalidPayload();
  }

  return parsed.data;
}

function readIdempotencyKey(request: Request) {
  const parsed = idempotencyKeySchema.safeParse(request.headers.get("Idempotency-Key") ?? "");

  if (!parsed.success) {
    throw new DomainError("IDEMPOTENCY_KEY_INVALID", 400, "幂等键格式不正确。");
  }

  return parsed.data;
}

function idempotencyResponse(result: Awaited<ReturnType<typeof createAssetBackedMemory>>) {
  if (result.kind === "completed") {
    return NextResponse.json(result.response, { status: result.status });
  }

  if (result.kind === "processing") {
    return NextResponse.json({
      code: "IDEMPOTENCY_PROCESSING",
      message: "请求仍在处理中，请稍后重试。",
    }, { status: result.status });
  }

  return NextResponse.json({
    code: "IDEMPOTENCY_EXPIRED",
    message: "幂等请求已过期，请先确认结果后再重试。",
  }, { status: result.status });
}

function invalidPayload() {
  return new DomainError("MEMORY_INPUT_INVALID", 400, "记忆请求格式不正确。");
}

function memoryErrorResponse(error: unknown) {
  if (error instanceof DomainError) {
    return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
  }

  return NextResponse.json({ code: "INTERNAL_ERROR", message: "请求无法完成，请稍后重试。" }, { status: 500 });
}
