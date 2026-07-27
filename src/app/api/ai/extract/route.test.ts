import { describe, expect, it } from "vitest";

import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/ai/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/ai/extract", () => {
  it("disables every legacy request without invoking an AI provider", async () => {
    const validPayload = await POST(request({
      planetId: "planet-1",
      visibility: "family",
      content: "第一次搬进新家的晚上。",
    }));
    const malformedPayload = await POST(request({ unexpected: true }));

    for (const response of [validPayload, malformedPayload]) {
      expect(response.status).toBe(410);
      await expect(response.json()).resolves.toEqual({
        code: "AI_LEGACY_ENDPOINT_DISABLED",
        message: "旧 AI 提取端点已停用，请通过受保护的记忆 AI 作业接口发起处理。",
        migrationEndpoint: "/api/memories/:memoryId/ai-jobs",
      });
    }
  });
});
