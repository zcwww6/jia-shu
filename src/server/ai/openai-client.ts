import { env } from "@/server/config/env";
import { DomainError } from "@/server/domain-error";

import type { MemoryAiSourceKind } from "./memory-ai-contract";

import {
  OpenAiCompatibleProvider,
  type OpenAiCompatibleProviderConfig,
} from "./openai-compatible-provider";
import type { AiProvider } from "./provider";

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function getAiProvider(fetchImpl?: FetchImplementation): AiProvider {
  return new OpenAiCompatibleProvider(openAiProviderConfig(), fetchImpl);
}

export function hasOpenAI(): boolean {
  return Boolean(env.OPENAI_API_KEY && env.OPENAI_MODEL && env.OPENAI_BASE_URL);
}

export function assertTextAiConfigured(): void {
  if (!hasOpenAI()) {
    throw new DomainError("AI_NOT_CONFIGURED", 503, "智能整理尚未配置。");
  }
}

/**
 * Job creation checks the exact pipeline before any database write. Runtime
 * provider checks remain in place as a second fail-closed boundary.
 */
export function assertMemoryAiCapabilitiesConfigured(input: {
  sourceKind: MemoryAiSourceKind;
}): void {
  assertCapability(env.OPENAI_MODEL);

  if (input.sourceKind === "image") {
    assertCapability(env.OPENAI_VISION_MODEL);
  }

  // When a dedicated transcription model is absent, the configured text model
  // can transcribe through the compatible chat audio-input contract.
}

function assertCapability(model: string | null): void {
  if (!env.OPENAI_API_KEY || !env.OPENAI_BASE_URL?.trim() || !model?.trim()) {
    throw new DomainError("AI_NOT_CONFIGURED", 503, "智能整理尚未配置。");
  }
}

export function openAiProviderConfig(): OpenAiCompatibleProviderConfig {
  return {
    apiKey: env.OPENAI_API_KEY,
    baseUrl: env.OPENAI_BASE_URL,
    textModel: env.OPENAI_MODEL,
    visionModel: env.OPENAI_VISION_MODEL,
    transcriptionModel: env.OPENAI_TRANSCRIPTION_MODEL,
    embeddingModel: env.OPENAI_EMBEDDING_MODEL,
  };
}
