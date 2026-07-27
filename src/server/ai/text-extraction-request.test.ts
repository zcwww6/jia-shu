import { describe, expect, it } from "vitest";

import {
  TEXT_EXTRACTION_PURPOSE,
  textExtractionIdempotencyRequestHash,
  textExtractionRequestHash,
} from "./text-extraction-request";

describe("text extraction consent snapshot", () => {
  it("binds the request hash to memory id, exact source text, version, and purpose", () => {
    const original = textExtractionRequestHash({
      memoryId: "memory-1",
      sourceText: "第一次搬进新家的晚上。",
      version: 4,
      purpose: TEXT_EXTRACTION_PURPOSE,
    });

    expect(textExtractionRequestHash({
      memoryId: "memory-1",
      sourceText: "第一次搬进新家的晚上。",
      version: 4,
      purpose: TEXT_EXTRACTION_PURPOSE,
    })).toBe(original);
    expect(textExtractionRequestHash({
      memoryId: "memory-1",
      sourceText: "第一次搬进新家的那个晚上。",
      version: 4,
      purpose: TEXT_EXTRACTION_PURPOSE,
    })).not.toBe(original);
    expect(textExtractionRequestHash({
      memoryId: "memory-1",
      sourceText: "第一次搬进新家的晚上。",
      version: 5,
      purpose: TEXT_EXTRACTION_PURPOSE,
    })).not.toBe(original);
  });

  it("uses a stable semantic identity for replays while keeping a different memory distinct", () => {
    const original = textExtractionIdempotencyRequestHash({
      memoryId: "memory-1",
      purpose: TEXT_EXTRACTION_PURPOSE,
    });

    expect(textExtractionIdempotencyRequestHash({
      memoryId: "memory-1",
      purpose: TEXT_EXTRACTION_PURPOSE,
    })).toBe(original);
    expect(textExtractionIdempotencyRequestHash({
      memoryId: "memory-2",
      purpose: TEXT_EXTRACTION_PURPOSE,
    })).not.toBe(original);
  });
});
