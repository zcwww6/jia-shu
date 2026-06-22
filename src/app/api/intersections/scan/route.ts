import { NextResponse } from "next/server";

import { scanResonanceWithFallback } from "@/server/ai/ai-client";
import { ensureResonanceCandidate } from "@/server/ai/guardrails";
import { isResonanceScanRequest } from "@/server/ai/schemas";

export async function POST(request: Request) {
  const payload = await request.json();

  if (!isResonanceScanRequest(payload)) {
    return NextResponse.json({ message: "共鸣扫描请求格式不正确" }, { status: 400 });
  }

  const result = await scanResonanceWithFallback(payload);

  return NextResponse.json(ensureResonanceCandidate(result));
}
