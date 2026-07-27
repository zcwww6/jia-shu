import type { PublicResonanceCandidate } from "@/server/services/resonance-public";

export type LegacyResonanceDecision = {
  id: string;
  status: "confirmed" | "rejected";
  version: number;
};

export type LegacyPendingResonance = Pick<
  PublicResonanceCandidate,
  "id" | "sourceMemoryId" | "targetMemoryId" | "score" | "reason" | "version"
>;

export type LegacyResonanceCandidate = LegacyPendingResonance & {
  status: "candidate" | "confirmed" | "rejected";
};

export type LegacyResonanceScanResponse = {
  candidates: LegacyResonanceCandidate[];
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

export function scanLegacyResonances(memoryId: string, signal?: AbortSignal) {
  return requestJson<LegacyResonanceScanResponse>("/api/resonances/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ memoryId }),
    signal,
  });
}

export function confirmLegacyResonance({ id, status, version }: LegacyResonanceDecision) {
  return requestJson<LegacyResonanceCandidate>(`/api/resonances/${id}/confirm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "If-Match-Version": String(version),
    },
    body: JSON.stringify({ status, version }),
  });
}
