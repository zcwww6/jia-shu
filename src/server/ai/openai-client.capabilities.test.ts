import { beforeEach, describe, expect, it, vi } from "vitest";

const { env } = vi.hoisted(() => ({
  env: {
    OPENAI_API_KEY: "key",
    OPENAI_MODEL: "text-model",
    OPENAI_BASE_URL: "https://ai.example.test/v1",
    OPENAI_VISION_MODEL: null as string | null,
    OPENAI_TRANSCRIPTION_MODEL: null as string | null,
    OPENAI_EMBEDDING_MODEL: null as string | null,
  },
}));

vi.mock("@/server/config/env", () => ({ env }));

import { assertMemoryAiCapabilitiesConfigured } from "./openai-client";

describe("memory AI capability preflight", () => {
  beforeEach(() => {
    env.OPENAI_API_KEY = "key";
    env.OPENAI_MODEL = "text-model";
    env.OPENAI_BASE_URL = "https://ai.example.test/v1";
    env.OPENAI_VISION_MODEL = null;
    env.OPENAI_TRANSCRIPTION_MODEL = null;
  });

  it.each(["text", "document"] as const)("allows %s only when the text capability is configured", (sourceKind) => {
    expect(() => assertMemoryAiCapabilitiesConfigured({ sourceKind })).not.toThrow();
  });

  it("fails closed before enqueueing an image pipeline without a vision model", () => {
    expect(() => assertMemoryAiCapabilitiesConfigured({ sourceKind: "image" }))
      .toThrow(expect.objectContaining({ code: "AI_NOT_CONFIGURED", status: 503 }));
  });

  it("fails closed before enqueueing an audio pipeline without a transcription model", () => {
    expect(() => assertMemoryAiCapabilitiesConfigured({ sourceKind: "audio" }))
      .toThrow(expect.objectContaining({ code: "AI_NOT_CONFIGURED", status: 503 }));
  });

  it("requires the common key and endpoint even when the source-specific model exists", () => {
    env.OPENAI_VISION_MODEL = "vision-model";
    env.OPENAI_API_KEY = null as unknown as string;

    expect(() => assertMemoryAiCapabilitiesConfigured({ sourceKind: "image" }))
      .toThrow(expect.objectContaining({ code: "AI_NOT_CONFIGURED", status: 503 }));
  });
});
