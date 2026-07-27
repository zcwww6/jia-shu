import { describe, expect, it } from "vitest";

import {
  deriveMemoryAiSource,
  memoryAiSnapshotHash,
} from "./memory-ai-contract";

const assetFor = (kind: "image" | "audio" | "document") => ({
  id: `asset-${kind}`,
  kind,
  sha256: `${kind}-hash`,
  visibility: "private" as const,
});

describe("memory AI source contract", () => {
  it.each([
    { label: "text", sourceText: "妈妈在除夕包饺子。", assets: [], sourceKind: "text", jobKind: "text_extraction" },
    { label: "image", sourceText: "", assets: [assetFor("image")], sourceKind: "image", jobKind: "image_extraction" },
    { label: "audio", sourceText: "", assets: [assetFor("audio")], sourceKind: "audio", jobKind: "audio_transcription" },
    { label: "document", sourceText: "", assets: [assetFor("document")], sourceKind: "document", jobKind: "document_extraction" },
  ] as const)("maps $label to its persisted source pipeline", ({ sourceText, assets, sourceKind, jobKind }) => {
    expect(deriveMemoryAiSource({ sourceText, visibility: "private", assets })).toEqual({ sourceKind, jobKind });
  });

  it("allows optional user context alongside one non-text source", () => {
    expect(deriveMemoryAiSource({
      sourceText: "照片拍摄在搬家那天。",
      visibility: "private",
      assets: [assetFor("image")],
    })).toEqual({ sourceKind: "image", jobKind: "image_extraction" });
  });

  it("rejects mixed, cover, or visibility-expanded source assets", () => {
    expect(() => deriveMemoryAiSource({
      sourceText: "",
      visibility: "private",
      assets: [assetFor("image"), assetFor("audio")],
    })).toThrow(expect.objectContaining({ code: "MEMORY_ASSET_SOURCE_INVALID", status: 422 }));
    expect(() => deriveMemoryAiSource({
      sourceText: "",
      visibility: "private",
      assets: [{ ...assetFor("image"), kind: "planet_cover" }],
    })).toThrow(expect.objectContaining({ code: "MEMORY_ASSET_SOURCE_INVALID", status: 422 }));
    expect(() => deriveMemoryAiSource({
      sourceText: "",
      visibility: "family",
      assets: [assetFor("image")],
    })).toThrow(expect.objectContaining({ code: "MEMORY_ASSET_VISIBILITY_INVALID", status: 422 }));
  });

  it("stores only a deterministic hash for the consent snapshot", () => {
    const input = {
      memoryId: "memory-1",
      sourceText: "仅在哈希计算中使用的家庭私密文字。",
      version: 4,
      purpose: "memory_extraction" as const,
      assets: [assetFor("image")],
    };
    const first = memoryAiSnapshotHash(input);
    const reordered = memoryAiSnapshotHash({ ...input, assets: [...input.assets].reverse() });
    const changedAsset = memoryAiSnapshotHash({
      ...input,
      assets: [{ ...assetFor("image"), sha256: "changed-hash" }],
    });
    const changedSourceText = memoryAiSnapshotHash({
      ...input,
      sourceText: "照片拍摄在搬家后的第二天。",
    });

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).toBe(reordered);
    expect(first).not.toBe(changedAsset);
    expect(first).not.toBe(changedSourceText);
    expect(first).not.toContain(input.sourceText);
  });
});
