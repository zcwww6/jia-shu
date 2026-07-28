export type LegacyBookSourceRange = "single_planet" | "binary_system" | "family_galaxy" | "memorial";
export type LegacyBookVisibility = "private" | "family" | "selected";

import type { FamilyBookMedia, FamilyBookSection } from "@/shared/types/family-book";

export type LegacyBookSection = FamilyBookSection;

export type LegacyBookDraft = {
  id?: string;
  title?: string;
  sourceMemoryIds: string[];
  sourceRange: LegacyBookSourceRange;
  themeTemplateKey: string;
  sourceLabels?: Record<string, string>;
  intro?: string;
  chapters?: Array<{ title: string; sourceMemoryIds: string[] }>;
};

export type LegacyCreatedBook = {
  id: string;
  title: string;
  status: "ready";
  draft: LegacyBookDraft;
  body: string;
  sections: LegacyBookSection[];
};

export type LegacyBookDetail = {
  id: string;
  title: string;
  intro: string;
  body: string;
  sections: LegacyBookSection[];
  sourceLabels: Record<string, string>;
  media: FamilyBookMedia[];
  status: "draft" | "ready" | "published" | "archived";
  version: number;
  visibility: LegacyBookVisibility;
};

export type LegacyBookCreateInput = {
  title?: string;
  sourceMemoryIds: string[];
  sourceRange: LegacyBookSourceRange;
  themeTemplateKey: string;
  visibility: LegacyBookVisibility;
};

export type LegacyBookUpdateInput = {
  version: number;
  title?: string;
  body?: string;
};

export type LegacyBookUpdateResponse = Pick<LegacyBookDetail, "id" | "title" | "body" | "version">;

export type LegacyBookShareOptions = {
  showBody: boolean;
  showSourceTitles: boolean;
  showOriginalText: boolean;
};

export type LegacyBookShare = {
  token: string;
  url: string;
  createdAt?: string;
};

export type LegacyBookShareList = { shares: LegacyBookShare[] };
export type LegacyBookShareRevokeResponse = { token: string; revoked: true };

export class LegacyBookApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "LegacyBookApiError";
  }
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));

  if (!response.ok || response.status === 202) {
    throw new LegacyBookApiError(
      typeof body?.message === "string" ? body.message : "请求失败，请稍后重试。",
      response.status,
      typeof body?.code === "string" ? body.code : undefined,
    );
  }

  return body as T;
}

function readSourceLabels(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value).filter(([memoryId, title]) => (
      memoryId.trim().length > 0 && typeof title === "string"
    )),
  );
}

function parseLegacyBookDetail(book: LegacyBookDetail): LegacyBookDetail {
  return {
    ...book,
    intro: typeof book.intro === "string" ? book.intro.trim() : "",
    sourceLabels: readSourceLabels(book.sourceLabels),
    media: readBookMedia(book.media),
  };
}

function readBookMedia(value: unknown): FamilyBookMedia[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const kind = record.kind;
    const title = typeof record.title === "string" ? record.title.trim() : "";
    const mimeType = typeof record.mimeType === "string" ? record.mimeType.trim() : "";
    const originalName = typeof record.originalName === "string" ? record.originalName.trim() : "";
    const url = typeof record.url === "string" ? record.url.trim() : "";

    if ((kind !== "image" && kind !== "audio") || !id || !title || !mimeType || !originalName || url !== `/api/assets/${id}/content`) {
      return [];
    }

    return [{
      id,
      kind,
      title,
      caption: typeof record.caption === "string" ? record.caption.trim() : "",
      mimeType,
      originalName,
      url,
      width: validNullableNumber(record.width),
      height: validNullableNumber(record.height),
      durationMs: validNullableNumber(record.durationMs),
    }];
  });
}

function validNullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function createLegacyBook(input: LegacyBookCreateInput, idempotencyKey: string) {
  return requestJson<LegacyCreatedBook>("/api/books", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(input),
  });
}

export function getLegacyBook(bookId: string) {
  return requestJson<LegacyBookDetail>(`/api/books/${bookId}`, { method: "GET" })
    .then(parseLegacyBookDetail);
}

export function updateLegacyBook(bookId: string, input: LegacyBookUpdateInput) {
  return requestJson<LegacyBookUpdateResponse>(`/api/books/${bookId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function createLegacyBookShare(
  bookId: string,
  options: LegacyBookShareOptions,
  idempotencyKey: string,
) {
  return requestJson<LegacyBookShare>(`/api/books/${bookId}/shares`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(options),
  });
}

export function listLegacyBookShares(bookId: string) {
  return requestJson<LegacyBookShareList>(`/api/books/${bookId}/shares`, { method: "GET" });
}

export function revokeLegacyBookShare(bookId: string, token: string, idempotencyKey: string) {
  return requestJson<LegacyBookShareRevokeResponse>(`/api/books/${bookId}/shares/${token}/revoke`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
  });
}
