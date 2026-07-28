export type GalaxyZoneKey =
  | "galaxy"
  | "privacy"
  | "memorial"
  | "workshop"
  | "memories"
  | "resonance"
  | "themes"
  | "books";

export type Visibility = "private" | "family" | "selected" | "public";

export type PlanetType =
  | "self"
  | "parent"
  | "child"
  | "memorial"
  | "public"
  | "partner"
  | "other";

export type PersistedPlanetLifeState = "active" | "memorial";

export type PlanetLifeState = "ACTIVE" | "MEMORIAL";

export type PlanetVisualKind =
  | "self"
  | "parent"
  | "child"
  | "partner"
  | "ancestor"
  | "other";

function normalizePlanetType(type: PlanetType): PlanetVisualKind {
  if (type === "self" || type === "parent" || type === "child" || type === "partner") {
    return type;
  }

  return type === "memorial" ? "ancestor" : "other";
}

export function normalizePlanetLifeState(input: {
  type: PlanetType;
  lifeState: PersistedPlanetLifeState | null;
}) {
  if (input.lifeState === "memorial" || input.type === "memorial") {
    return { lifeState: "MEMORIAL" as const, visualKind: "ancestor" as const };
  }

  return {
    lifeState: "ACTIVE" as const,
    visualKind: normalizePlanetType(input.type),
  };
}

export function getPlanetPresentationType(input: {
  type: PlanetType;
  lifeState?: PersistedPlanetLifeState | null;
}): PlanetType {
  return normalizePlanetLifeState({
    type: input.type,
    lifeState: input.lifeState ?? null,
  }).lifeState === "MEMORIAL"
    ? "memorial"
    : input.type;
}

export interface PlanetReadModel {
  id: string;
  userId: string;
  galaxyId: string;
  name: string;
  type: PlanetType;
  lifeState: PersistedPlanetLifeState;
  visualKind: PlanetVisualKind;
  visibility: Visibility;
  role: string | null;
  theme: string | null;
  summary: string | null;
  positionX: number | null;
  positionY: number | null;
  coverAssetId: string | null;
  version: number;
  archivedAt: string | null;
  deletedAt: string | null;
  memoryCount: number;
  resonanceCount: number;
  bookCount: number;
}

export type PlanetReadModelInput = Omit<
  PlanetReadModel,
  "lifeState" | "visualKind"
> & {
  lifeState: PersistedPlanetLifeState | null;
};

export function createPlanetReadModel(input: PlanetReadModelInput): PlanetReadModel {
  const normalized = normalizePlanetLifeState(input);

  return {
    ...input,
    lifeState: normalized.lifeState === "MEMORIAL" ? "memorial" : "active",
    visualKind: normalized.visualKind,
  };
}

export type PlanetLinkKind =
  | "family"
  | "resonance"
  | "inheritance"
  | "privacy"
  | "public"
  | "custom";

export type PlanetLinkStatus = "candidate" | "confirmed" | "hidden";

export type PlanetLinkRule =
  | "manual"
  | "sharedMemory"
  | "relationship"
  | "aiCandidate"
  | "theme";

export interface GalaxyZone {
  key: GalaxyZoneKey;
  label: string;
  href: string;
  description: string;
}

export interface Planet {
  id: string;
  name: string;
  type: PlanetType;
  lifeState?: PersistedPlanetLifeState;
  role: string;
  visibility: Visibility;
  theme: string;
  position: {
    x: number;
    y: number;
  };
  stats: {
    memoryStars: number;
    resonanceTracks: number;
    bookDrafts: number;
  };
  summary: string;
  version?: number;
  coverAssetId?: string | null;
}

export interface PlanetLink {
  id: string;
  sourcePlanetId: string;
  targetPlanetId: string;
  kind: PlanetLinkKind;
  status: PlanetLinkStatus;
  label: string;
  visibility: Visibility;
  strength: number;
  rule: PlanetLinkRule;
}

export interface MemoryStar {
  id: string;
  planetId: string;
  title: string;
  occurredAt: string;
  location: string;
  people: string[];
  emotions: string[];
  visibility: Visibility;
  summary: string;
}

export interface StoryNode {
  id: string;
  planetId: string;
  year: string;
  title: string;
  summary: string;
  sourceLabel: string;
}

export interface ResonanceTrack {
  id: string;
  title: string;
  sourceMemoryIds: string[];
  score: number;
  status: "candidate" | "confirmed" | "rejected";
  reason: string;
}

export interface BookDraft {
  id: string;
  title: string;
  sourceRange: "single_planet" | "binary_system" | "family_galaxy" | "memorial";
  themeTemplateKey: string;
  sourceMemoryIds: string[];
  intro: string;
  chapters: Array<{
    title: string;
    sourceMemoryIds: string[];
  }>;
}

export interface MemoryExtractRequest {
  planetId: string;
  visibility: Visibility;
  content: string;
}

export interface MemoryExtractSuggestion {
  title: string;
  occurredAt: string;
  location: string;
  people: string[];
  emotions: string[];
  summary: string;
  uncertainFields: string[];
}

export interface MemoryExtractResponse {
  memory: MemoryStar;
  suggestion: MemoryExtractSuggestion;
  sourceText: string;
  status: "needs_confirmation" | "confirmed";
}

export interface ResonanceScoreBreakdown {
  time: number;
  people: number;
  location: number;
  semantic: number;
}

export interface ResonanceScanRequest {
  memoryId: string;
}

export interface ResonanceScanResponse {
  candidate: ResonanceTrack;
  comparedMemories: MemoryStar[];
  breakdown: ResonanceScoreBreakdown;
  requiresConfirmation: boolean;
}

export interface BookGenerateRequest {
  sourceMemoryIds: string[];
  sourceRange: BookDraft["sourceRange"];
  themeTemplateKey: string;
}

export interface GeneratedBookSection {
  title: string;
  body: string;
  sourceMemoryIds: string[];
}

export interface BookGenerateResponse {
  draft: BookDraft;
  body: string;
  sections: GeneratedBookSection[];
  status: "draft" | "ready_to_share";
}

export interface ShareConfirmationPayload {
  showBody: boolean;
  showSourceTitles: boolean;
  showOriginalText: boolean;
}

export interface PublishBookRequest {
  draft: BookDraft;
  body: string;
  sections: GeneratedBookSection[];
  share: ShareConfirmationPayload;
}

export interface PublishBookResponse {
  token: string;
  url: string;
}

export type StoredSharedBookDraft = BookDraft & {
  sourceLabels?: Record<string, string>;
};

export type StoredSharedBookSection = GeneratedBookSection & {
  sourceLabels?: string[];
};

export interface StoredSharedBook {
  token: string;
  draft: StoredSharedBookDraft;
  body: string;
  sections: StoredSharedBookSection[];
  share: ShareConfirmationPayload;
  createdAt: string;
}
