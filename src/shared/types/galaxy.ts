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
