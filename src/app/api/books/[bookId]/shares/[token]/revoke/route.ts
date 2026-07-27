import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { resolvePersonalGalaxyScope } from "@/server/db/galaxy-repo";
import { DomainError } from "@/server/domain-error";
import { revokeBookShare } from "@/server/services/book.service";
import { idempotencyKeySchema } from "@/server/validation/domain-schemas";

type RevokeContext = {
  params: Promise<{ bookId: string; token: string }>;
};

export async function POST(request: Request, context: RevokeContext) {
  try {
    const session = await auth();
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ code: "UNAUTHENTICATED", message: "请先登录后再撤回家书分享。" }, { status: 401 });
    }

    const idempotencyKey = readIdempotencyKey(request);
    const scope = await resolvePersonalGalaxyScope(userId);
    const { bookId, token } = await context.params;
    const result = await revokeBookShare(scope, bookId, token, { idempotencyKey });

    return idempotencyResponse(result);
  } catch (error) {
    return revokeErrorResponse(error);
  }
}

function readIdempotencyKey(request: Request) {
  const parsed = idempotencyKeySchema.safeParse(request.headers.get("Idempotency-Key") ?? "");

  if (!parsed.success) {
    throw new DomainError("IDEMPOTENCY_KEY_INVALID", 400, "幂等键格式不正确。");
  }

  return parsed.data;
}

function idempotencyResponse(result: Awaited<ReturnType<typeof revokeBookShare>>) {
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

function revokeErrorResponse(error: unknown) {
  if (error instanceof DomainError) {
    return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
  }

  return NextResponse.json({ code: "INTERNAL_ERROR", message: "请求无法完成，请稍后重试。" }, { status: 500 });
}
