import { NextResponse } from "next/server";

import { LEGACY_AI_FEATURE_DISABLED_RESPONSE } from "@/shared/legacy-ai-entry";

export async function POST(request: Request) {
  void request;

  return NextResponse.json(LEGACY_AI_FEATURE_DISABLED_RESPONSE, { status: 410 });
}
