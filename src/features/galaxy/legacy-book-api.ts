export type LegacyBookSourceRange = "single_planet" | "binary_system" | "family_galaxy" | "memorial";
export type LegacyBookVisibility = "private" | "family" | "selected";

export type LegacyBookSection = {
  title: string;
  body: string;
  sourceMemoryIds?: string[];
};

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
  body: string;
  sections: LegacyBookSection[];
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
  return requestJson<LegacyBookDetail>(`/api/books/${bookId}`, { method: "GET" });
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
