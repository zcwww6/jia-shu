export type LegacyAssetKind = "audio" | "document" | "image" | "planet_cover";
export type LegacyAssetVisibility = "private" | "family" | "selected";

export type LegacyAsset = {
  id: string;
  planetId: string;
  kind: LegacyAssetKind;
  visibility: LegacyAssetVisibility;
  mimeType: string;
  sizeBytes: number;
  originalName: string;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  status: "stored" | "failed" | string;
  createdAt: string;
};

export type UploadLegacyAssetInput = {
  file: File;
  planetId: string;
  kind: LegacyAssetKind;
  visibility: LegacyAssetVisibility;
  idempotencyKey?: string;
  signal?: AbortSignal;
};

export async function uploadLegacyAsset(input: UploadLegacyAssetInput): Promise<LegacyAsset> {
  const body = new FormData();
  body.set("file", input.file);
  body.set("planetId", input.planetId);
  body.set("kind", input.kind);
  body.set("visibility", input.visibility);

  const response = await fetch("/api/assets", {
    method: "POST",
    ...(input.idempotencyKey ? { headers: { "Idempotency-Key": input.idempotencyKey } } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
    body,
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      typeof payload?.message === "string" ? payload.message : "上传失败，请稍后重试。",
    );
  }

  return payload as LegacyAsset;
}
