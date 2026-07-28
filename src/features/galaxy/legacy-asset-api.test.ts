import { beforeEach, describe, expect, it, vi } from "vitest";

import { uploadLegacyAsset } from "./legacy-asset-api";

describe("legacy asset API", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("uploads one voice source as authenticated multipart data", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "asset-voice-1",
      planetId: "planet-1",
      kind: "audio",
      visibility: "family",
      mimeType: "audio/mp4",
      sizeBytes: 5,
      originalName: "family-story.m4a",
      status: "stored",
      createdAt: "2026-07-28T00:00:00.000Z",
    }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["voice"], "family-story.m4a", { type: "audio/mp4" });

    const asset = await uploadLegacyAsset({
      file,
      planetId: "planet-1",
      kind: "audio",
      visibility: "family",
    });

    expect(asset).toMatchObject({ id: "asset-voice-1", kind: "audio" });
    expect(fetchMock).toHaveBeenCalledWith("/api/assets", expect.objectContaining({
      method: "POST",
      body: expect.any(FormData),
    }));
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const form = request.body as FormData;
    expect(form.get("file")).toBe(file);
    expect(form.get("planetId")).toBe("planet-1");
    expect(form.get("kind")).toBe("audio");
    expect(form.get("visibility")).toBe("family");
  });

  it("sends a supplied idempotency key in the upload request header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "asset-voice-1",
      planetId: "planet-1",
      kind: "audio",
      visibility: "family",
      mimeType: "audio/mp4",
      sizeBytes: 5,
      originalName: "family-story.m4a",
      status: "stored",
      createdAt: "2026-07-28T00:00:00.000Z",
    }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await uploadLegacyAsset({
      file: new File(["voice"], "family-story.m4a", { type: "audio/mp4" }),
      planetId: "planet-1",
      kind: "audio",
      visibility: "family",
      idempotencyKey: "e4c4ac66-3c6a-4c65-9d2a-d3b25e45be36",
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/assets", expect.objectContaining({
      headers: { "Idempotency-Key": "e4c4ac66-3c6a-4c65-9d2a-d3b25e45be36" },
    }));
  });

  it("forwards an optional abort signal to the upload request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "asset-voice-1",
      planetId: "planet-1",
      kind: "audio",
      visibility: "family",
      mimeType: "audio/mp4",
      sizeBytes: 5,
      originalName: "family-story.m4a",
      status: "stored",
      createdAt: "2026-07-28T00:00:00.000Z",
    }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await uploadLegacyAsset({
      file: new File(["voice"], "family-story.m4a", { type: "audio/mp4" }),
      planetId: "planet-1",
      kind: "audio",
      visibility: "family",
      signal: controller.signal,
    });

    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBe(controller.signal);
  });

  it("surfaces the API's safe failure message without exposing a browser-side storage detail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      message: "上传内容格式不正确。",
    }), { status: 400 })));

    await expect(uploadLegacyAsset({
      file: new File(["bad"], "voice.txt", { type: "text/plain" }),
      planetId: "planet-1",
      kind: "audio",
      visibility: "private",
    })).rejects.toThrow("上传内容格式不正确。");
  });
});
