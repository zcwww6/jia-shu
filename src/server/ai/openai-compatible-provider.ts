import { DomainError } from "@/server/domain-error";

import type {
  AiProvider,
  AudioAiInput,
  BookAiInput,
  EmbedAiInput,
  GeneratedBook,
  ImageAiInput,
  ImageDescription,
  MemoryAiDraft,
  MemoryAiInput,
  ResonanceAiInput,
  ResonanceExplanation,
  Transcript,
} from "./provider";

const DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS = 25_000;

export type OpenAiCompatibleProviderConfig = {
  apiKey: string | null;
  baseUrl: string | null;
  textModel: string | null;
  visionModel: string | null;
  transcriptionModel: string | null;
  embeddingModel: string | null;
  requestTimeoutMs?: number;
};

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class OpenAiCompatibleProvider implements AiProvider {
  constructor(
    private readonly config: OpenAiCompatibleProviderConfig,
    private readonly fetchImpl: FetchImplementation = fetch,
  ) {}

  async extractMemory(input: MemoryAiInput): Promise<MemoryAiDraft> {
    const payload = await this.chatJson(
      "memory_extract",
      this.requireCapability(this.config.textModel),
      memoryExtractSchema,
      "你是谨慎的家庭记忆整理助手。只基于输入文本整理信息；locationLabel 必须填写文本明确的简短地点名称，未明确时必须为 null；不确定的字段必须写入 uncertainFields，绝不编造家庭事实。",
      [
        "请整理下列家庭记忆。",
        `原始文本：${input.sourceText}`,
        input.occurredAtLabel ? `时间提示：${input.occurredAtLabel}` : "时间提示：未提供",
      ].join("\n"),
    );

    const draft = parseMemoryAiDraft(payload);

    if (!draft) {
      throw providerResponseInvalid();
    }

    return draft;
  }

  async describeImage(input: ImageAiInput): Promise<ImageDescription> {
    const payload = await this.chatJson(
      "image_description",
      this.requireCapability(this.config.visionModel),
      imageDescriptionSchema,
      "你是谨慎的家庭照片整理助手。描述可见内容，不确定的家人身份或时间必须写入 uncertainFields。",
      [
        { type: "text", text: "请描述这张家庭照片，不要编造人物身份或历史。" },
        { type: "image_url", image_url: { url: input.imageUrl } },
      ],
    );

    if (!isImageDescription(payload)) {
      throw providerResponseInvalid();
    }

    return payload;
  }

  async transcribeAudio(input: AudioAiInput): Promise<Transcript> {
    const model = this.requireCapability(this.config.transcriptionModel);
    const form = new FormData();
    form.append("model", model);
    form.append("file", input.audio, input.fileName);

    const payload = await this.requestJson(this.endpoint("/audio/transcriptions"), {
      method: "POST",
      headers: { Authorization: `Bearer ${this.config.apiKey}` },
      body: form,
    });

    if (!isTranscript(payload)) {
      throw providerResponseInvalid();
    }

    return { text: payload.text };
  }

  async embed(input: EmbedAiInput): Promise<number[]> {
    const model = this.requireCapability(this.config.embeddingModel);
    const payload = await this.requestJson(this.endpoint("/embeddings"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({ model, input: input.input }),
    });
    const embedding = embeddingValues(payload);

    if (!embedding) {
      throw providerResponseInvalid();
    }

    return embedding;
  }

  async explainResonance(input: ResonanceAiInput): Promise<ResonanceExplanation> {
    const payload = await this.chatJson(
      "resonance_explanation",
      this.requireCapability(this.config.textModel),
      resonanceExplanationSchema,
      "你只解释两段已提供家庭记忆的可见联系，不得把推测当成事实；不确定内容写入 uncertainFields。",
      `记忆 A：${input.sourceText}\n记忆 B：${input.targetText}`,
    );

    if (!isResonanceExplanation(payload)) {
      throw providerResponseInvalid();
    }

    return payload;
  }

  async generateBook(input: BookAiInput): Promise<GeneratedBook> {
    const payload = await this.chatJson(
      "book_generate",
      this.requireCapability(this.config.textModel),
      generatedBookSchema,
      "你只能根据提供的家庭记忆写作，不得编造。章节应忠实保留来源记忆的限制。",
      [
        `主题：${input.themeTemplateKey}`,
        "来源记忆：",
        ...input.memories.map((memory) => `- ${memory.id}｜${memory.title}：${memory.summary}`),
      ].join("\n"),
    );

    if (!isGeneratedBook(payload)) {
      throw providerResponseInvalid();
    }

    return payload;
  }

  private requireCapability(model: string | null) {
    if (!this.config.apiKey || !model || !this.config.baseUrl?.trim()) {
      throw new DomainError("AI_NOT_CONFIGURED", 503, "AI 功能尚未配置。");
    }

    return model;
  }

  private endpoint(path: string) {
    const baseUrl = this.config.baseUrl?.trim();

    if (!baseUrl) {
      throw new DomainError("AI_NOT_CONFIGURED", 503, "AI 功能尚未配置。");
    }

    return `${baseUrl.replace(/\/+$/, "")}${path}`;
  }

  private async requestJson(input: RequestInfo | URL, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.requestTimeoutMs ?? DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS,
    );
    const abort = rejectOnAbort(controller.signal);

    try {
      const response = await Promise.race([
        this.fetchImpl(input, { ...init, signal: controller.signal }),
        abort.promise,
      ]);

      if (!response.ok) {
        throw providerUnavailable();
      }

      try {
        return await Promise.race([response.json(), abort.promise]);
      } catch (error) {
        if (controller.signal.aborted) {
          throw providerUnavailable();
        }

        if (error instanceof DomainError) {
          throw error;
        }

        throw providerResponseInvalid();
      }
    } catch (error) {
      if (error instanceof DomainError) {
        throw error;
      }

      throw providerUnavailable();
    } finally {
      clearTimeout(timeout);
      abort.dispose();
    }
  }

  private async chatJson(
    schemaName: string,
    model: string,
    schema: object,
    system: string,
    user: unknown,
  ): Promise<unknown> {
    const payload = await this.requestJson(this.endpoint("/chat/completions"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: schemaName, strict: true, schema },
        },
      }),
    });
    const content = chatContent(payload);

    if (!content) {
      throw providerResponseInvalid();
    }

    try {
      return JSON.parse(content);
    } catch {
      throw providerResponseInvalid();
    }
  }
}

function rejectOnAbort(signal: AbortSignal) {
  let onAbort: (() => void) | undefined;
  const promise = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(providerUnavailable());
    signal.addEventListener("abort", onAbort, { once: true });
  });

  return {
    promise,
    dispose() {
      if (onAbort) {
        signal.removeEventListener("abort", onAbort);
      }
    },
  };
}

const memoryExtractSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    locationLabel: { anyOf: [{ type: "string" }, { type: "null" }] },
    people: { type: "array", items: { type: "string" } },
    emotions: { type: "array", items: { type: "string" } },
    uncertainFields: { type: "array", items: { type: "string" } },
  },
  required: ["title", "summary", "locationLabel", "people", "emotions", "uncertainFields"],
  additionalProperties: false,
} as const;

const imageDescriptionSchema = {
  type: "object",
  properties: {
    description: { type: "string" },
    uncertainFields: { type: "array", items: { type: "string" } },
  },
  required: ["description", "uncertainFields"],
  additionalProperties: false,
} as const;

const resonanceExplanationSchema = {
  type: "object",
  properties: {
    explanation: { type: "string" },
    uncertainFields: { type: "array", items: { type: "string" } },
  },
  required: ["explanation", "uncertainFields"],
  additionalProperties: false,
} as const;

const generatedBookSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    intro: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          body: { type: "string" },
        },
        required: ["title", "body"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "intro", "sections"],
  additionalProperties: false,
} as const;

function isTranscript(value: unknown): value is { text: string } {
  return typeof value === "object" && value !== null && typeof (value as { text?: unknown }).text === "string";
}

function isMemoryAiDraft(value: unknown): value is MemoryAiDraft {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  if (!hasOnlyMemoryAiDraftKeys(value)) {
    return false;
  }

  const candidate = value as Partial<MemoryAiDraft>;
  return (
    typeof candidate.title === "string"
    && typeof candidate.summary === "string"
    && (typeof candidate.locationLabel === "string" || candidate.locationLabel === null)
    && stringArray(candidate.people)
    && stringArray(candidate.emotions)
    && stringArray(candidate.uncertainFields)
  );
}

function parseMemoryAiDraft(value: unknown): MemoryAiDraft | null {
  if (!isMemoryAiDraft(value)) {
    return null;
  }

  const locationLabel = value.locationLabel === null
    ? null
    : normalizeShortText(value.locationLabel);
  const people = normalizePeople(value.people);

  if (
    (value.locationLabel !== null && locationLabel === null)
    || people === null
  ) {
    return null;
  }

  return {
    title: value.title,
    summary: value.summary,
    locationLabel,
    people,
    emotions: value.emotions,
    uncertainFields: value.uncertainFields,
  };
}

const memoryAiDraftKeys = new Set([
  "title",
  "summary",
  "locationLabel",
  "people",
  "emotions",
  "uncertainFields",
]);

function hasOnlyMemoryAiDraftKeys(value: object) {
  return Object.keys(value).every((key) => memoryAiDraftKeys.has(key));
}

function normalizeShortText(value: string) {
  const normalized = value.trim();

  return normalized.length > 0 && normalized.length <= 200 ? normalized : null;
}

function normalizePeople(people: string[]) {
  if (people.length > 50) {
    return null;
  }

  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const person of people) {
    const value = normalizeShortText(person);

    if (!value) {
      return null;
    }

    if (!seen.has(value)) {
      seen.add(value);
      normalized.push(value);
    }
  }

  return normalized;
}

function isImageDescription(value: unknown): value is ImageDescription {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<ImageDescription>;
  return typeof candidate.description === "string" && stringArray(candidate.uncertainFields);
}

function isResonanceExplanation(value: unknown): value is ResonanceExplanation {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<ResonanceExplanation>;
  return typeof candidate.explanation === "string" && stringArray(candidate.uncertainFields);
}

function isGeneratedBook(value: unknown): value is GeneratedBook {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<GeneratedBook>;
  return (
    typeof candidate.title === "string"
    && typeof candidate.intro === "string"
    && Array.isArray(candidate.sections)
    && candidate.sections.every(isGeneratedBookSection)
  );
}

function isGeneratedBookSection(value: unknown): value is GeneratedBook["sections"][number] {
  return (
    typeof value === "object"
    && value !== null
    && typeof (value as { title?: unknown }).title === "string"
    && typeof (value as { body?: unknown }).body === "string"
  );
}

function chatContent(value: unknown): string | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const content = (value as {
    choices?: Array<{ message?: { content?: unknown } }>;
  }).choices?.[0]?.message?.content;

  return typeof content === "string" ? content : null;
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function embeddingValues(value: unknown): number[] | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const embedding = (value as { data?: Array<{ embedding?: unknown }> }).data?.[0]?.embedding;

  return Array.isArray(embedding) && embedding.every((item) => typeof item === "number" && Number.isFinite(item))
    ? embedding
    : null;
}

function providerUnavailable() {
  return new DomainError("AI_PROVIDER_UNAVAILABLE", 503, "AI 服务暂不可用，请稍后重试。");
}

function providerResponseInvalid() {
  return new DomainError("AI_PROVIDER_RESPONSE_INVALID", 502, "AI 服务返回内容无法处理，请稍后重试。");
}
