import { DomainError } from "../domain-error";

export type AudioMetadataParser = {
  parseBuffer: (
    bytes: Uint8Array,
    fileInfo: { mimeType: string; size: number },
    options: { duration: true; skipCovers: true },
  ) => Promise<{ format: { duration?: number } }>;
};

const MAX_DURATION_MS = 600_000;
const PARSER_MIME_TYPES: Record<string, string> = {
  "audio/mpeg": "audio/mpeg",
  "audio/x-m4a": "audio/m4a",
  "audio/wav": "audio/wav",
};
const PARSER_OPTIONS = { duration: true, skipCovers: true } as const;

async function getDefaultParser(): Promise<AudioMetadataParser> {
  const { parseBuffer } = await import("music-metadata");
  return { parseBuffer };
}

export async function extractAudioMetadata(input: {
  bytes: Uint8Array;
  mimeType: string;
  parser?: AudioMetadataParser;
}) {
  let metadata: { format: { duration?: number } };

  try {
    const parser = input.parser ?? await getDefaultParser();

    metadata = await parser.parseBuffer(
      input.bytes,
      {
        mimeType: PARSER_MIME_TYPES[input.mimeType] ?? input.mimeType,
        size: input.bytes.byteLength,
      },
      PARSER_OPTIONS,
    );
  } catch (error) {
    if (error instanceof DomainError) {
      throw error;
    }

    throw new DomainError("AUDIO_METADATA_INVALID", 422);
  }

  const duration = metadata.format.duration;

  if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) {
    throw new DomainError("AUDIO_METADATA_INVALID", 422);
  }

  const rawDurationMs = duration * 1_000;

  if (rawDurationMs > MAX_DURATION_MS) {
    throw new DomainError("AUDIO_DURATION_EXCEEDED", 422);
  }

  return { durationMs: Math.round(rawDurationMs) };
}
