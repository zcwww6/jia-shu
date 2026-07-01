import type {
  BookGenerateRequest,
  BookGenerateResponse,
  MemoryExtractRequest,
  MemoryExtractResponse,
  PublishBookRequest,
  ResonanceScanRequest,
  ResonanceScanResponse,
} from "@/shared/types/galaxy";

export function isMemoryExtractRequest(value: unknown): value is MemoryExtractRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MemoryExtractRequest>;
  return (
    typeof candidate.planetId === "string" &&
    typeof candidate.content === "string" &&
    typeof candidate.visibility === "string"
  );
}

export function isResonanceScanRequest(value: unknown): value is ResonanceScanRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ResonanceScanRequest>;
  return typeof candidate.memoryId === "string";
}

export function isBookGenerateRequest(value: unknown): value is BookGenerateRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BookGenerateRequest>;
  return (
    Array.isArray(candidate.sourceMemoryIds) &&
    candidate.sourceMemoryIds.every((item) => typeof item === "string") &&
    typeof candidate.sourceRange === "string" &&
    typeof candidate.themeTemplateKey === "string"
  );
}

export function isMemoryExtractResponse(value: unknown): value is MemoryExtractResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MemoryExtractResponse>;
  return !!candidate.memory && !!candidate.suggestion && typeof candidate.sourceText === "string";
}

export function isResonanceScanResponse(value: unknown): value is ResonanceScanResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ResonanceScanResponse>;
  return !!candidate.candidate && Array.isArray(candidate.comparedMemories) && !!candidate.breakdown;
}

export function isBookGenerateResponse(value: unknown): value is BookGenerateResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BookGenerateResponse>;
  return !!candidate.draft && Array.isArray(candidate.sections) && typeof candidate.body === "string";
}

export function isPublishBookRequest(value: unknown): value is PublishBookRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PublishBookRequest>;
  if (!candidate.draft || !Array.isArray(candidate.sections) || typeof candidate.body !== "string") {
    return false;
  }
  if (!candidate.share || typeof candidate.share !== "object") {
    return false;
  }
  const share = candidate.share as Partial<PublishBookRequest["share"]>;
  return (
    typeof share.showBody === "boolean" &&
    typeof share.showSourceTitles === "boolean" &&
    typeof share.showOriginalText === "boolean"
  );
}
