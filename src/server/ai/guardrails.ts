import type {
  BookGenerateRequest,
  BookGenerateResponse,
  MemoryExtractResponse,
  ResonanceScanResponse,
} from "@/shared/types/galaxy";
import {
  isMemoryExtractResponse,
  type ReviewableMemoryExtractResponse,
} from "@/server/ai/schemas";

export function ensureMemoryNeedsConfirmation(response: MemoryExtractResponse): ReviewableMemoryExtractResponse {
  if (!isMemoryExtractResponse(response)) {
    throw new Error("AI 记忆整理缺少可核对的不确定字段。");
  }

  return {
    ...response,
    status: "needs_confirmation" as const,
  };
}

export function ensureShareableBook(response: BookGenerateResponse) {
  return {
    ...response,
    status: "ready_to_share" as const,
  };
}

export function ensureSourceTrace(request: BookGenerateRequest, response: BookGenerateResponse) {
  const draftIds = new Set(response.draft.sourceMemoryIds);
  const sectionIds = response.sections.flatMap((section) => section.sourceMemoryIds);
  const missing = request.sourceMemoryIds.filter(
    (memoryId) => !draftIds.has(memoryId) && !sectionIds.includes(memoryId),
  );

  if (missing.length > 0) {
    throw new Error(`生成结果缺少来源标识: ${missing.join(", ")}`);
  }

  return response;
}

export function ensureResonanceCandidate(response: ResonanceScanResponse) {
  return {
    ...response,
    requiresConfirmation: true,
    candidate: {
      ...response.candidate,
      status: "candidate" as const,
    },
  };
}
