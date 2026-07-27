export type MemoryAiInput = {
  sourceText: string;
  assetIds: string[];
  occurredAtLabel?: string;
};

export type MemoryAiDraft = {
  title: string;
  summary: string;
  locationLabel: string | null;
  people: string[];
  emotions: string[];
  uncertainFields: string[];
};

export type ImageAiInput = {
  imageUrl: string;
};

export type ImageDescription = {
  description: string;
  uncertainFields: string[];
};

export type EmbedAiInput = {
  input: string;
};

export type ResonanceAiInput = {
  sourceText: string;
  targetText: string;
};

export type ResonanceExplanation = {
  explanation: string;
  uncertainFields: string[];
};

export type BookAiInput = {
  themeTemplateKey: string;
  memories: Array<{
    id: string;
    title: string;
    summary: string;
  }>;
};

export type GeneratedBook = {
  title: string;
  intro: string;
  sections: Array<{
    title: string;
    body: string;
  }>;
};

export type AudioAiInput = {
  audio: Blob;
  fileName: string;
};

export type Transcript = {
  text: string;
};

export interface AiProvider {
  extractMemory(input: MemoryAiInput): Promise<MemoryAiDraft>;
  describeImage(input: ImageAiInput): Promise<ImageDescription>;
  transcribeAudio(input: AudioAiInput): Promise<Transcript>;
  embed(input: EmbedAiInput): Promise<number[]>;
  explainResonance(input: ResonanceAiInput): Promise<ResonanceExplanation>;
  generateBook(input: BookAiInput): Promise<GeneratedBook>;
}
