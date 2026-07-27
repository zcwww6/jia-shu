import { NextResponse } from "next/server";

import { LEGACY_AI_ENDPOINT_DISABLED_RESPONSE } from "@/shared/legacy-ai-entry";

/**
 * This unauthenticated preview endpoint predates consent-bound AI jobs. It is
 * deliberately retired instead of translating browser payloads into implicit
 * jobs, because that would bypass owner scope, consent, and idempotency.
 */
export async function POST(request: Request) {
  void request;

  return NextResponse.json(LEGACY_AI_ENDPOINT_DISABLED_RESPONSE, { status: 410 });
}
