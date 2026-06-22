import { NextResponse } from "next/server";

import { generateBookWithFallback } from "@/server/ai/ai-client";
import { ensureShareableBook, ensureSourceTrace } from "@/server/ai/guardrails";
import { isBookGenerateRequest } from "@/server/ai/schemas";

export async function POST(request: Request) {
  const payload = await request.json();

  if (!isBookGenerateRequest(payload)) {
    return NextResponse.json({ message: "家书生成请求格式不正确" }, { status: 400 });
  }

  const result = await generateBookWithFallback(payload);

  return NextResponse.json(ensureShareableBook(ensureSourceTrace(payload, result)));
}
