import { describe, expect, it } from "vitest";

import { normalizeResonancePair } from "./resonance-pair";

describe("normalizeResonancePair", () => {
  it("returns the same lexical source-to-target order for either caller orientation", () => {
    expect(normalizeResonancePair("memory-z", "memory-a")).toEqual({
      sourceMemoryId: "memory-a",
      targetMemoryId: "memory-z",
    });
    expect(normalizeResonancePair("memory-a", "memory-z")).toEqual({
      sourceMemoryId: "memory-a",
      targetMemoryId: "memory-z",
    });
  });
});
