import { auth } from "@/auth";
import { resolvePersonalGalaxyScope } from "@/server/db/galaxy-repo";
import { findActivePlanet } from "@/server/db/planet-repo";
import { DomainError } from "@/server/domain-error";
import { archiveFamilyPlanet, updateFamilyPlanet } from "@/server/services/planet.service";
import { restorePlanetSchema, updatePlanetSchema } from "@/server/validation/domain-schemas";
import { NextResponse } from "next/server";

type PlanetContext = {
  params: Promise<{ planetId: string }>;
};

export async function PATCH(request: Request, context: PlanetContext) {
  try {
    const scoped = await requireActiveScopedPlanet(context);
    const parsed = updatePlanetSchema.safeParse(await payloadWithVersion(request));

    if (!parsed.success) {
      throw invalidPayload();
    }

    const updated = await updateFamilyPlanet(scoped.scope, scoped.planetId, parsed.data);
    return NextResponse.json(updated);
  } catch (error) {
    return planetErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: PlanetContext) {
  try {
    const scoped = await requireActiveScopedPlanet(context);
    const parsed = restorePlanetSchema.safeParse(await payloadWithVersion(request));

    if (!parsed.success) {
      throw invalidPayload();
    }

    const archived = await archiveFamilyPlanet(scoped.scope, scoped.planetId, parsed.data.version);
    return NextResponse.json(archived);
  } catch (error) {
    return planetErrorResponse(error);
  }
}

async function requireActiveScopedPlanet(context: PlanetContext) {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    throw new DomainError("UNAUTHENTICATED", 401, "请先登录后再管理星球。");
  }

  const scope = await resolvePersonalGalaxyScope(userId);
  const { planetId } = await context.params;
  const planet = await findActivePlanet({ ...scope, planetId });

  if (!planet) {
    throw new DomainError("PLANET_NOT_FOUND", 404, "星球不存在或无权访问。");
  }

  return { scope, planetId };
}

async function payloadWithVersion(request: Request): Promise<unknown> {
  const body = await readBody(request);
  const headerVersion = readIfMatchVersion(request);

  if (headerVersion === undefined) {
    return body;
  }

  if (!isRecord(body) || (body.version !== undefined && body.version !== headerVersion)) {
    throw invalidPayload();
  }

  return { ...body, version: headerVersion };
}

async function readBody(request: Request): Promise<unknown> {
  const text = await request.text();

  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    throw invalidPayload();
  }
}

function readIfMatchVersion(request: Request) {
  const value = request.headers.get("If-Match-Version");

  if (value === null) {
    return undefined;
  }

  if (!/^[1-9]\d*$/.test(value)) {
    throw invalidPayload();
  }

  const version = Number(value);

  if (!Number.isSafeInteger(version)) {
    throw invalidPayload();
  }

  return version;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidPayload() {
  return new DomainError("PLANET_INPUT_INVALID", 400, "星球请求格式不正确。");
}

function planetErrorResponse(error: unknown) {
  if (error instanceof DomainError) {
    return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
  }

  return NextResponse.json({ code: "INTERNAL_ERROR", message: "请求无法完成，请稍后重试。" }, { status: 500 });
}
