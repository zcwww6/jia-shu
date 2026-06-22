import type {
  BookGenerateRequest,
  BookGenerateResponse,
  MemoryExtractRequest,
  MemoryExtractResponse,
  ResonanceScanRequest,
  ResonanceScanResponse,
} from "@/shared/types/galaxy";

import { generateBook, extractMemory, scanResonance } from "./mock-ai";

const hasLiveModel = Boolean(process.env.ANTHROPIC_API_KEY);

export async function extractMemoryWithFallback(
  request: MemoryExtractRequest,
): Promise<MemoryExtractResponse> {
  if (!hasLiveModel) return extractMemory(request);
  return extractMemory(request);
}

export async function scanResonanceWithFallback(
  request: ResonanceScanRequest,
): Promise<ResonanceScanResponse> {
  if (!hasLiveModel) return scanResonance(request);
  return scanResonance(request);
}

export async function generateBookWithFallback(
  request: BookGenerateRequest,
): Promise<BookGenerateResponse> {
  if (!hasLiveModel) return generateBook(request);
  return generateBook(request);
}
