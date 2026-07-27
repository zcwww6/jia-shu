import { describe, expect, it } from "vitest";

import { isMemoryExtractResponse, isReviewableMemoryExtractResponse } from "./schemas";

function extraction(status: "needs_confirmation" | "confirmed" = "needs_confirmation") {
  return {
    memory: {
      id: "memory-1",
      planetId: "planet-1",
      title: "新家的晚上",
      occurredAt: "2018 年夏天",
      location: "新房客厅",
      people: ["妈妈", "我"],
      emotions: ["安心"],
      visibility: "family",
      summary: "全家第一次在新家吃晚饭。",
    },
    suggestion: {
      title: "新家的晚上",
      occurredAt: "2018 年夏天",
      location: "新房客厅",
      people: ["妈妈", "我"],
      emotions: ["安心"],
      summary: "全家第一次在新家吃晚饭。",
      uncertainFields: ["occurredAt"],
    },
    sourceText: "第一次搬进新家的晚上。",
    status,
  };
}

describe("AI extraction schemas", () => {
  it("requires a reviewable uncertainty structure before accepting an extraction response", () => {
    expect(isMemoryExtractResponse(extraction())).toBe(true);
    expect(isMemoryExtractResponse({ ...extraction(), suggestion: { title: "缺少字段" } })).toBe(false);
  });

  it("treats only needs_confirmation as a reviewable memory response", () => {
    expect(isReviewableMemoryExtractResponse(extraction("needs_confirmation"))).toBe(true);
    expect(isReviewableMemoryExtractResponse(extraction("confirmed"))).toBe(false);
  });
});
