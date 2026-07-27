import { describe, expect, it, vi } from "vitest";

import {
  confirmLegacyMemory,
  createLegacyMemoryDraft,
  getLegacyMemoryReview,
  getLegacyMemoryAiJob,
  startLegacyMemoryExtraction,
} from "./legacy-memory-api";

describe("legacy memory API bridge", () => {
  it("creates a draft and starts an explicit-consent extraction job with separate idempotency keys", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "memory-1", version: 1, status: "draft" }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-1", status: "queued" }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    const draft = await createLegacyMemoryDraft({
      planetId: "planet-persisted-mom",
      sourceText: "除夕夜全家在新房拍了合照。",
      visibility: "family",
      allowResonance: true,
      allowBook: true,
    });
    await startLegacyMemoryExtraction(draft.id);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/memories",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "Idempotency-Key": expect.any(String),
        }),
        body: JSON.stringify({
          planetId: "planet-persisted-mom",
          sourceText: "除夕夜全家在新房拍了合照。",
          visibility: "family",
          allowResonance: true,
          allowBook: true,
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/memories/memory-1/ai-jobs",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Idempotency-Key": expect.any(String) }),
        body: JSON.stringify({ consent: true, purpose: "memory_extraction" }),
      }),
    );
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).not.toEqual(
      (fetchMock.mock.calls[1][1] as RequestInit).headers,
    );
  });

  it("gets the completed review and confirms only the reviewed version", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-1", status: "completed" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "memory-1", planetId: "planet-1", status: "needs_confirmation", version: 4,
        title: "除夕合照", summary: "全家团圆", tags: ["春节"], occurredAtLabel: "2018 年除夕",
        locationLabel: "新房", people: ["妈妈", "我"], visibility: "family", allowResonance: true,
        allowBook: true, uncertainFields: ["地点"],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "memory-1", planetId: "planet-1", status: "confirmed", version: 5, title: "除夕合照", summary: "全家团圆", tags: ["春节"], occurredAtLabel: "2018 年除夕", locationLabel: "新房", people: ["妈妈", "我"], visibility: "family", allowResonance: true, allowBook: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getLegacyMemoryAiJob("job-1")).resolves.toMatchObject({ status: "completed" });
    const review = await getLegacyMemoryReview("memory-1");
    await confirmLegacyMemory({ memoryId: review.id, version: review.version, title: "确认的除夕合照", summary: "确认后的团圆瞬间" });

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/ai-jobs/job-1", expect.objectContaining({ method: "GET" }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/memories/memory-1", expect.objectContaining({ method: "GET" }));
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/memories/memory-1/confirm",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "If-Match-Version": "4" }),
        body: JSON.stringify({ version: 4, title: "确认的除夕合照", summary: "确认后的团圆瞬间" }),
      }),
    );
  });

  it("surfaces the server error message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "AI 服务暂不可用，请稍后再试。" }), { status: 503 }),
    ));

    await expect(getLegacyMemoryAiJob("job-1")).rejects.toThrow("AI 服务暂不可用，请稍后再试。");
  });
});
