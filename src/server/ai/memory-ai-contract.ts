import { createHash } from "node:crypto";

import { DomainError } from "@/server/domain-error";

export const MEMORY_EXTRACTION_PURPOSE = "memory_extraction" as const;

export type MemoryAiSourceKind = "text" | "image" | "audio" | "document";
export type MemoryAiPipelineKind =
  | "text_extraction"
  | "image_extraction"
  | "audio_transcription"
  | "document_extraction";

export type MemoryAiSourceAsset = {
  id: string;
  kind: "text" | "image" | "audio" | "document" | "planet_cover";
  sha256: string;
  visibility: "private" | "family" | "selected";
};

export function deriveMemoryAiSource(input: {
  sourceText: string;
  visibility: "private" | "family" | "selected";
  assets: readonly MemoryAiSourceAsset[];
}): { sourceKind: MemoryAiSourceKind; jobKind: MemoryAiPipelineKind } {
  if (input.assets.some((asset) => asset.visibility !== input.visibility)) {
    throw new DomainError("MEMORY_ASSET_VISIBILITY_INVALID", 422, "素材可见范围必须与记忆一致。");
  }

  const nonTextAssets = input.assets.filter((asset) => asset.kind !== "text");

  if (nonTextAssets.length === 0) {
    if (!input.sourceText.trim()) {
      throw new DomainError("MEMORY_SOURCE_REQUIRED", 422, "请提供文字或已存储的素材。");
    }

    return { sourceKind: "text", jobKind: "text_extraction" };
  }

  const sourceKind = nonTextAssets[0]?.kind;

  if (
    !sourceKind
    || sourceKind === "planet_cover"
    || nonTextAssets.some((asset) => asset.kind !== sourceKind)
    || input.assets.some((asset) => asset.kind === "text")
  ) {
    throw new DomainError("MEMORY_ASSET_SOURCE_INVALID", 422, "同一条记忆只能使用一种受支持的素材类型。");
  }

  switch (sourceKind) {
    case "image":
      return { sourceKind, jobKind: "image_extraction" };
    case "audio":
      return { sourceKind, jobKind: "audio_transcription" };
    case "document":
      return { sourceKind, jobKind: "document_extraction" };
    default:
      throw new DomainError("MEMORY_ASSET_SOURCE_INVALID", 422, "同一条记忆只能使用一种受支持的素材类型。");
  }
}

export function memoryAiIdempotencyRequestHash(input: {
  memoryId: string;
  purpose: typeof MEMORY_EXTRACTION_PURPOSE;
}) {
  return createHash("sha256")
    .update(JSON.stringify({
      memoryId: input.memoryId,
      consent: true,
      purpose: input.purpose,
    }))
    .digest("hex");
}

/**
 * The database keeps this digest, never the source text or assembled provider
 * prompt. IDs are ordered here to avoid accidental hash drift from database
 * result order.
 */
export function memoryAiSnapshotHash(input: {
  memoryId: string;
  sourceText: string;
  version: number;
  purpose: typeof MEMORY_EXTRACTION_PURPOSE;
  assets: readonly MemoryAiSourceAsset[];
}) {
  const assets = [...input.assets]
    .map(({ id, kind, sha256 }) => ({ id, kind, sha256 }))
    .sort((left, right) => left.id.localeCompare(right.id));

  return createHash("sha256")
    .update(JSON.stringify({
      memoryId: input.memoryId,
      sourceText: input.sourceText,
      version: input.version,
      purpose: input.purpose,
      assets,
    }))
    .digest("hex");
}
