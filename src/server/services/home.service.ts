import {
  getPlanetPresentationType,
  type PersistedPlanetLifeState,
  type Planet,
  type PlanetLink,
  type PlanetType,
  type Visibility,
} from "@/shared/types/galaxy";
import { findArchivedHomePlanets, findHomePlanets } from "@/server/db/galaxy-repo";

type HomeResonanceRecord = {
  id: string;
  status?: "candidate" | "confirmed" | "rejected";
  sourceMemoryId?: string;
  targetMemoryId?: string;
  sourceMemory?: { planetId: string };
  targetMemory?: { planetId: string };
  score?: number;
  reason?: string;
  version: number;
};

type HomeMemoryRecord = {
  id: string;
  title?: string | null;
  allowBook?: boolean;
  resonanceSources: HomeResonanceRecord[];
  resonanceTargets: HomeResonanceRecord[];
  bookMemories: Array<{
    id: string;
    book?: {
      id: string;
      title: string | null;
      status: "draft" | "ready" | "published" | "archived";
    };
  }>;
};

type HomeRelationshipRecord = {
  id: string;
  sourcePlanetId: string;
  targetPlanetId: string;
  relationshipType: string;
  label: string | null;
  visibility: "private" | "family" | "selected";
};

type HomePlanetRecord = {
  id: string;
  name: string;
  type: PlanetType;
  lifeState: PersistedPlanetLifeState;
  visibility: Visibility;
  role: string | null;
  theme: string | null;
  summary: string | null;
  version?: number;
  coverAssetId?: string | null;
  positionX: number | null;
  positionY: number | null;
  relationshipsFrom: HomeRelationshipRecord[];
  relationshipsTo: HomeRelationshipRecord[];
  memories: HomeMemoryRecord[];
};

type ArchivedHomePlanetRecord = Omit<HomePlanetRecord, "relationshipsFrom" | "relationshipsTo" | "memories">;

export type PendingResonanceReadModel = {
  id: string;
  sourceMemoryId: string;
  targetMemoryId: string;
  score: number;
  reason: string;
  version: number;
};

export type GrowingBookSummary = {
  id: string;
  title: string | null;
  status: "draft" | "ready";
  memoryCount: number;
};

export type EligibleBookSource = { id: string; title: string | null };

export type GalaxyReadModel = {
  planets: Planet[];
  archivedPlanets: Planet[];
  relationships: PlanetLink[];
  pendingResonances: PendingResonanceReadModel[];
  growingBooks: GrowingBookSummary[];
  eligibleBookSources: EligibleBookSource[];
};

export interface HomeServiceDeps {
  findHomePlanets: (userId: string) => Promise<HomePlanetRecord[]>;
  findArchivedHomePlanets?: (userId: string) => Promise<ArchivedHomePlanetRecord[]>;
}

const defaultDeps: HomeServiceDeps = {
  findHomePlanets,
  findArchivedHomePlanets,
};

// These anchors keep newly persisted family members inside the explorable part
// of the galaxy until an administrator chooses a precise location. They are
// intentionally spread across several orbital bands instead of the viewport
// edges, where a focused planet or HUD can obscure the node.
const FALLBACK_PLANET_POSITIONS = [
  { x: 18, y: 26 }, { x: 30, y: 70 }, { x: 50, y: 18 }, { x: 70, y: 80 },
  { x: 84, y: 58 }, { x: 18, y: 72 }, { x: 84, y: 22 }, { x: 50, y: 84 },
  { x: 14, y: 48 }, { x: 40, y: 82 }, { x: 62, y: 76 }, { x: 86, y: 44 },
  { x: 28, y: 18 }, { x: 72, y: 18 }, { x: 24, y: 52 }, { x: 76, y: 66 },
] as const;

/**
 * Produces a real read model only. It does not bootstrap a galaxy or a self
 * planet because an empty persisted galaxy must remain visibly empty.
 */
export async function getHomeData(
  userId: string | null | undefined,
  deps: HomeServiceDeps = defaultDeps,
): Promise<GalaxyReadModel> {
  if (!userId) {
    throw new Error("UNAUTHENTICATED");
  }

  const [homePlanets, archivedHomePlanets] = await Promise.all([
    deps.findHomePlanets(userId),
    deps.findArchivedHomePlanets?.(userId) ?? Promise.resolve([]),
  ]);
  const activePlanetIds = new Set(homePlanets.map((planet) => planet.id));
  const resolvedPositions = resolveHomePlanetPositions(homePlanets);

  return {
    planets: homePlanets.map((planet) => mapHomePlanet(planet, activePlanetIds, resolvedPositions.get(planet.id)!)),
    archivedPlanets: archivedHomePlanets.map((planet) => mapArchivedPlanet(planet)),
    relationships: mapRelationships(homePlanets, activePlanetIds),
    pendingResonances: mapPendingResonances(homePlanets),
    growingBooks: mapGrowingBooks(homePlanets),
    eligibleBookSources: mapEligibleBookSources(homePlanets),
  };
}

function mapArchivedPlanet(planet: ArchivedHomePlanetRecord): Planet {
  return mapHomePlanet(
    {
      ...planet,
      relationshipsFrom: [],
      relationshipsTo: [],
      memories: [],
    },
    new Set(),
    {
      x: planet.positionX ?? 50,
      y: planet.positionY ?? 50,
    },
  );
}

function mapHomePlanet(
  planet: HomePlanetRecord,
  activePlanetIds: Set<string>,
  position: { x: number; y: number },
): Planet {
  const presentationType = getPlanetPresentationType(planet);
  const fallback = presentationFallback(planet.type);

  return {
    id: planet.id,
    name: planet.name,
    type: planet.type,
    lifeState: presentationType === "memorial" ? "memorial" : planet.lifeState,
    visibility: planet.visibility,
    role: planet.role ?? fallback.role,
    theme: planet.theme ?? fallback.theme,
    summary: planet.summary ?? fallback.summary,
    ...(planet.version !== undefined ? { version: planet.version } : {}),
    ...(planet.coverAssetId !== undefined ? { coverAssetId: planet.coverAssetId } : {}),
    position,
    stats: aggregateStats(planet.memories, activePlanetIds),
  };
}

function resolveHomePlanetPositions(homePlanets: HomePlanetRecord[]) {
  const occupied = new Set(
    homePlanets
      .filter((planet) => planet.positionX !== null && planet.positionY !== null)
      .map((planet) => `${planet.positionX},${planet.positionY}`),
  );
  const positions = new Map<string, { x: number; y: number }>();
  let fallbackIndex = 0;

  for (const planet of homePlanets) {
    if (planet.positionX !== null && planet.positionY !== null) {
      positions.set(planet.id, { x: planet.positionX, y: planet.positionY });
      continue;
    }

    let candidate = fallbackPlanetPosition(fallbackIndex);
    while (occupied.has(`${candidate.x},${candidate.y}`)) {
      fallbackIndex += 1;
      candidate = fallbackPlanetPosition(fallbackIndex);
    }

    positions.set(planet.id, candidate);
    occupied.add(`${candidate.x},${candidate.y}`);
    fallbackIndex += 1;
  }

  return positions;
}

function fallbackPlanetPosition(index: number) {
  const curated = FALLBACK_PLANET_POSITIONS[index];
  if (curated) return curated;

  const gridIndex = index - FALLBACK_PLANET_POSITIONS.length;
  return {
    x: 16 + (gridIndex % 6) * 14,
    y: 16 + (Math.floor(gridIndex / 6) % 6) * 14,
  };
}

function presentationFallback(persistedType: PlanetType) {
  if (persistedType === "other" || persistedType === "memorial") {
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

function aggregateStats(memories: HomeMemoryRecord[], activePlanetIds: Set<string>) {
  const resonanceIds = new Set<string>();
  const bookMemoryIds = new Set<string>();

  for (const memory of memories) {
    for (const candidate of memory.resonanceSources) {
      if (isProjectableConfirmedResonance(candidate, activePlanetIds)) {
        resonanceIds.add(candidate.id);
      }
    }

    for (const candidate of memory.resonanceTargets) {
      if (isProjectableConfirmedResonance(candidate, activePlanetIds)) {
        resonanceIds.add(candidate.id);
      }
    }

    for (const bookMemory of memory.bookMemories) {
      bookMemoryIds.add(bookMemory.id);
    }
  }

  return {
    memoryStars: memories.length,
    resonanceTracks: resonanceIds.size,
    bookDrafts: bookMemoryIds.size,
  };
}

function mapRelationships(planets: HomePlanetRecord[], activePlanetIds: Set<string>): PlanetLink[] {
  const relationships = new Map<string, PlanetLink>();
  const resonanceIds = new Set<string>();

  for (const planet of planets) {
    for (const relationship of [...planet.relationshipsFrom, ...planet.relationshipsTo]) {
      if (relationships.has(relationship.id)) continue;

      const isManualTrack = relationship.relationshipType === "other";

      relationships.set(relationship.id, {
        id: relationship.id,
        sourcePlanetId: relationship.sourcePlanetId,
        targetPlanetId: relationship.targetPlanetId,
        kind: isManualTrack ? "custom" : "family",
        status: "confirmed",
        label: relationship.label ?? relationship.relationshipType,
        visibility: relationship.visibility,
        strength: 1,
        rule: isManualTrack ? "manual" : "relationship",
      });
    }

    for (const memory of planet.memories) {
      for (const resonance of [...memory.resonanceSources, ...memory.resonanceTargets]) {
        const endpoints = isProjectableConfirmedResonance(resonance, activePlanetIds);

        if (
          !endpoints
          || resonanceIds.has(resonance.id)
          || relationships.has(resonance.id)
        ) {
          continue;
        }

        resonanceIds.add(resonance.id);
        relationships.set(resonance.id, {
          id: resonance.id,
          sourcePlanetId: endpoints.sourcePlanetId,
          targetPlanetId: endpoints.targetPlanetId,
          kind: "resonance",
          status: "confirmed",
          label: resonance.reason?.trim() || "已确认记忆共鸣",
          visibility: "family",
          strength: endpoints.score,
          rule: "sharedMemory",
        });
      }
    }
  }

  return [...relationships.values()];
}

function isProjectableConfirmedResonance(
  resonance: HomeResonanceRecord,
  activePlanetIds: Set<string>,
) {
  const sourcePlanetId = resonance.sourceMemory?.planetId;
  const targetPlanetId = resonance.targetMemory?.planetId;

  return resonance.status === "confirmed"
    && sourcePlanetId
    && targetPlanetId
    && typeof resonance.score === "number"
    && Number.isFinite(resonance.score)
    && activePlanetIds.has(sourcePlanetId)
    && activePlanetIds.has(targetPlanetId)
    ? { sourcePlanetId, targetPlanetId, score: resonance.score }
    : null;
}

function mapPendingResonances(planets: HomePlanetRecord[]): PendingResonanceReadModel[] {
  const candidates = new Map<string, PendingResonanceReadModel>();

  for (const planet of planets) {
    for (const memory of planet.memories) {
      for (const candidate of [...memory.resonanceSources, ...memory.resonanceTargets]) {
        if (
          candidate.status !== "candidate"
          || !candidate.sourceMemoryId
          || !candidate.targetMemoryId
          || typeof candidate.score !== "number"
          || typeof candidate.reason !== "string"
          || candidates.has(candidate.id)
        ) {
          continue;
        }

        candidates.set(candidate.id, {
          id: candidate.id,
          sourceMemoryId: candidate.sourceMemoryId,
          targetMemoryId: candidate.targetMemoryId,
          score: candidate.score,
          reason: candidate.reason,
          version: candidate.version,
        });
      }
    }
  }

  return [...candidates.values()];
}

function mapGrowingBooks(planets: HomePlanetRecord[]): GrowingBookSummary[] {
  const books = new Map<string, GrowingBookSummary>();

  for (const planet of planets) {
    for (const memory of planet.memories) {
      for (const bookMemory of memory.bookMemories) {
        const book = bookMemory.book;
        if (!book || (book.status !== "draft" && book.status !== "ready")) continue;

        const current = books.get(book.id);
        if (current) {
          current.memoryCount += 1;
          continue;
        }

        books.set(book.id, {
          id: book.id,
          title: book.title,
          status: book.status,
          memoryCount: 1,
        });
      }
    }
  }

  return [...books.values()];
}

function mapEligibleBookSources(planets: HomePlanetRecord[]): EligibleBookSource[] {
  return planets.flatMap((planet) => planet.memories)
    .filter((memory) => memory.allowBook === true)
    .map((memory) => ({ id: memory.id, title: memory.title ?? null }));
}
