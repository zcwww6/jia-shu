import { z } from "zod";

const cuidSchema = z.string().cuid();
// Idempotent uploads derive their stable asset ID from a SHA-256 digest. The
// API still scopes every accepted identifier to the authenticated galaxy, so
// accepting that opaque identifier here cannot grant cross-family access.
const assetIdentifierSchema = z.union([
  cuidSchema,
  z.string().uuid(),
  z.string().regex(/^[a-fA-F0-9]{64}$/),
]);
const boundedTextSchema = z.string().trim().min(1).max(20_000);
const optionalBoundedTextSchema = z.string().trim().max(20_000).optional();
const shortTextSchema = z.string().trim().min(1).max(200);
const optionalShortTextSchema = shortTextSchema.optional();
const optionalLocationLabelSchema = shortTextSchema.nullable().optional();
const peopleSchema = z.array(shortTextSchema).max(50).transform((people) => [...new Set(people)]);
const optionalPeopleSchema = peopleSchema.optional();
const persistedPlanetTypeSchema = z.enum(["self", "parent", "child", "public", "partner", "other"]);
const planetLifeStateSchema = z.enum(["active", "memorial"]);
const planetPositionSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
}).strict();

function hasMutablePatch(value: object) {
  return Object.entries(value).some(([key, fieldValue]) => key !== "version" && fieldValue !== undefined);
}

export const contentVisibilitySchema = z.enum(["private", "family", "selected"]);
export const planetVisibilitySchema = z.enum(["private", "family", "selected", "public"]);
export const optimisticVersionSchema = z.object({
  version: z.number().int().positive(),
}).strict();

export const idempotencyKeySchema = z.string().regex(/^[\x21-\x7E]{16,128}$/);

export const createMemorySchema = z.object({
  planetId: cuidSchema,
  sourceText: optionalBoundedTextSchema,
  assetIds: z.array(assetIdentifierSchema).max(20).default([]),
  title: optionalShortTextSchema,
  visibility: contentVisibilitySchema.default("private"),
  allowResonance: z.boolean().optional(),
  allowBook: z.boolean().optional(),
  occurredAtLabel: z.string().trim().min(1).max(200).optional(),
}).strict().superRefine((value, context) => {
  if (!value.sourceText && value.assetIds.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["sourceText"],
      message: "请提供文字或素材。",
    });
  }

  if (new Set(value.assetIds).size !== value.assetIds.length) {
    context.addIssue({
      code: "custom",
      path: ["assetIds"],
      message: "素材不能重复。",
    });
  }
});

export const updateMemoryDraftSchema = optimisticVersionSchema.extend({
  sourceText: boundedTextSchema.optional(),
  title: optionalShortTextSchema,
  summary: z.string().trim().min(1).max(20_000).optional(),
  tags: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  visibility: contentVisibilitySchema.optional(),
  allowResonance: z.boolean().optional(),
  allowBook: z.boolean().optional(),
  occurredAtLabel: z.string().trim().min(1).max(200).nullable().optional(),
  locationLabel: optionalLocationLabelSchema,
  people: optionalPeopleSchema,
}).strict().refine(hasMutablePatch, {
  message: "至少需要提供一个可更新字段。",
});

export const createAssetSchema = z.object({
  planetId: cuidSchema,
  memoryId: cuidSchema.optional(),
  kind: z.enum(["text", "image", "audio", "document", "planet_cover"]),
  visibility: contentVisibilitySchema.default("private"),
  storageKey: z.string().trim().min(1).max(512),
  mimeType: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
  originalName: z.string().trim().min(1).max(255),
}).strict();

export const createPlanetSchema = z.object({
  name: shortTextSchema,
  type: persistedPlanetTypeSchema.default("other"),
  lifeState: planetLifeStateSchema.default("active"),
  visibility: planetVisibilitySchema.default("private"),
  role: z.string().trim().min(1).max(200).nullable().optional(),
  theme: z.string().trim().min(1).max(200).nullable().optional(),
  summary: z.string().trim().min(1).max(2_000).nullable().optional(),
  position: planetPositionSchema.optional(),
}).strict();

export const updatePlanetSchema = optimisticVersionSchema.extend({
  name: shortTextSchema.optional(),
  type: persistedPlanetTypeSchema.optional(),
  lifeState: planetLifeStateSchema.optional(),
  visibility: planetVisibilitySchema.optional(),
  role: z.string().trim().min(1).max(200).nullable().optional(),
  theme: z.string().trim().min(1).max(200).nullable().optional(),
  summary: z.string().trim().min(1).max(2_000).nullable().optional(),
  positionX: z.number().int().optional(),
  positionY: z.number().int().optional(),
  position: planetPositionSchema.optional(),
  coverAssetId: assetIdentifierSchema.nullable().optional(),
}).strict().superRefine((value, context) => {
  if (value.position && (value.positionX !== undefined || value.positionY !== undefined)) {
    context.addIssue({
      code: "custom",
      message: "position 不能与 positionX 或 positionY 同时提供。",
      path: ["position"],
    });
  }
}).refine(hasMutablePatch, {
  message: "至少需要提供一个可更新字段。",
});

export const restorePlanetSchema = optimisticVersionSchema;

export const createPlanetRelationshipSchema = z.object({
  targetPlanetId: cuidSchema,
  relationshipType: z.enum(["self", "parent", "child", "partner", "ancestor", "other"]),
  label: z.string().trim().min(1).max(200).nullable().optional(),
  visibility: contentVisibilitySchema.default("private"),
}).strict();

export const confirmMemorySchema = optimisticVersionSchema.extend({
  title: optionalShortTextSchema,
  summary: z.string().trim().min(1).max(20_000).optional(),
  tags: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  occurredAtLabel: z.string().trim().min(1).max(200).optional(),
  locationLabel: optionalLocationLabelSchema,
  people: optionalPeopleSchema,
}).strict();

export const createResonanceSchema = z.object({
  sourceMemoryId: cuidSchema,
  targetMemoryId: cuidSchema,
  score: z.number().min(0).max(1),
  reason: z.string().trim().min(1).max(2_000),
}).strict();

export const scanResonanceSchema = z.object({
  memoryId: cuidSchema,
}).strict();

export const updateResonanceSchema = optimisticVersionSchema.extend({
  status: z.enum(["confirmed", "rejected"]),
}).strict();

export const createBookSchema = z.object({
  title: optionalShortTextSchema,
  sourceMemoryIds: z.array(cuidSchema).min(1).max(100).refine(
    (ids) => new Set(ids).size === ids.length,
    "家书来源记忆不能重复。",
  ),
  sourceRange: z.enum(["single_planet", "binary_system", "family_galaxy", "memorial"]),
  themeTemplateKey: z.string().trim().min(1).max(200),
  visibility: contentVisibilitySchema.default("private"),
}).strict();

export const updateBookSchema = optimisticVersionSchema.extend({
  title: optionalShortTextSchema,
  body: z.string().trim().min(1).max(50_000).optional(),
  sourceRange: z.string().trim().min(1).max(200).nullable().optional(),
  themeTemplateKey: z.string().trim().min(1).max(200).nullable().optional(),
  visibility: contentVisibilitySchema.optional(),
}).strict().refine(hasMutablePatch, {
  message: "至少需要提供一个可更新字段。",
});

export const createShareSchema = z.object({
  showBody: z.boolean(),
  showSourceTitles: z.boolean(),
  showOriginalText: z.boolean(),
}).strict();

export const reviewBookSpreadSchema = optimisticVersionSchema.extend({
  pageIndex: z.number().int().min(0).max(41),
}).strict();

export type MemoryDraftPatch = Omit<z.infer<typeof updateMemoryDraftSchema>, "version">;
export type MemoryConfirmationPatch = Omit<z.infer<typeof confirmMemorySchema>, "version">;
