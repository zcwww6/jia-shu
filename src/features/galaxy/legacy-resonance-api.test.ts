import { describe, expect, it, vi } from "vitest";

import {
  confirmLegacyResonance,
  scanLegacyResonances,
} from "./legacy-resonance-api";

describe("legacy resonance API bridge", () => {
  it("scans a confirmed memory through the persisted resonance endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ candidates: [] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(scanLegacyResonances("memory-confirmed-1")).resolves.toEqual({ candidates: [] });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/resonances/scan",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memoryId: "memory-confirmed-1" }),
      }),
    );
  });

  it("forwards scan cancellation to the persisted resonance endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ candidates: [] }), { status: 200 }),
    );
    const controller = new AbortController();
    vi.stubGlobal("fetch", fetchMock);

    await scanLegacyResonances("memory-confirmed-1", controller.signal);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/resonances/scan",
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("confirms a candidate with its current optimistic version", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        id: "resonance-1",
        sourceMemoryId: "memory-a",
        targetMemoryId: "memory-b",
        score: 0.91,
        reason: "两段记忆都指向同一次团圆。",
        status: "confirmed",
        confirmedAt: "2026-07-28T00:00:00.000Z",
        rejectedAt: null,
        version: 4,
      }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await confirmLegacyResonance({ id: "resonance-1", status: "confirmed", version: 3 });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/resonances/resonance-1/confirm",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "If-Match-Version": "3",
        },
        body: JSON.stringify({ status: "confirmed", version: 3 }),
      }),
    );
  });

  it("propagates a safe server error instead of fabricating a resonance candidate", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "共鸣服务暂不可用" }), { status: 503 }),
    ));

    await expect(scanLegacyResonances("memory-confirmed-1")).rejects.toThrow("共鸣服务暂不可用");
  });
});
