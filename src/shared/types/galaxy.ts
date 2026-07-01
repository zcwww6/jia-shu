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
  | "partner";

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

export interface StoredSharedBook {
  token: string;
  draft: BookDraft;
  body: string;
  sections: GeneratedBookSection[];
  share: ShareConfirmationPayload;
  createdAt: string;
}
