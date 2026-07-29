import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { resolvePersonalGalaxyScope } from "@/server/db/galaxy-repo";
import { DomainError } from "@/server/domain-error";
import { reviewBookSpread } from "@/server/services/book-review.service";
import { reviewBookSpreadSchema } from "@/server/validation/domain-schemas";

export async function POST(request: Request, { params }: { params: Promise<{ bookId: string }> }) {
  try {
    const userId = (await auth())?.user?.id;
    if (!userId) return NextResponse.json({ code: "UNAUTHENTICATED", message: "请先登录后再确认家书。" }, { status: 401 });
    const payload = reviewBookSpreadSchema.parse(await request.json());
    const scope = await resolvePersonalGalaxyScope(userId);
    const { bookId } = await params;
    return NextResponse.json(await reviewBookSpread(scope, bookId, payload));
  } catch (error) {
    const status = error instanceof DomainError ? error.status : 400;
    const message = error instanceof DomainError ? error.message : "家书逐页确认请求格式不正确。";
    return NextResponse.json({ code: error instanceof DomainError ? error.code : "BOOK_REVIEW_INPUT_INVALID", message }, { status });
  }
}
