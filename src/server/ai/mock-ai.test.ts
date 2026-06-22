import { describe, expect, it } from "vitest";

import { ensureSourceTrace } from "@/server/ai/guardrails";
import { extractMemory, generateBook, scanResonance } from "@/server/ai/mock-ai";

describe("mock AI demo loop", () => {
  it("extracts a structured memory draft from raw text", async () => {
    const result = await extractMemory({
      planetId: "mock-mom",
      visibility: "family",
      content:
        "2018 年除夕我们第一次在新房里过年。妈妈忙了一整天，最后在客厅拍下了全家福。",
    });

    expect(result.memory.title).toBe("新家里的第一个除夕");
    expect(result.memory.occurredAt).toBe("2018 年除夕");
    expect(result.memory.location).toBe("新房客厅");
    expect(result.memory.people).toContain("妈妈");
    expect(result.status).toBe("needs_confirmation");
  });

  it("scans a candidate resonance with score breakdown", async () => {
    const result = await scanResonance({ memoryId: "memory-2018-mom" });

    expect(result.candidate.status).toBe("candidate");
    expect(result.candidate.sourceMemoryIds).toContain("memory-2018-mom");
    expect(result.breakdown.time).toBeGreaterThan(0.8);
    expect(result.comparedMemories).toHaveLength(2);
  });

  it("generates a sourced book draft", async () => {
    const result = await generateBook({
      sourceMemoryIds: ["memory-2018-mom", "memory-2018-me"],
      sourceRange: "binary_system",
      themeTemplateKey: "family_reunion",
    });

    expect(result.draft.sourceMemoryIds).toEqual(["memory-2018-mom", "memory-2018-me"]);
    expect(result.sections[0].sourceMemoryIds).toContain("memory-2018-mom");
    expect(() =>
      ensureSourceTrace(
        {
          sourceMemoryIds: ["memory-2018-mom", "memory-2018-me"],
          sourceRange: "binary_system",
          themeTemplateKey: "family_reunion",
        },
        result,
      ),
    ).not.toThrow();
  });
});
