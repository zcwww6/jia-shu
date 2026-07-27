import { describe, expect, it } from "vitest";

import { POST } from "./route";

describe("POST /api/books/generate", () => {
  it("retires every legacy book request instead of invoking an AI provider", async () => {
    const validPayload = await POST(new Request("http://localhost/api/books/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceMemoryIds: ["memory-1"],
        sourceRange: "single_planet",
        themeTemplateKey: "family",
      }),
    }));
    const malformedPayload = await POST(new Request("http://localhost/api/books/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unexpected: true }),
    }));

    for (const response of [validPayload, malformedPayload]) {
      expect(response.status).toBe(410);
      await expect(response.json()).resolves.toEqual({
        code: "AI_LEGACY_ENDPOINT_DISABLED",
        message: "旧 AI 功能端点已停用，当前暂无可用的受保护迁移入口。",
      });
    }
  });
});
