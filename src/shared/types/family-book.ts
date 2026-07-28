export type FamilyBookMedia = {
  id: string;
  kind: "image" | "audio";
  title: string;
  caption: string;
  mimeType: string;
  originalName: string;
  url: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
};

export type FamilyBookSection = {
  title: string;
  body: string;
  sourceMemoryIds?: string[];
};
