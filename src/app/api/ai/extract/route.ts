import { NextResponse } from "next/server";

import { extractMemoryWithFallback } from "@/server/ai/ai-client";
import { ensureConfirmedMemory } from "@/server/ai/guardrails";
import { isMemoryExtractRequest } from "@/server/ai/schemas";

export async function POST(request: Request) {
  const payload = await request.json();

  if (!isMemoryExtractRequest(payload)) {
    return NextResponse.json({ message: "记忆提取请求格式不正确" }, { status: 400 });
  }

  const result = await extractMemoryWithFallback(payload);

  return NextResponse.json(ensureConfirmedMemory(result));
}
