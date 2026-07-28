import { createHash, randomUUID } from "node:crypto";

import { auth } from "@/auth";
import {
  claimFailedAssetForRetry,
  createAsset,
  findActiveAsset,
  updateAssetStatus,
} from "@/server/db/asset-repo";
import { resolvePersonalGalaxyScope } from "@/server/db/galaxy-repo";
import { findActivePlanet } from "@/server/db/planet-repo";
import { DomainError } from "@/server/domain-error";
import { validateAsset } from "@/server/media/asset-validation";
import {
  createDerivativeStorageKey,
  createStorageKey,
  writePrivateAsset,
} from "@/server/media/media-store";
import { idempotencyKeySchema } from "@/server/validation/domain-schemas";

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
type AssetDtoSource = {
  id: string;
  planetId: string;
  kind: string;
  visibility: string;
  mimeType: string;
  sizeBytes: number;
  originalName: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  createdAt: Date;
};
type ActiveAsset = NonNullable<Awaited<ReturnType<typeof findActiveAsset>>>;
type AssetReplayRequest = {
  planetId: string;
  kind: AssetKind;
  visibility: "private" | "family" | "selected";
  sha256: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
};
type KeyedAssetResolution =
  | { action: "create" }
  | { action: "replay"; asset: ActiveAsset & { status: "stored" | "ready" } }
  | { action: "retry"; asset: ActiveAsset & { status: "failed" } };

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

function toAssetDto(asset: AssetDtoSource, status: "stored" | "ready" | "failed") {
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

function readIdempotencyKey(request: Request) {
  const value = request.headers?.get("Idempotency-Key") ?? null;

  if (value === null) return undefined;

  const parsed = idempotencyKeySchema.safeParse(value);
  if (!parsed.success) {
    throw new DomainError("IDEMPOTENCY_KEY_INVALID", 400, "幂等键格式不正确。");
  }

  return parsed.data;
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function hasMatchingReplayFingerprint(
  asset: Awaited<ReturnType<typeof findActiveAsset>>,
  request: AssetReplayRequest,
): asset is ActiveAsset {
  return asset !== null
    && asset.planetId === request.planetId
    && asset.kind === request.kind
    && asset.visibility === request.visibility
    && asset.sha256 === request.sha256
    && asset.originalName === request.originalName
    && asset.mimeType === request.mimeType
    && asset.sizeBytes === request.sizeBytes;
}

function isMatchingReplayAsset(
  asset: Awaited<ReturnType<typeof findActiveAsset>>,
  request: AssetReplayRequest,
): asset is ActiveAsset & { status: "stored" | "ready" } {
  return hasMatchingReplayFingerprint(asset, request)
    && (asset.status === "stored" || asset.status === "ready");
}

function assetIdForIdempotencyKey(scope: { userId: string; galaxyId: string }, idempotencyKey: string) {
  return createHash("sha256")
    .update(`${scope.userId}\0${scope.galaxyId}\0${idempotencyKey}`)
    .digest("hex");
}

async function resolveKeyedAsset(input: {
  userId: string;
  galaxyId: string;
  assetId: string;
  replayRequest: AssetReplayRequest;
}): Promise<KeyedAssetResolution> {
  const existing = await findActiveAsset({
    userId: input.userId,
    galaxyId: input.galaxyId,
    assetId: input.assetId,
  });

  if (!existing) {
    return { action: "create" };
  }

  if (!hasMatchingReplayFingerprint(existing, input.replayRequest)) {
    throw new DomainError("ASSET_UPLOAD_RETRY_CONFLICT", 409, "上传请求冲突，请使用新的请求重试。");
  }

  if (isMatchingReplayAsset(existing, input.replayRequest)) {
    return { action: "replay", asset: existing };
  }

  if (existing.status === "processing") {
    throw new DomainError("ASSET_UPLOAD_RETRY_PENDING", 409, "上传请求尚未完成，请稍后使用原请求重试。");
  }

  if (existing.status !== "failed") {
    throw new DomainError("ASSET_UPLOAD_RETRY_CONFLICT", 409, "上传请求冲突，请使用新的请求重试。");
  }

  const failedAsset = { ...existing, status: "failed" as const };

  const claimed = await claimFailedAssetForRetry({
    userId: input.userId,
    galaxyId: input.galaxyId,
    assetId: input.assetId,
  });

  if (claimed) {
    return { action: "retry", asset: failedAsset };
  }

  const afterClaim = await findActiveAsset({
    userId: input.userId,
    galaxyId: input.galaxyId,
    assetId: input.assetId,
  });

  if (isMatchingReplayAsset(afterClaim, input.replayRequest)) {
    return { action: "replay", asset: afterClaim };
  }

  if (hasMatchingReplayFingerprint(afterClaim, input.replayRequest)) {
    throw new DomainError("ASSET_UPLOAD_RETRY_PENDING", 409, "上传请求尚未完成，请稍后使用原请求重试。");
  }

  throw new DomainError("ASSET_UPLOAD_RETRY_CONFLICT", 409, "上传请求冲突，请使用新的请求重试。");
}

async function uploadAsset(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ code: "UNAUTHENTICATED", message: "请先登录后再上传资源。" }, { status: 401 });
  }

  const idempotencyKey = readIdempotencyKey(request);
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

  const assetId = idempotencyKey
    ? assetIdForIdempotencyKey(scope, idempotencyKey)
    : randomUUID();
  const derivatives = imageDerivatives(validated);
  const metadata = validatedMetadata(validated);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  let storageKey = createStorageKey({
    userId: scope.userId,
    assetId,
    extension: validated.extension,
  });
  let normalizedStorageKey = derivatives
    ? createDerivativeStorageKey({
      userId: scope.userId,
      assetId,
      extension: validated.extension,
      variant: "normalized",
    })
    : undefined;
  let thumbnailStorageKey = derivatives
    ? createDerivativeStorageKey({
      userId: scope.userId,
      assetId,
      extension: "jpg",
      variant: "thumbnail",
    })
    : undefined;
  const replayRequest = {
    planetId,
    kind: validated.kind,
    visibility,
    sha256,
    originalName,
    mimeType: validated.trustedMime,
    sizeBytes: validated.sizeBytes,
  } satisfies AssetReplayRequest;
  const createNewAsset = () => createAsset({
      id: assetId,
      userId: scope.userId,
      galaxyId: scope.galaxyId,
      planetId,
      kind: validated.kind,
      visibility,
      storageKey,
      mimeType: validated.trustedMime,
      sizeBytes: validated.sizeBytes,
      sha256,
      originalName,
      width: metadata.width,
      height: metadata.height,
      durationMs: metadata.durationMs,
      extractedText: metadata.extractedText,
      normalizedStorageKey,
      thumbnailStorageKey,
      status: "processing",
    });
  let asset: Awaited<ReturnType<typeof createAsset>> | undefined;

  if (!idempotencyKey) {
    asset = await createNewAsset();
  } else {
    let resolution = await resolveKeyedAsset({
      userId: scope.userId,
      galaxyId: scope.galaxyId,
      assetId,
      replayRequest,
    });

    if (resolution.action === "replay") {
      return NextResponse.json(toAssetDto(resolution.asset, resolution.asset.status), { status: 201 });
    }

    if (resolution.action === "create") {
      try {
        asset = await createNewAsset();
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }

        resolution = await resolveKeyedAsset({
          userId: scope.userId,
          galaxyId: scope.galaxyId,
          assetId,
          replayRequest,
        });

        if (resolution.action === "create") {
          throw new DomainError("ASSET_UPLOAD_RETRY_CONFLICT", 409, "上传请求冲突，请使用新的请求重试。");
        }

        if (resolution.action === "replay") {
          return NextResponse.json(toAssetDto(resolution.asset, resolution.asset.status), { status: 201 });
        }
      }
    }

    if (resolution.action === "retry") {
      asset = resolution.asset;
      storageKey = resolution.asset.storageKey;
      normalizedStorageKey = resolution.asset.normalizedStorageKey ?? undefined;
      thumbnailStorageKey = resolution.asset.thumbnailStorageKey ?? undefined;
    }
  }

  if (!asset) {
    throw new DomainError("ASSET_UPLOAD_RETRY_CONFLICT", 409, "上传请求冲突，请使用新的请求重试。");
  }

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
