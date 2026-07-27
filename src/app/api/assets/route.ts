import { createHash, randomUUID } from "node:crypto";

import { auth } from "@/auth";
import { createAsset, updateAssetStatus } from "@/server/db/asset-repo";
import { resolvePersonalGalaxyScope } from "@/server/db/galaxy-repo";
import { findActivePlanet } from "@/server/db/planet-repo";
import { DomainError } from "@/server/domain-error";
import { validateAsset } from "@/server/media/asset-validation";
import {
  createDerivativeStorageKey,
  createStorageKey,
  writePrivateAsset,
} from "@/server/media/media-store";

import { NextResponse } from "next/server";
import { z } from "zod";

type AssetKind = "image" | "audio" | "document" | "planet_cover";
type ValidatedMetadata = {
  width?: number;
  height?: number;
  durationMs?: number;
  extractedText?: string;
};
type ValidatedImageDerivatives = {
  normalizedBytes: Uint8Array;
  thumbnailBytes: Uint8Array;
};
type ValidatedAsset = {
  trustedMime: string;
  extension: string;
  kind: AssetKind;
  sizeBytes: number;
  metadata?: ValidatedMetadata;
  derivatives?: Partial<ValidatedImageDerivatives>;
};

const multipartAssetSchema = z.object({
  planetId: z.string().cuid(),
  kind: z.enum(["image", "audio", "document", "planet_cover"]),
  visibility: z.enum(["private", "family", "selected"]).default("private"),
  originalName: z.string().trim().min(1).max(255),
}).strict();

function imageDerivatives(value: ValidatedAsset): ValidatedImageDerivatives | undefined {
  const derivatives = value.derivatives;

  if (derivatives?.normalizedBytes && derivatives.thumbnailBytes) {
    return {
      normalizedBytes: derivatives.normalizedBytes,
      thumbnailBytes: derivatives.thumbnailBytes,
    };
  }

  return undefined;
}

function validatedMetadata(value: ValidatedAsset): ValidatedMetadata {
  return value.metadata ?? {};
}

function toAssetDto(asset: Awaited<ReturnType<typeof createAsset>>, status: "stored" | "failed") {
  return {
    id: asset.id,
    planetId: asset.planetId,
    kind: asset.kind,
    visibility: asset.visibility,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    originalName: asset.originalName,
    width: asset.width,
    height: asset.height,
    durationMs: asset.durationMs,
    status,
    createdAt: asset.createdAt.toISOString(),
  };
}

async function uploadAsset(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ code: "UNAUTHENTICATED", message: "请先登录后再上传资源。" }, { status: 401 });
  }

  const scope = await resolvePersonalGalaxyScope(userId);
  let form: FormData;

  try {
    form = await request.formData();
  } catch {
    throw new DomainError("ASSET_UPLOAD_INVALID", 400, "上传内容格式不正确。");
  }

  const file = form.get("file");

  if (!file || typeof file === "string") {
    throw new DomainError("ASSET_UPLOAD_INVALID", 400, "上传内容格式不正确。");
  }

  const multipart = multipartAssetSchema.safeParse({
    planetId: form.get("planetId"),
    kind: form.get("kind"),
    visibility: form.get("visibility") ?? undefined,
    originalName: file.name,
  });

  if (!multipart.success) {
    throw new DomainError("ASSET_UPLOAD_INVALID", 400, "上传内容格式不正确。");
  }

  const { planetId, kind, visibility, originalName } = multipart.data;
  const bytes = new Uint8Array(await file.arrayBuffer());

  if (bytes.byteLength === 0) {
    throw new DomainError("ASSET_UPLOAD_INVALID", 400, "上传内容格式不正确。");
  }

  const planet = await findActivePlanet({
    userId: scope.userId,
    galaxyId: scope.galaxyId,
    planetId,
  });

  if (!planet) {
    return NextResponse.json({ code: "ASSET_PLANET_NOT_FOUND", message: "星球不存在或无权访问。" }, { status: 404 });
  }

  const validated = await validateAsset({
    declaredMime: file.type,
    bytes,
    originalName,
    kind,
  }) as ValidatedAsset;

  if (validated.sizeBytes <= 0) {
    throw new DomainError("ASSET_UPLOAD_INVALID", 400, "上传内容格式不正确。");
  }

  const assetId = randomUUID();
  const derivatives = imageDerivatives(validated);
  const metadata = validatedMetadata(validated);
  const storageKey = createStorageKey({
    userId: scope.userId,
    assetId,
    extension: validated.extension,
  });
  const normalizedStorageKey = derivatives
    ? createDerivativeStorageKey({
      userId: scope.userId,
      assetId,
      extension: validated.extension,
      variant: "normalized",
    })
    : undefined;
  const thumbnailStorageKey = derivatives
    ? createDerivativeStorageKey({
      userId: scope.userId,
      assetId,
      extension: "jpg",
      variant: "thumbnail",
    })
    : undefined;
  const asset = await createAsset({
    id: assetId,
    userId: scope.userId,
    galaxyId: scope.galaxyId,
    planetId,
    kind: validated.kind,
    visibility,
    storageKey,
    mimeType: validated.trustedMime,
    sizeBytes: validated.sizeBytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    originalName,
    width: metadata.width,
    height: metadata.height,
    durationMs: metadata.durationMs,
    extractedText: metadata.extractedText,
    normalizedStorageKey,
    thumbnailStorageKey,
    status: "processing",
  });

  try {
    await writePrivateAsset(storageKey, bytes);

    if (derivatives && normalizedStorageKey && thumbnailStorageKey) {
      await writePrivateAsset(normalizedStorageKey, derivatives.normalizedBytes);
      await writePrivateAsset(thumbnailStorageKey, derivatives.thumbnailBytes);
    }

    await updateAssetStatus({
      userId: scope.userId,
      galaxyId: scope.galaxyId,
      assetId,
      status: "stored",
    });
  } catch {
    try {
      await updateAssetStatus({
        userId: scope.userId,
        galaxyId: scope.galaxyId,
        assetId,
        status: "failed",
      });
    } catch {
      // A secondary status failure must not disclose storage details.
    }

    throw new DomainError("ASSET_STORAGE_FAILED", 500, "资源保存失败，请稍后重试。");
  }

  return NextResponse.json(toAssetDto(asset, "stored"), { status: 201 });
}

export async function POST(request: Request) {
  try {
    return await uploadAsset(request);
  } catch (error) {
    if (error instanceof DomainError) {
      return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
    }

    return NextResponse.json({ code: "INTERNAL_ERROR", message: "请求无法完成，请稍后重试。" }, { status: 500 });
  }
}
