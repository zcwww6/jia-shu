import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { resolvePersonalGalaxyScope } from "@/server/db/galaxy-repo";
import { DomainError } from "@/server/domain-error";
import { confirmTextMemory } from "@/server/services/memory.service";
import { confirmMemorySchema } from "@/server/validation/domain-schemas";

type MemoryContext = {
  params: Promise<{ memoryId: string }>;
};

export async function POST(request: Request, context: MemoryContext) {
  try {
    const scope = await requireScope();
    const { memoryId } = await context.params;
    const parsed = confirmMemorySchema.safeParse(await payloadWithVersion(request));

    if (!parsed.success) {
      throw invalidPayload();
    }

    const confirmed = await confirmTextMemory(scope, memoryId, parsed.data);
    return NextResponse.json(confirmed);
  } catch (error) {
    return memoryErrorResponse(error);
  }
}

async function requireScope() {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    throw new DomainError("UNAUTHENTICATED", 401, "请先登录后再管理记忆。");
  }

  return resolvePersonalGalaxyScope(userId);
}

async function payloadWithVersion(request: Request): Promise<unknown> {
  const body = await readBody(request);
  const headerVersion = readIfMatchVersion(request);

  if (headerVersion === undefined) {
    return body;
  }

  if (!isRecord(body) || (body.version !== undefined && body.version !== headerVersion)) {
    throw invalidPayload();
  }

  return { ...body, version: headerVersion };
}

async function readBody(request: Request): Promise<unknown> {
  const text = await request.text();

  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    throw invalidPayload();
  }
}

function readIfMatchVersion(request: Request) {
  const value = request.headers.get("If-Match-Version");

  if (value === null) {
    return undefined;
  }

  if (!/^[1-9]\d*$/.test(value)) {
    throw invalidPayload();
  }

  const version = Number(value);

  if (!Number.isSafeInteger(version)) {
    throw invalidPayload();
  }

  return version;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidPayload() {
  return new DomainError("MEMORY_CONFIRMATION_INVALID", 400, "记忆确认请求格式不正确。");
}

function memoryErrorResponse(error: unknown) {
  if (error instanceof DomainError) {
    return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
  }

  return NextResponse.json({ code: "INTERNAL_ERROR", message: "请求无法完成，请稍后重试。" }, { status: 500 });
}
