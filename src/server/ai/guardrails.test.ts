import { describe, expect, it } from "vitest";

import { ensureMemoryNeedsConfirmation } from "./guardrails";

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
      visibility: "family" as const,
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

describe("memory extraction guardrails", () => {
  it("downgrades any legacy confirmed AI extraction to needs_confirmation", () => {
    const result = ensureMemoryNeedsConfirmation(extraction("confirmed"));

    expect(result).toMatchObject({
      status: "needs_confirmation",
      sourceText: "第一次搬进新家的晚上。",
      suggestion: { uncertainFields: ["occurredAt"] },
    });
  });

  it("refuses an AI extraction that does not contain reviewable uncertainty fields", () => {
    const invalid = extraction();
    delete (invalid.suggestion as Partial<typeof invalid.suggestion>).uncertainFields;

    expect(() => ensureMemoryNeedsConfirmation(invalid)).toThrow(/不确定字段/);
  });
});
