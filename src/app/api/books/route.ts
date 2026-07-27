import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { resolvePersonalGalaxyScope } from "@/server/db/galaxy-repo";
import { DomainError } from "@/server/domain-error";
import { createBookFromMemories } from "@/server/services/book.service";
import { listBookSummaries } from "@/server/db/book-repo";
import { createBookSchema, idempotencyKeySchema } from "@/server/validation/domain-schemas";

export async function POST(request: Request) {
  try {
    const session = await auth();
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ code: "UNAUTHENTICATED", message: "请先登录后再生成家书。" }, { status: 401 });
    }

    const idempotencyKey = readIdempotencyKey(request);
    const payload = await readPayload(request);
    const scope = await resolvePersonalGalaxyScope(userId);
    const result = await createBookFromMemories(scope, { ...payload, idempotencyKey });

    return idempotencyResponse(result);
  } catch (error) {
    return bookErrorResponse(error);
  }
}

export async function GET() {
  try {
    const userId = (await auth())?.user?.id;
    if (!userId) return NextResponse.json({ code: "UNAUTHENTICATED", message: "请先登录后再查看家书。" }, { status: 401 });
    const scope = await resolvePersonalGalaxyScope(userId);
    const books = await listBookSummaries(scope);
    return NextResponse.json(books.map((book) => ({ id: book.id, title: book.title, status: book.status, memoryCount: book._count.memories, updatedAt: book.updatedAt.toISOString() })));
  } catch (error) { return bookErrorResponse(error); }
}

async function readPayload(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw invalidPayload();
  }

  const parsed = createBookSchema.safeParse(body);

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

function idempotencyResponse(result: Awaited<ReturnType<typeof createBookFromMemories>>) {
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
  return new DomainError("BOOK_INPUT_INVALID", 400, "家书请求格式不正确。");
}

function bookErrorResponse(error: unknown) {
  if (error instanceof DomainError) {
    return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
  }

  return NextResponse.json({ code: "INTERNAL_ERROR", message: "请求无法完成，请稍后重试。" }, { status: 500 });
}
