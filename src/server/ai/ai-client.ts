import type {
  BookGenerateRequest,
  BookGenerateResponse,
  MemoryExtractRequest,
  MemoryExtractResponse,
  ResonanceScanRequest,
  ResonanceScanResponse,
} from "@/shared/types/galaxy";

import { generateBook, extractMemory, scanResonance } from "./mock-ai";
import { extractMemoryLive, generateBookLive, hasOpenAI } from "./openai-client";

// 共鸣扫描保留 Mock（真实实现需要 embedding/向量检索，属 P1，见开发方案.md 2.2）。
// 记忆抽取与家书生成在 OPENAI_API_KEY 存在时走真实 gpt-5.4-mini，否则回落 Mock。

export async function extractMemoryWithFallback(
  request: MemoryExtractRequest,
): Promise<MemoryExtractResponse> {
  if (!hasOpenAI()) return extractMemory(request);
  return extractMemoryLive(request);
}

export async function scanResonanceWithFallback(
  request: ResonanceScanRequest,
): Promise<ResonanceScanResponse> {
  return scanResonance(request);
}

export async function generateBookWithFallback(
  request: BookGenerateRequest,
): Promise<BookGenerateResponse> {
  if (!hasOpenAI()) return generateBook(request);
  return generateBookLive(request);
}
