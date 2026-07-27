import { createHash } from "node:crypto";

export const TEXT_EXTRACTION_PURPOSE = "memory_extraction" as const;

/**
 * Stable replay identity for the HTTP request. Consent for a newly submitted
 * request is represented explicitly so later Memory edits cannot rewrite the
 * separate snapshot hash retained on the created job.
 */
export function textExtractionIdempotencyRequestHash(input: {
  memoryId: string;
  purpose: typeof TEXT_EXTRACTION_PURPOSE;
}) {
  return createHash("sha256")
    .update(JSON.stringify({
      memoryId: input.memoryId,
      consent: true,
      purpose: input.purpose,
    }))
    .digest("hex");
}

export function textExtractionRequestHash(input: {
  memoryId: string;
  sourceText: string;
  version: number;
  purpose: typeof TEXT_EXTRACTION_PURPOSE;
}) {
  return createHash("sha256")
    .update(JSON.stringify({
      memoryId: input.memoryId,
      sourceText: input.sourceText,
      version: input.version,
      purpose: input.purpose,
    }))
    .digest("hex");
}
