import { describe, expect, it, vi } from "vitest";

import { OpenAiCompatibleProvider } from "./openai-compatible-provider";

function providerWithMemoryMetadata(metadata: {
  locationLabel: string | null;
  people: string[];
}, extra: Record<string, unknown> = {}) {
  const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({
      title: "新家的晚上",
      summary: "全家第一次在新家吃晚饭。",
      ...metadata,
      emotions: ["安心"],
      uncertainFields: ["occurredAtLabel"],
      ...extra,
    }) } }],
  }), { status: 200, headers: { "Content-Type": "application/json" } }));

  return new OpenAiCompatibleProvider({
    apiKey: "test-key",
    baseUrl: "https://ai.example/v1",
    textModel: "text-model",
    visionModel: "vision-model",
    transcriptionModel: "transcription-model",
    embeddingModel: "embedding-model",
  }, fetchImpl);
}

describe("OpenAiCompatibleProvider", () => {
  it("rejects transcription with AI_NOT_CONFIGURED before touching fetch when its capability is absent", async () => {
    const fetchImpl = vi.fn();
    const provider = new OpenAiCompatibleProvider({
      apiKey: null,
      baseUrl: "https://ai.example/v1",
      textModel: "text-model",
      visionModel: "vision-model",
      transcriptionModel: null,
      embeddingModel: null,
    }, fetchImpl);

    await expect(provider.transcribeAudio({
      audio: new Blob(["audio"], { type: "audio/mpeg" }),
      fileName: "family.mp3",
    })).rejects.toMatchObject({
      code: "AI_NOT_CONFIGURED",
      status: 503,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts transcription audio as multipart to the compatible endpoint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: "这是妈妈的录音。" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    const provider = new OpenAiCompatibleProvider({
      apiKey: "test-key",
      baseUrl: "https://ai.example/v1/",
      textModel: "text-model",
      visionModel: "vision-model",
      transcriptionModel: "whisper-compatible",
      embeddingModel: "embedding-model",
    }, fetchImpl);

    await expect(provider.transcribeAudio({
      audio: new Blob(["audio"], { type: "audio/mpeg" }),
      fileName: "family.mp3",
    })).resolves.toEqual({ text: "这是妈妈的录音。" });

    expect(fetchImpl).toHaveBeenCalledWith("https://ai.example/v1/audio/transcriptions", expect.objectContaining({
      method: "POST",
      headers: { Authorization: "Bearer test-key" },
    }));
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.body).toBeInstanceOf(FormData);
    const form = init?.body as FormData;
    expect(form.get("model")).toBe("whisper-compatible");
    expect(form.get("file")).toBeTruthy();
  });

  it("posts strictly structured text extraction to chat completions", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        title: "新家的晚上",
        summary: "全家第一次在新家吃晚饭。",
        locationLabel: "老家厨房",
        people: ["妈妈", "我"],
        emotions: ["安心"],
        uncertainFields: ["occurredAtLabel"],
      }) } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const provider = new OpenAiCompatibleProvider({
      apiKey: "test-key",
      baseUrl: "https://ai.example/v1",
      textModel: "text-model",
      visionModel: "vision-model",
      transcriptionModel: "transcription-model",
      embeddingModel: "embedding-model",
    }, fetchImpl);

    await expect(provider.extractMemory({
      sourceText: "第一次搬进新家的晚上。",
      assetIds: [],
      occurredAtLabel: "2018 年夏天",
    })).resolves.toEqual({
      title: "新家的晚上",
      summary: "全家第一次在新家吃晚饭。",
      locationLabel: "老家厨房",
      people: ["妈妈", "我"],
      emotions: ["安心"],
      uncertainFields: ["occurredAtLabel"],
    });

    expect(fetchImpl).toHaveBeenCalledWith("https://ai.example/v1/chat/completions", expect.objectContaining({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-key",
      },
    }));
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      model: "text-model",
      response_format: {
        type: "json_schema",
        json_schema: { name: "memory_extract", strict: true },
      },
    });
    expect(body.messages[1].content).toContain("第一次搬进新家的晚上。");
    expect(body.messages[0].content).toContain("locationLabel");
  });

  it("normalizes AI memory location and people metadata before returning it", async () => {
    const provider = providerWithMemoryMetadata({
      locationLabel: "  老家厨房  ",
      people: [" 妈妈 ", "外婆", "妈妈", " 外婆 ", " 我 "],
    });

    await expect(provider.extractMemory({ sourceText: "第一次搬进新家的晚上。", assetIds: [] }))
      .resolves.toEqual({
        title: "新家的晚上",
        summary: "全家第一次在新家吃晚饭。",
        locationLabel: "老家厨房",
        people: ["妈妈", "外婆", "我"],
        emotions: ["安心"],
        uncertainFields: ["occurredAtLabel"],
      });
  });

  it("fails closed when a memory extraction includes an unknown provider field", async () => {
    const provider = providerWithMemoryMetadata({
      locationLabel: "老家厨房",
      people: ["妈妈", "我"],
    }, { providerTraceId: "internal-only" });

    await expect(provider.extractMemory({ sourceText: "家庭记忆", assetIds: [] }))
      .rejects.toMatchObject({ code: "AI_PROVIDER_RESPONSE_INVALID", status: 502 });
  });

  it.each([
    ["a blank location label", { locationLabel: "   ", people: ["妈妈"] }],
    ["an overlong location label", { locationLabel: "地".repeat(201), people: ["妈妈"] }],
    ["a blank person", { locationLabel: null, people: ["妈妈", " "] }],
    ["more than fifty people", {
      locationLabel: null,
      people: Array.from({ length: 51 }, (_, index) => `家人${index + 1}`),
    }],
  ])("fails closed for %s in AI memory metadata", async (_label, metadata) => {
    const provider = providerWithMemoryMetadata(metadata);

    await expect(provider.extractMemory({ sourceText: "家庭记忆", assetIds: [] }))
      .rejects.toMatchObject({ code: "AI_PROVIDER_RESPONSE_INVALID", status: 502 });
  });

  it("fails closed when a memory extraction omits a location label instead of guessing one", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        title: "新家的晚上",
        summary: "全家第一次在新家吃晚饭。",
        people: ["妈妈", "我"],
        emotions: ["安心"],
        uncertainFields: ["locationLabel"],
      }) } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const provider = new OpenAiCompatibleProvider({
      apiKey: "test-key",
      baseUrl: "https://ai.example/v1",
      textModel: "text-model",
      visionModel: "vision-model",
      transcriptionModel: "transcription-model",
      embeddingModel: "embedding-model",
    }, fetchImpl);

    await expect(provider.extractMemory({ sourceText: "第一次搬进新家的晚上。", assetIds: [] }))
      .rejects.toMatchObject({ code: "AI_PROVIDER_RESPONSE_INVALID", status: 502 });
  });

  it("checks visual and embedding capabilities independently without a fallback provider", async () => {
    const fetchImpl = vi.fn();
    const provider = new OpenAiCompatibleProvider({
      apiKey: "test-key",
      baseUrl: "https://ai.example/v1",
      textModel: "text-model",
      visionModel: null,
      transcriptionModel: "transcription-model",
      embeddingModel: null,
    }, fetchImpl);

    await expect(provider.describeImage({ imageUrl: "data:image/png;base64,AA==" }))
      .rejects.toMatchObject({ code: "AI_NOT_CONFIGURED", status: 503 });
    await expect(provider.embed({ input: "家庭记忆" }))
      .rejects.toMatchObject({ code: "AI_NOT_CONFIGURED", status: 503 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts embeddings to the compatible embeddings endpoint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ embedding: [0.1, -0.2, 0.3] }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const provider = new OpenAiCompatibleProvider({
      apiKey: "test-key",
      baseUrl: "https://ai.example/v1",
      textModel: "text-model",
      visionModel: "vision-model",
      transcriptionModel: "transcription-model",
      embeddingModel: "embedding-model",
    }, fetchImpl);

    await expect(provider.embed({ input: "家庭记忆" })).resolves.toEqual([0.1, -0.2, 0.3]);

    expect(fetchImpl).toHaveBeenCalledWith("https://ai.example/v1/embeddings", expect.objectContaining({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-key",
      },
      body: JSON.stringify({ model: "embedding-model", input: "家庭记忆" }),
    }));
  });

  it("sends visual analysis through chat completions with the vision model", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        description: "一张家庭聚餐照片。",
        uncertainFields: ["people"],
      }) } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const provider = new OpenAiCompatibleProvider({
      apiKey: "test-key",
      baseUrl: "https://ai.example/v1",
      textModel: "text-model",
      visionModel: "vision-model",
      transcriptionModel: "transcription-model",
      embeddingModel: "embedding-model",
    }, fetchImpl);

    await expect(provider.describeImage({ imageUrl: "data:image/png;base64,AA==" })).resolves.toEqual({
      description: "一张家庭聚餐照片。",
      uncertainFields: ["people"],
    });

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.model).toBe("vision-model");
    expect(body.messages[1].content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "image_url", image_url: { url: "data:image/png;base64,AA==" } }),
    ]));
  });

  it("does not use a mock fallback for resonance or book generation when text capability is absent", async () => {
    const fetchImpl = vi.fn();
    const provider = new OpenAiCompatibleProvider({
      apiKey: "test-key",
      baseUrl: "https://ai.example/v1",
      textModel: null,
      visionModel: "vision-model",
      transcriptionModel: "transcription-model",
      embeddingModel: "embedding-model",
    }, fetchImpl);

    await expect(provider.explainResonance({ sourceText: "记忆 A", targetText: "记忆 B" }))
      .rejects.toMatchObject({ code: "AI_NOT_CONFIGURED", status: 503 });
    await expect(provider.generateBook({
      themeTemplateKey: "family",
      memories: [{ id: "memory-1", title: "新家的晚上", summary: "全家吃晚饭。" }],
    })).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED", status: 503 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses structured text completions for resonance explanations and books", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          explanation: "两段记忆都提到新家的晚饭。",
          uncertainFields: ["occurredAt"],
        }) } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          title: "新家的第一晚",
          intro: "全家一起记住的时刻。",
          sections: [{ title: "晚饭", body: "全家第一次在新家吃晚饭。" }],
        }) } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const provider = new OpenAiCompatibleProvider({
      apiKey: "test-key",
      baseUrl: "https://ai.example/v1",
      textModel: "text-model",
      visionModel: "vision-model",
      transcriptionModel: "transcription-model",
      embeddingModel: "embedding-model",
    }, fetchImpl);

    await expect(provider.explainResonance({ sourceText: "新家晚饭", targetText: "搬家那晚吃饭" }))
      .resolves.toEqual({ explanation: "两段记忆都提到新家的晚饭。", uncertainFields: ["occurredAt"] });
    await expect(provider.generateBook({
      themeTemplateKey: "family",
      memories: [{ id: "memory-1", title: "新家的晚上", summary: "全家吃晚饭。" }],
    })).resolves.toEqual({
      title: "新家的第一晚",
      intro: "全家一起记住的时刻。",
      sections: [{ title: "晚饭", body: "全家第一次在新家吃晚饭。" }],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("maps a provider HTTP error to a safe error without retaining response detail", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("upstream key sk-sensitive must never escape", {
      status: 429,
    }));
    const provider = new OpenAiCompatibleProvider({
      apiKey: "test-key",
      baseUrl: "https://ai.example/v1",
      textModel: "text-model",
      visionModel: "vision-model",
      transcriptionModel: "transcription-model",
      embeddingModel: "embedding-model",
    }, fetchImpl);

    await expect(provider.extractMemory({ sourceText: "家庭记忆", assetIds: [] }))
      .rejects.toMatchObject({ code: "AI_PROVIDER_UNAVAILABLE", status: 503 });
    await provider.extractMemory({ sourceText: "家庭记忆", assetIds: [] }).catch((error: Error) => {
      expect(error.message).not.toContain("sk-sensitive");
    });
  });

  it("aborts a pending provider request at the configured 25-second deadline before the 30-second lease", async () => {
    vi.useFakeTimers();

    try {
      const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("request aborted", "AbortError"));
        }, { once: true });
      }));
      const provider = new OpenAiCompatibleProvider({
        apiKey: "test-key",
        baseUrl: "https://ai.example/v1",
        textModel: "text-model",
        visionModel: "vision-model",
        transcriptionModel: "transcription-model",
        embeddingModel: "embedding-model",
        requestTimeoutMs: 25_000,
      }, fetchImpl);

      const pending = provider.extractMemory({ sourceText: "家庭记忆", assetIds: [] });
      const signal = fetchImpl.mock.calls[0]?.[1]?.signal;

      expect(signal).toBeInstanceOf(AbortSignal);
      await vi.advanceTimersByTimeAsync(24_999);
      expect(signal?.aborted).toBe(false);

      const unavailable = expect(pending).rejects.toMatchObject({
        code: "AI_PROVIDER_UNAVAILABLE",
        status: 503,
      });
      await vi.advanceTimersByTimeAsync(1);
      await unavailable;
      expect(signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the 25-second deadline active while a successful response body is still decoding", async () => {
    vi.useFakeTimers();

    try {
      let signal: AbortSignal | undefined;
      const json = vi.fn(() => new Promise<unknown>((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          reject(new DOMException("body decode aborted", "AbortError"));
        }, { once: true });
      }));
      const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        return Promise.resolve({ ok: true, json } as unknown as Response);
      });
      const provider = new OpenAiCompatibleProvider({
        apiKey: "test-key",
        baseUrl: "https://ai.example/v1",
        textModel: "text-model",
        visionModel: "vision-model",
        transcriptionModel: "transcription-model",
        embeddingModel: "embedding-model",
        requestTimeoutMs: 25_000,
      }, fetchImpl);

      const pending = provider.extractMemory({ sourceText: "家庭记忆", assetIds: [] });
      const settled = pending.then(
        () => ({ kind: "resolved" as const }),
        (error: unknown) => ({ kind: "rejected" as const, error }),
      );
      await Promise.resolve();
      await Promise.resolve();
      expect(json).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(25_000);
      expect(signal?.aborted).toBe(true);
      await expect(settled).resolves.toMatchObject({
        kind: "rejected",
        error: {
        code: "AI_PROVIDER_UNAVAILABLE",
        status: 503,
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the provider deadline after a fast response", async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");

    try {
      const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          title: "新家的晚上",
          summary: "全家第一次在新家吃晚饭。",
          locationLabel: null,
          people: ["妈妈", "我"],
          emotions: ["安心"],
          uncertainFields: ["occurredAtLabel"],
        }) } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
      const provider = new OpenAiCompatibleProvider({
        apiKey: "test-key",
        baseUrl: "https://ai.example/v1",
        textModel: "text-model",
        visionModel: "vision-model",
        transcriptionModel: "transcription-model",
        embeddingModel: "embedding-model",
        requestTimeoutMs: 25_000,
      }, fetchImpl);

      await expect(provider.extractMemory({ sourceText: "家庭记忆", assetIds: [] })).resolves.toMatchObject({
        title: "新家的晚上",
      });

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 25_000);
      expect(clearTimeoutSpy).toHaveBeenCalledWith(expect.anything());
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  });

  it("rejects malformed structured extraction instead of accepting a partial provider response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        title: "新家的晚上",
        summary: "全家第一次在新家吃晚饭。",
        people: ["妈妈", "我"],
        emotions: ["安心"],
      }) } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const provider = new OpenAiCompatibleProvider({
      apiKey: "test-key",
      baseUrl: "https://ai.example/v1",
      textModel: "text-model",
      visionModel: "vision-model",
      transcriptionModel: "transcription-model",
      embeddingModel: "embedding-model",
    }, fetchImpl);

    await expect(provider.extractMemory({ sourceText: "家庭记忆", assetIds: [] }))
      .rejects.toMatchObject({ code: "AI_PROVIDER_RESPONSE_INVALID", status: 502 });
  });
});
