import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { resolvePersonalGalaxyScope } from "@/server/db/galaxy-repo";
import { listActiveBookShareSummaries } from "@/server/db/shared-book-repo";
import { DomainError } from "@/server/domain-error";
import { createBookShare } from "@/server/services/book.service";
import { createShareSchema, idempotencyKeySchema } from "@/server/validation/domain-schemas";

type ShareContext = {
  params: Promise<{ bookId: string }>;
};

export async function GET(_request: Request, context: ShareContext) {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ code: "UNAUTHENTICATED", message: "请先登录后再查看家书分享。" }, { status: 401 });
  }

  const scope = await resolvePersonalGalaxyScope(userId);
  const { bookId } = await context.params;
  const shares = await listActiveBookShareSummaries({ ...scope, bookId });

  return NextResponse.json({
    shares: shares.map((share) => ({ ...share, url: `/share/${share.token}` })),
  });
}

export async function POST(request: Request, context: ShareContext) {
  try {
    const session = await auth();
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ code: "UNAUTHENTICATED", message: "请先登录后再分享家书。" }, { status: 401 });
    }

    const idempotencyKey = readIdempotencyKey(request);
    const payload = await readPayload(request);
    const scope = await resolvePersonalGalaxyScope(userId);
    const { bookId } = await context.params;
    const result = await createBookShare(scope, bookId, { ...payload, idempotencyKey });

    return idempotencyResponse(result);
  } catch (error) {
    return shareErrorResponse(error);
  }
}

async function readPayload(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw invalidPayload();
  }

  const parsed = createShareSchema.safeParse(body);

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

function idempotencyResponse(result: Awaited<ReturnType<typeof createBookShare>>) {
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
  return new DomainError("BOOK_SHARE_INPUT_INVALID", 400, "家书分享请求格式不正确。");
}

function shareErrorResponse(error: unknown) {
  if (error instanceof DomainError) {
    return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
  }

  return NextResponse.json({ code: "INTERNAL_ERROR", message: "请求无法完成，请稍后重试。" }, { status: 500 });
}
