export type LegacyMemoryVisibility = "private" | "family" | "selected";

export type LegacyMemoryResponse = {
  id: string;
  planetId: string;
  sourceText?: string;
  title: string | null;
  summary: string | null;
  tags: string[] | null;
  occurredAtLabel: string | null;
  locationLabel: string | null;
  people: string[] | null;
  visibility: LegacyMemoryVisibility;
  allowResonance: boolean;
  allowBook: boolean;
  status: "draft" | "needs_confirmation" | "confirmed" | string;
  version: number;
  uncertainFields?: string[];
};

export type LegacyMemoryAiJob = {
  id: string;
  status: "queued" | "processing" | "succeeded" | "completed" | "failed" | string;
  errorCode?: string | null;
  error?: string | null;
};

export type CreateLegacyMemoryDraftInput = {
  planetId: string;
  sourceText: string;
  assetIds?: string[];
  visibility: LegacyMemoryVisibility;
  allowResonance?: boolean;
  allowBook?: boolean;
};

export type ConfirmLegacyMemoryInput = {
  memoryId: string;
  version: number;
  title?: string;
  summary?: string;
  tags?: string[];
  occurredAtLabel?: string | null;
  locationLabel?: string | null;
  people?: string[];
};

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      typeof body?.message === "string" ? body.message : "请求失败，请稍后重试。",
    );
  }

  return body as T;
}

function idempotentJson(body: unknown, idempotencyKey?: string): RequestInit {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey ?? crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  };
}

export function createLegacyMemoryDraft(input: CreateLegacyMemoryDraftInput, idempotencyKey?: string) {
  return requestJson<LegacyMemoryResponse>("/api/memories", idempotentJson(input, idempotencyKey));
}

export function startLegacyMemoryExtraction(memoryId: string, idempotencyKey?: string) {
  return requestJson<LegacyMemoryAiJob>(
    `/api/memories/${memoryId}/ai-jobs`,
    idempotentJson({ consent: true, purpose: "memory_extraction" }, idempotencyKey),
  );
}

export function getLegacyMemoryAiJob(jobId: string, init: Pick<RequestInit, "signal"> = {}) {
  return requestJson<LegacyMemoryAiJob>(`/api/ai-jobs/${jobId}`, { method: "GET", ...init });
}

export function getLegacyMemoryReview(memoryId: string) {
  return requestJson<LegacyMemoryResponse>(`/api/memories/${memoryId}`, { method: "GET" });
}

export function confirmLegacyMemory(input: ConfirmLegacyMemoryInput) {
  const { memoryId, version, ...changes } = input;
  return requestJson<LegacyMemoryResponse>(`/api/memories/${memoryId}/confirm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "If-Match-Version": String(version),
    },
    body: JSON.stringify({ version, ...changes }),
  });
}
