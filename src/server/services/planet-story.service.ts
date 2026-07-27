import { findPlanetStory } from "@/server/db/galaxy-repo";
import { DomainError } from "@/server/domain-error";
import {
  getPlanetPresentationType,
  type PersistedPlanetLifeState,
  type Planet,
  type PlanetType,
  type Visibility,
} from "@/shared/types/galaxy";

type StoryResonanceRecord = {
  id: string;
  status?: "candidate" | "confirmed" | "rejected";
  sourceMemoryId?: string;
  targetMemoryId?: string;
  sourceMemory?: { planetId: string };
  targetMemory?: { planetId: string };
  score?: number;
  reason?: string;
};

type StoryBookMemoryRecord = {
  id: string;
};

export type PlanetStoryMemoryRecord = {
  id: string;
  title: string | null;
  summary: string | null;
  sourceText: string;
  occurredAtLabel: string | null;
  status: string;
  createdAt: Date;
  resonanceSources: StoryResonanceRecord[];
  resonanceTargets: StoryResonanceRecord[];
  bookMemories: StoryBookMemoryRecord[];
};

export type PlanetStoryRecord = {
  id: string;
  name: string;
  type: PlanetType;
  lifeState: PersistedPlanetLifeState;
  visibility: Visibility;
  role: string | null;
  theme: string | null;
  summary: string | null;
  positionX: number | null;
  positionY: number | null;
  memories: PlanetStoryMemoryRecord[];
};

export type PlanetStoryMemory = {
  id: string;
  title: string | null;
  summary: string | null;
  sourceText: string;
  occurredAtLabel: string | null;
  status: "draft" | "needs_confirmation" | "confirmed";
  createdAt: string;
};

export type PlanetStoryReadModel = {
  planet: Planet;
  memories: PlanetStoryMemory[];
  confirmedResonances: ConfirmedStoryResonance[];
};

export type ConfirmedStoryResonance = {
  id: string;
  sourceMemoryId: string;
  targetMemoryId: string;
  sourcePlanetId: string;
  targetPlanetId: string;
  score: number;
  reason: string;
};

export type PlanetStoryServiceDeps = {
  findPlanetStory: (userId: string, planetId: string) => Promise<PlanetStoryRecord | null>;
};

const defaultDeps: PlanetStoryServiceDeps = {
  findPlanetStory,
};

/**
 * Creates the authenticated planet-story projection. A missing or out-of-scope
 * planet is intentionally indistinguishable from a missing planet so no
 * administrator can discover another family's records by id.
 */
export async function getPlanetStory(
  userId: string | null | undefined,
  planetId: string,
  deps: PlanetStoryServiceDeps = defaultDeps,
): Promise<PlanetStoryReadModel> {
  if (!userId) {
    throw new DomainError("UNAUTHENTICATED", 401, "请先登录后再查看星球故事。");
  }

  const record = await deps.findPlanetStory(userId, planetId);

  if (!record) {
    throw new DomainError("NOT_FOUND", 404, "星球不存在或无权访问。");
  }

  const memories = record.memories
    .filter(isStoryMemory)
    .map(mapStoryMemory);
  const confirmedResonances = mapConfirmedResonances(record, memories);

  return {
    planet: mapStoryPlanet(record, memories),
    memories,
    confirmedResonances,
  };
}

function isStoryMemory(memory: PlanetStoryMemoryRecord): memory is PlanetStoryMemoryRecord & {
  status: "draft" | "needs_confirmation" | "confirmed";
} {
  return (
    memory.status === "draft" ||
    memory.status === "needs_confirmation" ||
    memory.status === "confirmed"
  );
}

function mapStoryMemory(
  memory: PlanetStoryMemoryRecord & { status: "draft" | "needs_confirmation" | "confirmed" },
): PlanetStoryMemory {
  return {
    id: memory.id,
    title: memory.title,
    summary: memory.summary,
    sourceText: memory.sourceText,
    occurredAtLabel: memory.occurredAtLabel,
    status: memory.status,
    createdAt: memory.createdAt.toISOString(),
  };
}

function mapConfirmedResonances(
  record: PlanetStoryRecord,
  memories: PlanetStoryMemory[],
): ConfirmedStoryResonance[] {
  const confirmedMemoryIds = new Set(
    memories.filter((memory) => memory.status === "confirmed").map((memory) => memory.id),
  );
  const resonances = new Map<string, ConfirmedStoryResonance>();

  for (const memory of record.memories) {
    if (!confirmedMemoryIds.has(memory.id)) continue;

    for (const resonance of [...memory.resonanceSources, ...memory.resonanceTargets]) {
      const sourcePlanetId = resonance.sourceMemory?.planetId;
      const targetPlanetId = resonance.targetMemory?.planetId;

      if (
        resonance.status !== "confirmed"
        || !resonance.sourceMemoryId
        || !resonance.targetMemoryId
        || !sourcePlanetId
        || !targetPlanetId
        || typeof resonance.score !== "number"
        || !Number.isFinite(resonance.score)
        || typeof resonance.reason !== "string"
        || !resonance.reason.trim()
        || resonances.has(resonance.id)
      ) {
        continue;
      }

      resonances.set(resonance.id, {
        id: resonance.id,
        sourceMemoryId: resonance.sourceMemoryId,
        targetMemoryId: resonance.targetMemoryId,
        sourcePlanetId,
        targetPlanetId,
        score: resonance.score,
        reason: resonance.reason.trim(),
      });
    }
  }

  return [...resonances.values()];
}

function mapStoryPlanet(record: PlanetStoryRecord, memories: PlanetStoryMemory[]): Planet {
  const presentationType = getPlanetPresentationType(record);
  const fallback = presentationFallback(record.type);
  const confirmedMemoryIds = new Set(
    memories.filter((memory) => memory.status === "confirmed").map((memory) => memory.id),
  );
  const confirmedRecords = record.memories.filter((memory) => confirmedMemoryIds.has(memory.id));
  const resonanceIds = new Set<string>();
  const bookMemoryIds = new Set<string>();

  for (const memory of confirmedRecords) {
    for (const resonance of memory.resonanceSources) {
      if (resonance.status === "confirmed") {
        resonanceIds.add(resonance.id);
      }
    }

    for (const resonance of memory.resonanceTargets) {
      if (resonance.status === "confirmed") {
        resonanceIds.add(resonance.id);
      }
    }

    for (const bookMemory of memory.bookMemories) {
      bookMemoryIds.add(bookMemory.id);
    }
  }

  return {
    id: record.id,
    name: record.name,
    type: record.type,
    lifeState: presentationType === "memorial" ? "memorial" : record.lifeState,
    visibility: record.visibility,
    role: record.role ?? fallback.role,
    theme: record.theme ?? fallback.theme,
    summary: record.summary ?? fallback.summary,
    position: {
      x: record.positionX ?? 0,
      y: record.positionY ?? 0,
    },
    stats: {
      memoryStars: confirmedMemoryIds.size,
      resonanceTracks: resonanceIds.size,
      bookDrafts: bookMemoryIds.size,
    },
  };
}

function presentationFallback(type: PlanetType) {
  if (type === "other" || type === "memorial") {
    return {
      role: "家人星球",
      theme: "中性星域",
      summary: "这颗星球还没有被写下的故事。",
    };
  }

  return {
    role: "未设置身份",
    theme: "未设置主题",
    summary: "这颗星球还没有被写下的故事。",
  };
}
