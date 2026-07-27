import { auth } from "@/auth";
import { resolvePersonalGalaxyScope } from "@/server/db/galaxy-repo";
import { findScopedPlanet } from "@/server/db/planet-repo";
import { DomainError } from "@/server/domain-error";
import { restoreFamilyPlanet } from "@/server/services/planet.service";
import { restorePlanetSchema } from "@/server/validation/domain-schemas";
import { NextResponse } from "next/server";

type RestoreContext = {
  params: Promise<{ planetId: string }>;
};

export async function POST(request: Request, context: RestoreContext) {
  try {
    const session = await auth();
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ code: "UNAUTHENTICATED", message: "请先登录后再管理星球。" }, { status: 401 });
    }

    const scope = await resolvePersonalGalaxyScope(userId);
    const { planetId } = await context.params;
    const planet = await findScopedPlanet({ ...scope, planetId });

    if (!planet || !planet.deletedAt) {
      throw new DomainError("PLANET_NOT_FOUND", 404, "星球不存在或无权访问。");
    }

    const parsed = restorePlanetSchema.safeParse(await payloadWithVersion(request));

    if (!parsed.success) {
      throw invalidPayload();
    }

    const restored = await restoreFamilyPlanet(scope, planetId, parsed.data.version);
    return NextResponse.json(restored);
  } catch (error) {
    return restoreErrorResponse(error);
  }
}

async function payloadWithVersion(request: Request): Promise<unknown> {
  const text = await request.text();
  let body: unknown = {};

  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      throw invalidPayload();
    }
  }

  const header = request.headers.get("If-Match-Version");

  if (header === null) {
    return body;
  }

  if (!/^[1-9]\d*$/.test(header)) {
    throw invalidPayload();
  }

  const version = Number(header);

  if (!Number.isSafeInteger(version) || !isRecord(body) || (body.version !== undefined && body.version !== version)) {
    throw invalidPayload();
  }

  return { ...body, version };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidPayload() {
  return new DomainError("PLANET_INPUT_INVALID", 400, "星球请求格式不正确。");
}

function restoreErrorResponse(error: unknown) {
  if (error instanceof DomainError) {
    return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
  }

  return NextResponse.json({ code: "INTERNAL_ERROR", message: "请求无法完成，请稍后重试。" }, { status: 500 });
}
