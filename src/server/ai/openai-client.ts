import { memoryStars } from "@/shared/mock/galaxy-data";
import { demoSession } from "@/shared/mock/demo-session";
import type {
  BookGenerateRequest,
  BookGenerateResponse,
  MemoryExtractRequest,
  MemoryExtractResponse,
} from "@/shared/types/galaxy";
import { bookPrompt, memoryExtractPrompt } from "./prompts";

/**
 * 真实大模型接入（OpenAI 兼容接口）。
 * 默认模型 gpt-5.4-mini；可通过 OPENAI_MODEL / OPENAI_BASE_URL 覆盖。
 * 无 OPENAI_API_KEY 时，ai-client.ts 回落到 mock-ai，保证演示与测试不断网可用。
 */
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-5.4-mini";
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";

export function hasOpenAI(): boolean {
  return Boolean(OPENAI_API_KEY);
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

async function chatJson(schemaName: string, schema: object, system: string, user: string): Promise<unknown> {
  const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: schemaName, strict: true, schema },
      },
      reasoning_effort: "medium",
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`OpenAI 请求失败 (${response.status}): ${detail.slice(0, 200)}`);
  }

  const payload = (await response.json()) as ChatCompletionResponse;
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI 返回内容为空");
  }

  return JSON.parse(content);
}

// Structured Outputs 要求：additionalProperties:false，所有字段 required，不含 min/maxLength 等。
const extractSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    occurredAt: { type: "string" },
    location: { type: "string" },
    people: { type: "array", items: { type: "string" } },
    emotions: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
    uncertainFields: { type: "array", items: { type: "string" } },
  },
  required: ["title", "occurredAt", "location", "people", "emotions", "summary", "uncertainFields"],
  additionalProperties: false,
} as const;

const bookSchema = {
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

export async function extractMemoryLive(request: MemoryExtractRequest): Promise<MemoryExtractResponse> {
  const system = `${memoryExtractPrompt}
只输出 JSON。把拿不准的字段标记为待确认（值以“待确认”开头），并把对应 key 放入 uncertainFields（仅允许 title/occurredAt/location/people/emotions/summary）。不得编造家庭事实。`;

  const parsed = (await chatJson(
    "memory_extract",
    extractSchema,
    system,
    request.content,
  )) as {
    title: string;
    occurredAt: string;
    location: string;
    people: string[];
    emotions: string[];
    summary: string;
    uncertainFields: string[];
  };

  const memory = {
    id: `memory-live-${Date.now()}`,
    planetId: request.planetId,
    title: parsed.title,
    occurredAt: parsed.occurredAt,
    location: parsed.location,
    people: parsed.people,
    emotions: parsed.emotions,
    visibility: request.visibility,
    summary: parsed.summary,
  };

  return {
    memory,
    suggestion: { ...parsed },
    sourceText: request.content,
    status: "needs_confirmation",
  };
}

export async function generateBookLive(request: BookGenerateRequest): Promise<BookGenerateResponse> {
  const selectedMemories = request.sourceMemoryIds
    .map((id) => memoryStars.find((memory) => memory.id === id))
    .filter(Boolean) as typeof memoryStars;
  const memories = selectedMemories.length > 0 ? selectedMemories : [demoSession.memoryTemplate, demoSession.comparisonMemory];

  const memoryBrief = memories
    .map((memory) => `- ${memory.title}（${memory.occurredAt} · ${memory.location} · ${memory.people.join("、")}）：${memory.summary}`)
    .join("\n");

  const system = `${bookPrompt}
只输出 JSON。章节正文必须基于上面给出的来源记忆，不得编造。每个章节都要能追溯到来源。`;

  const parsed = (await chatJson(
    "book_generate",
    bookSchema,
    system,
    `主题：${request.themeTemplateKey}\n来源记忆：\n${memoryBrief}\n\n请生成一页家书草稿。`,
  )) as { title: string; intro: string; sections: Array<{ title: string; body: string }> };

  const sourceMemoryIds = memories.map((memory) => memory.id);
  const sections = parsed.sections.map((section) => ({
    title: section.title,
    body: section.body,
    sourceMemoryIds,
  }));

  const draft = {
    id: `book-live-${Date.now()}`,
    title: parsed.title,
    sourceRange: request.sourceRange,
    themeTemplateKey: request.themeTemplateKey,
    sourceMemoryIds,
    intro: parsed.intro,
    chapters: sections.map((section) => ({
      title: section.title,
      sourceMemoryIds: section.sourceMemoryIds,
    })),
  };

  return {
    draft,
    body: sections.map((section) => section.body).join("\n\n"),
    sections,
    status: "draft",
  };
}
