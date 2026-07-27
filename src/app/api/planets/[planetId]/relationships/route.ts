import { auth } from "@/auth";
import { resolvePersonalGalaxyScope } from "@/server/db/galaxy-repo";
import { DomainError } from "@/server/domain-error";
import { createFamilyRelationship } from "@/server/services/planet.service";
import {
  createPlanetRelationshipSchema,
  idempotencyKeySchema,
} from "@/server/validation/domain-schemas";
import { NextResponse } from "next/server";

type RelationshipContext = {
  params: Promise<{ planetId: string }>;
};

export async function POST(request: Request, context: RelationshipContext) {
  try {
    const session = await auth();
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ code: "UNAUTHENTICATED", message: "请先登录后再管理星球。" }, { status: 401 });
    }

    const scope = await resolvePersonalGalaxyScope(userId);
    const { planetId: sourcePlanetId } = await context.params;
    const payload = await readPayload(request);

    if (sourcePlanetId === payload.targetPlanetId) {
      throw new DomainError("RELATIONSHIP_SELF_LINK", 400, "不能将星球与自身建立关系。");
    }

    const idempotencyKey = readIdempotencyKey(request);
    const result = await createFamilyRelationship(scope, sourcePlanetId, { ...payload, idempotencyKey });

    return idempotencyResponse(result);
  } catch (error) {
    return relationshipErrorResponse(error);
  }
}

async function readPayload(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw invalidPayload();
  }

  const parsed = createPlanetRelationshipSchema.safeParse(body);

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

function idempotencyResponse(result: Awaited<ReturnType<typeof createFamilyRelationship>>) {
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
  return new DomainError("PLANET_INPUT_INVALID", 400, "星球关系请求格式不正确。");
}

function relationshipErrorResponse(error: unknown) {
  if (error instanceof DomainError) {
    return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
  }

  return NextResponse.json({ code: "INTERNAL_ERROR", message: "请求无法完成，请稍后重试。" }, { status: 500 });
}
