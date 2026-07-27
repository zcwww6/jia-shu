import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { resolvePersonalGalaxyScope } from "@/server/db/galaxy-repo";
import { DomainError } from "@/server/domain-error";
import { toPublicResonanceCandidate } from "@/server/services/resonance-public";
import { scanResonanceCandidates } from "@/server/services/resonance.service";
import { scanResonanceSchema } from "@/server/validation/domain-schemas";

export async function POST(request: Request) {
  try {
    const scope = await requireScope();
    const payload = await readPayload(request);
    const candidates = await scanResonanceCandidates(scope, payload.memoryId);

    return NextResponse.json({ candidates: candidates.map(toPublicResonanceCandidate) });
  } catch (error) {
    return resonanceErrorResponse(error);
  }
}

async function requireScope() {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    throw new DomainError("UNAUTHENTICATED", 401, "请先登录后再扫描共鸣候选。");
  }

  return resolvePersonalGalaxyScope(userId);
}

async function readPayload(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw invalidPayload();
  }

  const parsed = scanResonanceSchema.safeParse(body);

  if (!parsed.success) {
    throw invalidPayload();
  }

  return parsed.data;
}

function invalidPayload() {
  return new DomainError("RESONANCE_SCAN_INVALID", 400, "共鸣扫描请求格式不正确。");
}

function resonanceErrorResponse(error: unknown) {
  if (error instanceof DomainError) {
    return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
  }

  return NextResponse.json({ code: "INTERNAL_ERROR", message: "请求无法完成，请稍后重试。" }, { status: 500 });
}
