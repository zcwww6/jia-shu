import { auth } from "@/auth";
import { ensurePersonalGalaxyScopeForFirstWrite } from "@/server/db/galaxy-repo";
import { DomainError } from "@/server/domain-error";
import { createFamilyPlanet } from "@/server/services/planet.service";
import { createPlanetSchema, idempotencyKeySchema } from "@/server/validation/domain-schemas";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const session = await auth();
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ code: "UNAUTHENTICATED", message: "请先登录后再管理星球。" }, { status: 401 });
    }

    const idempotencyKey = readIdempotencyKey(request);
    const payload = await readPayload(request);
    const scope = await ensurePersonalGalaxyScopeForFirstWrite(userId);
    const result = await createFamilyPlanet(scope, { ...payload, idempotencyKey });

    return idempotencyResponse(result);
  } catch (error) {
    return planetErrorResponse(error);
  }
}

async function readPayload(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw new DomainError("PLANET_INPUT_INVALID", 400, "星球请求格式不正确。");
  }

  const parsed = createPlanetSchema.safeParse(body);

  if (!parsed.success) {
    throw new DomainError("PLANET_INPUT_INVALID", 400, "星球请求格式不正确。");
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

function idempotencyResponse(result: Awaited<ReturnType<typeof createFamilyPlanet>>) {
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

function planetErrorResponse(error: unknown) {
  if (error instanceof DomainError) {
    return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
  }

  return NextResponse.json({ code: "INTERNAL_ERROR", message: "请求无法完成，请稍后重试。" }, { status: 500 });
}
