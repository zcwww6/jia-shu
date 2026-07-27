import { describe, expect, it } from "vitest";

import {
  confirmMemorySchema,
  createAssetSchema,
  createBookSchema,
  createMemorySchema,
  createPlanetRelationshipSchema,
  createPlanetSchema,
  createResonanceSchema,
  createShareSchema,
  idempotencyKeySchema,
  optimisticVersionSchema,
  restorePlanetSchema,
  scanResonanceSchema,
  updateBookSchema,
  updateMemoryDraftSchema,
  updatePlanetSchema,
  updateResonanceSchema,
} from "./domain-schemas";

const planetId = "ck8m3x8xy000000000000000";
const memoryId = "ck8m3x8xy000000000000001";

describe("domain schemas", () => {
  it("trims and accepts a bounded raw memory create payload", () => {
    const result = createMemorySchema.parse({
      planetId,
      sourceText: "  一段需要被记住的内容  ",
      visibility: "family",
    });

    expect(result.sourceText).toBe("一段需要被记住的内容");
    expect(result.visibility).toBe("family");
  });

  it("requires a cuid planet id and a nonblank source text up to 20000 characters", () => {
    expect(createMemorySchema.safeParse({ planetId: "planet-1", sourceText: "内容", visibility: "private" }).success).toBe(false);
    expect(createMemorySchema.safeParse({ planetId, sourceText: "   ", visibility: "private" }).success).toBe(false);
    expect(createMemorySchema.safeParse({ planetId, sourceText: "a".repeat(20_001), visibility: "private" }).success).toBe(false);
  });

  it("accepts an optional text context with unique stored asset identifiers but requires at least one source", () => {
    const imageAssetId = "e4c4ac66-3c6a-4c65-9d2a-d3b25e45be36";

    const assetOnly = createMemorySchema.parse({
      planetId,
      assetIds: [imageAssetId],
      visibility: "private",
    });
    expect(assetOnly.assetIds).toEqual([imageAssetId]);
    expect(assetOnly.sourceText).toBeUndefined();
    expect(createMemorySchema.parse({
      planetId,
      sourceText: "  照片拍摄在搬家那天。  ",
      assetIds: [imageAssetId],
    })).toMatchObject({
      sourceText: "照片拍摄在搬家那天。",
      assetIds: [imageAssetId],
    });
    expect(createMemorySchema.safeParse({ planetId, assetIds: [] }).success).toBe(false);
    expect(createMemorySchema.safeParse({ planetId, assetIds: [imageAssetId, imageAssetId] }).success).toBe(false);
  });

  it("rejects public visibility for raw memory and asset payloads", () => {
    expect(createMemorySchema.safeParse({ planetId, sourceText: "内容", visibility: "public" }).success).toBe(false);
    expect(
      createAssetSchema.safeParse({
        planetId,
        kind: "image",
        visibility: "public",
        storageKey: "opaque/object-key",
        mimeType: "image/jpeg",
        sizeBytes: 1024,
        sha256: "a".repeat(64),
        originalName: "family.jpg",
      }).success,
    ).toBe(false);
  });

  it("requires positive integer optimistic versions", () => {
    expect(optimisticVersionSchema.safeParse({ version: 1 }).success).toBe(true);
    expect(optimisticVersionSchema.safeParse({ version: 0 }).success).toBe(false);
    expect(optimisticVersionSchema.safeParse({ version: 1.5 }).success).toBe(false);
  });

  it("rejects version-only mutable patches while allowing version-only confirmation", () => {
    expect(updateMemoryDraftSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(updatePlanetSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(updateBookSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(updateMemoryDraftSchema.safeParse({ version: 1, title: "草稿" }).success).toBe(true);
    expect(updatePlanetSchema.safeParse({ version: 1, name: "新星球" }).success).toBe(true);
    expect(updateBookSchema.safeParse({ version: 1, title: "新家书" }).success).toBe(true);
    expect(confirmMemorySchema.safeParse({ version: 1 }).success).toBe(true);
  });

  it("allows a user-confirmed occurred label but never a browser-supplied memory status", () => {
    expect(confirmMemorySchema.parse({
      version: 2,
      title: "新家的晚上",
      summary: "全家第一次在新家吃晚饭。",
      tags: ["新家", "晚饭"],
      occurredAtLabel: "2018 年夏天",
    })).toMatchObject({ occurredAtLabel: "2018 年夏天" });
    expect(confirmMemorySchema.safeParse({ version: 2, status: "confirmed" }).success).toBe(false);
  });

  it("normalizes explicit location and people fields for draft edits and administrator confirmation", () => {
    const draft = updateMemoryDraftSchema.parse({
      version: 2,
      locationLabel: "  老家厨房  ",
      people: ["  妈妈 ", "外婆", "妈妈"],
    });
    const confirmation = confirmMemorySchema.parse({
      version: 3,
      locationLabel: "  老家厨房  ",
      people: ["  妈妈 ", "外婆", "妈妈"],
    });

    expect(draft).toMatchObject({ locationLabel: "老家厨房", people: ["妈妈", "外婆"] });
    expect(confirmation).toMatchObject({ locationLabel: "老家厨房", people: ["妈妈", "外婆"] });
    expect(updateMemoryDraftSchema.safeParse({ version: 2, people: null }).success).toBe(false);
    expect(confirmMemorySchema.safeParse({ version: 3, people: null }).success).toBe(false);
  });

  it("accepts a persisted family planet but never a memorial Planet.type", () => {
    expect(createPlanetSchema.parse({ name: "妈妈", type: "parent" })).toMatchObject({
      name: "妈妈",
      type: "parent",
      lifeState: "active",
      visibility: "private",
    });
    expect(createPlanetSchema.safeParse({ name: "纪念星", type: "memorial" }).success).toBe(false);
    expect(updatePlanetSchema.safeParse({ version: 1, type: "memorial" }).success).toBe(false);
  });

  it("accepts explicit lifecycle, cover, and position updates while keeping optimistic locking", () => {
    expect(updatePlanetSchema.parse({
      version: 2,
      lifeState: "memorial",
      coverAssetId: memoryId,
      position: { x: 13, y: 27 },
    })).toMatchObject({
      version: 2,
      lifeState: "memorial",
      coverAssetId: memoryId,
      position: { x: 13, y: 27 },
    });
    expect(restorePlanetSchema.safeParse({ version: 2 }).success).toBe(true);
  });

  it("accepts a Task4 UUID asset id when assigning a planet cover", () => {
    expect(updatePlanetSchema.safeParse({
      version: 2,
      coverAssetId: "e4c4ac66-3c6a-4c65-9d2a-d3b25e45be36",
    }).success).toBe(true);
  });

  it("allows only real relationship payload fields and known relationship kinds", () => {
    expect(createPlanetRelationshipSchema.parse({
      targetPlanetId: memoryId,
      relationshipType: "partner",
      visibility: "family",
      label: "伴侣",
    })).toMatchObject({ relationshipType: "partner", visibility: "family" });
    expect(createPlanetRelationshipSchema.safeParse({
      targetPlanetId: memoryId,
      relationshipType: "resonance",
    }).success).toBe(false);
    expect(createPlanetRelationshipSchema.safeParse({
      targetPlanetId: memoryId,
      relationshipType: "parent",
      rule: "sharedMemory",
    }).success).toBe(false);
  });

  it("accepts only printable nonblank ASCII idempotency keys between 16 and 128 characters", () => {
    expect(idempotencyKeySchema.safeParse("abcdefghijklmnop").success).toBe(true);
    expect(idempotencyKeySchema.safeParse("short-key").success).toBe(false);
    expect(idempotencyKeySchema.safeParse("a".repeat(129)).success).toBe(false);
    expect(idempotencyKeySchema.safeParse("abcdefghijklmno ").success).toBe(false);
    expect(idempotencyKeySchema.safeParse("abcdefghijklmn中").success).toBe(false);
  });

  it("accepts only a strict resonance scan source id", () => {
    expect(scanResonanceSchema.parse({ memoryId })).toEqual({ memoryId });
    expect(scanResonanceSchema.safeParse({ memoryId: "memory-1" }).success).toBe(false);
    expect(scanResonanceSchema.safeParse({ memoryId, sourceText: "不应由浏览器提供" }).success).toBe(false);
  });

  it("accepts only source identifiers and generation settings when creating a book", () => {
    const payload = {
      sourceMemoryIds: [memoryId],
      sourceRange: "single_planet",
      themeTemplateKey: "family_reunion",
      visibility: "family" as const,
    };

    expect(createBookSchema.parse(payload)).toEqual(payload);
    expect(createBookSchema.safeParse({ ...payload, sourceMemoryIds: [] }).success).toBe(false);
    expect(createBookSchema.safeParse({ ...payload, sourceMemoryIds: [memoryId, memoryId] }).success).toBe(false);
    expect(createBookSchema.safeParse({ ...payload, sourceMemoryIds: ["memory-1"] }).success).toBe(false);
    expect(createBookSchema.safeParse({ ...payload, sourceRange: "unbounded" }).success).toBe(false);
    expect(createBookSchema.safeParse({ ...payload, draft: { title: "浏览器不能断言草稿" } }).success).toBe(false);
    expect(createBookSchema.safeParse({ ...payload, sections: [] }).success).toBe(false);
    expect(createBookSchema.safeParse({ ...payload, body: "浏览器不能提交正文" }).success).toBe(false);
  });

  it("makes all mutation payload objects strict", () => {
    const payloads = [
      [updateMemoryDraftSchema, { version: 1, title: "草稿" }],
      [createAssetSchema, { planetId, kind: "document", visibility: "private", storageKey: "opaque/doc", mimeType: "application/pdf", sizeBytes: 1, sha256: "a".repeat(64), originalName: "memo.pdf" }],
      [updatePlanetSchema, { version: 1, name: "新星球" }],
      [confirmMemorySchema, { version: 1 }],
      [createResonanceSchema, { sourceMemoryId: memoryId, targetMemoryId: planetId, score: 0.8, reason: "相似片段" }],
      [updateResonanceSchema, { version: 1, status: "confirmed" }],
      [createBookSchema, { sourceMemoryIds: [memoryId], sourceRange: "single_planet", themeTemplateKey: "family_reunion" }],
      [updateBookSchema, { version: 1, title: "新家书", body: "手工修订后的家书正文。" }],
      [createShareSchema, { showBody: true, showSourceTitles: false, showOriginalText: false }],
    ] as const;

    for (const [schema, payload] of payloads) {
      expect(schema.safeParse({ ...payload, unexpected: true }).success).toBe(false);
    }
  });
});
