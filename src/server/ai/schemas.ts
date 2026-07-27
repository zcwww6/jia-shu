import type {
  BookGenerateRequest,
  BookGenerateResponse,
  MemoryExtractRequest,
  MemoryExtractResponse,
  MemoryExtractSuggestion,
  MemoryStar,
  PublishBookRequest,
  ResonanceScanRequest,
  ResonanceScanResponse,
} from "@/shared/types/galaxy";

export type ReviewableMemoryExtractResponse = Omit<MemoryExtractResponse, "status"> & {
  status: "needs_confirmation";
};

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
  return (
    isMemoryStar(candidate.memory) &&
    isMemoryExtractSuggestion(candidate.suggestion) &&
    typeof candidate.sourceText === "string" &&
    (candidate.status === "needs_confirmation" || candidate.status === "confirmed")
  );
}

export function isReviewableMemoryExtractResponse(value: unknown): value is ReviewableMemoryExtractResponse {
  return isMemoryExtractResponse(value) && value.status === "needs_confirmation";
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

function isMemoryStar(value: unknown): value is MemoryStar {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === "string" &&
    typeof value.planetId === "string" &&
    typeof value.title === "string" &&
    typeof value.occurredAt === "string" &&
    typeof value.location === "string" &&
    stringArray(value.people) &&
    stringArray(value.emotions) &&
    isVisibility(value.visibility) &&
    typeof value.summary === "string"
  );
}

function isMemoryExtractSuggestion(value: unknown): value is MemoryExtractSuggestion {
  if (!isRecord(value)) return false;

  return (
    typeof value.title === "string" &&
    typeof value.occurredAt === "string" &&
    typeof value.location === "string" &&
    stringArray(value.people) &&
    stringArray(value.emotions) &&
    typeof value.summary === "string" &&
    stringArray(value.uncertainFields)
  );
}

function isVisibility(value: unknown) {
  return value === "private" || value === "family" || value === "selected" || value === "public";
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
