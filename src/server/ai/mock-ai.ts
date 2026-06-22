import { bookDrafts, memoryStars, resonanceTracks } from "@/shared/mock/galaxy-data";
import { demoSession } from "@/shared/mock/demo-session";
import type {
  BookGenerateRequest,
  BookGenerateResponse,
  MemoryExtractRequest,
  MemoryExtractResponse,
  MemoryStar,
  ResonanceScanRequest,
  ResonanceScanResponse,
} from "@/shared/types/galaxy";

function inferOccurredAt(content: string) {
  if (content.includes("除夕") || content.includes("过年")) return "2018 年除夕";
  if (content.includes("生日")) return "2020 年生日当天";
  return "待确认时间";
}

function inferLocation(content: string) {
  if (content.includes("新房") || content.includes("客厅")) return "新房客厅";
  if (content.includes("云南")) return "云南";
  return "待确认地点";
}

function inferPeople(content: string) {
  const people = ["妈妈", "我", "孩子", "全家人"].filter((person) => content.includes(person));
  return people.length > 0 ? people : ["待确认人物"];
}

function inferEmotions(content: string) {
  if (content.includes("安心") || content.includes("安定")) return ["安心", "团圆"];
  if (content.includes("感动")) return ["感动"];
  return ["待确认情绪"];
}

function inferTitle(content: string) {
  if (content.includes("除夕")) return "新家里的第一个除夕";
  if (content.includes("旅行")) return "一次家庭旅行";
  return "刚点亮的一颗记忆星";
}

function inferSummary(content: string) {
  const trimmed = content.trim();
  return trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed;
}

export async function extractMemory(request: MemoryExtractRequest): Promise<MemoryExtractResponse> {
  const occurredAt = inferOccurredAt(request.content);
  const location = inferLocation(request.content);
  const people = inferPeople(request.content);
  const emotions = inferEmotions(request.content);
  const title = inferTitle(request.content);
  const summary = inferSummary(request.content);
  const uncertainFields = [occurredAt, location, people[0], emotions[0]]
    .map((field, index) => ({ field, key: ["occurredAt", "location", "people", "emotions"][index] }))
    .filter((item) => item.field.startsWith("待确认"))
    .map((item) => item.key);

  return {
    memory: {
      id: `memory-draft-${Date.now()}`,
      planetId: request.planetId,
      title,
      occurredAt,
      location,
      people,
      emotions,
      visibility: request.visibility,
      summary,
    },
    suggestion: {
      title,
      occurredAt,
      location,
      people,
      emotions,
      summary,
      uncertainFields,
    },
    sourceText: request.content,
    status: "needs_confirmation",
  };
}

function buildBreakdown(memory: MemoryStar, target: MemoryStar) {
  return {
    time: memory.occurredAt === target.occurredAt ? 0.96 : 0.48,
    people: memory.people.some((person) => target.people.includes(person)) ? 0.92 : 0.36,
    location: memory.location === target.location ? 0.94 : 0.4,
    semantic: memory.title.includes("除夕") || target.title.includes("除夕") ? 0.9 : 0.5,
  };
}

export async function scanResonance(request: ResonanceScanRequest): Promise<ResonanceScanResponse> {
  const currentMemory =
    memoryStars.find((memory) => memory.id === request.memoryId) ?? demoSession.memoryTemplate;
  const comparedMemory = demoSession.comparisonMemory;
  const breakdown = buildBreakdown(currentMemory, comparedMemory);

  return {
    candidate: {
      ...resonanceTracks[0],
      sourceMemoryIds: [currentMemory.id, comparedMemory.id],
      score: Number(((breakdown.time + breakdown.people + breakdown.location + breakdown.semantic) / 4).toFixed(2)),
      status: "candidate",
      reason: "时间、地点与家庭成员高度重合，语义上都指向新家除夕这一共同家庭时刻。",
    },
    comparedMemories: [currentMemory, comparedMemory],
    breakdown,
    requiresConfirmation: true,
  };
}

export async function generateBook(request: BookGenerateRequest): Promise<BookGenerateResponse> {
  const selectedMemories = request.sourceMemoryIds
    .map((id) => memoryStars.find((memory) => memory.id === id))
    .filter(Boolean) as MemoryStar[];
  const fallbackMemories = selectedMemories.length > 0 ? selectedMemories : [demoSession.memoryTemplate, demoSession.comparisonMemory];
  const draft = {
    ...bookDrafts[0],
    id: `book-draft-${Date.now()}`,
    themeTemplateKey: request.themeTemplateKey,
    sourceRange: request.sourceRange,
    sourceMemoryIds: fallbackMemories.map((memory) => memory.id),
    title:
      request.themeTemplateKey === "travel"
        ? "被同一阵风记住的旅程"
        : "我们家的第一个新房除夕",
    intro: "这页家书只使用已确认的记忆星来源，先展示共同记住的时刻，再分别保留不同视角。",
  };

  return {
    draft,
    body: `${fallbackMemories[0].title} 是这页家书的起点。${fallbackMemories
      .map((memory) => memory.summary)
      .join("；")}`,
    sections: [
      {
        title: "共同记住的一天",
        body: "AI 先整理出时间、地点和人物的重合，再由用户确认这条共鸣是否成立。",
        sourceMemoryIds: fallbackMemories.map((memory) => memory.id),
      },
      {
        title: "来自妈妈的视角",
        body: fallbackMemories[0]?.summary ?? demoSession.memoryTemplate.summary,
        sourceMemoryIds: [fallbackMemories[0]?.id ?? demoSession.memoryTemplate.id],
      },
      {
        title: "来自我的视角",
        body: fallbackMemories[1]?.summary ?? demoSession.comparisonMemory.summary,
        sourceMemoryIds: [fallbackMemories[1]?.id ?? demoSession.comparisonMemory.id],
      },
    ],
    status: "draft",
  };
}
