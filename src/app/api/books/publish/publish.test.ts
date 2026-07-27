import { describe, expect, it } from "vitest";

import { POST } from "./route";

describe("POST /api/books/publish", () => {
  it("retires arbitrary browser-supplied publish bodies in favor of saved-book shares", async () => {
    const response = await POST(new Request("http://localhost/api/books/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        draft: { title: "攻击者伪造的家书" },
        body: "浏览器不能再直接公开此正文",
        sections: [{ title: "伪造章节", body: "伪造内容" }],
        share: { showBody: true, showSourceTitles: true, showOriginalText: true },
      }),
    }));

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      code: "BOOK_PUBLISH_ENDPOINT_RETIRED",
      message: "旧家书发布端点已停用，请先保存家书，再通过受保护的分享接口发布。",
      migrationEndpoint: "/api/books/:bookId/shares",
    });
  });
});
