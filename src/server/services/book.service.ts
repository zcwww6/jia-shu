import { createHash, randomUUID } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { getAiProvider } from "@/server/ai/openai-client";
import { createGeneratedBook, findEligibleBookSources, findShareableBook } from "@/server/db/book-repo";
import { getPrismaClient } from "@/server/db/client";
import { prismaIdempotencyRepository } from "@/server/db/idempotency-repo";
import { createSharedBookSnapshot, revokeSharedBookSnapshot } from "@/server/db/shared-book-repo";
import { DomainError } from "@/server/domain-error";
import {
  beginIdempotentRequest,
  completeIdempotentRequest,
  executeIdempotentDbOperation,
  getExistingIdempotentRequest,
} from "@/server/services/idempotency.service";
import { createSharedBookToken } from "@/server/store/shared-books";

export const MAX_BOOK_AI_INPUT_CHARACTERS = 48_000;

export type BookScope = {
  userId: string;
  galaxyId: string;
};

export type CreateBookFromMemoriesInput = {
  title?: string;
  sourceMemoryIds: string[];
  sourceRange: "single_planet" | "binary_system" | "family_galaxy" | "memorial";
  themeTemplateKey: string;
  visibility: "private" | "family" | "selected";
  idempotencyKey: string;
};

export type BookGenerationHashInput = Omit<CreateBookFromMemoriesInput, "idempotencyKey">;

export type EligibleBookSource = {
  id: string;
  title: string | null;
  summary: string | null;
};

export type GeneratedBookSection = {
  title: string;
  body: string;
};

export type GeneratedBook = {
  title: string;
  intro: string;
  sections: GeneratedBookSection[];
};

export type TrustedBookSection = GeneratedBookSection & {
  sourceMemoryIds: string[];
};

export type TrustedBookDraft = {
  id: string;
  title: string;
  sourceRange: CreateBookFromMemoriesInput["sourceRange"];
  themeTemplateKey: string;
  sourceMemoryIds: string[];
  sourceLabels: Record<string, string>;
  intro: string;
  chapters: Array<{
    title: string;
    sourceMemoryIds: string[];
  }>;
};

export type BookCreateResponse = {
  id: string;
  title: string;
  status: "ready";
  draft: TrustedBookDraft;
  body: string;
  sections: TrustedBookSection[];
};

export type BookGenerationErrorResponse = {
  code: string;
  message: string;
};

export type BookIdempotencyStatus =
  | { kind: "started"; operationId: string }
  | {
    kind: "completed";
    operationId: string;
    response: BookCreateResponse | BookGenerationErrorResponse;
    status: number;
  }
  | { kind: "processing"; operationId: string; status: 202 }
  | { kind: "expired"; operationId: string; status: 409; recovery: "query_or_reconcile" };

export type GeneratedBookPersistence = {
  id: string;
  title: string;
  sourceRange: CreateBookFromMemoriesInput["sourceRange"];
  themeTemplateKey: string;
  visibility: CreateBookFromMemoriesInput["visibility"];
  draft: TrustedBookDraft;
  body: string;
  sections: TrustedBookSection[];
  sourceMemoryIds: string[];
};

export type CreateBookShareInput = {
  showBody: boolean;
  showSourceTitles: boolean;
  showOriginalText: boolean;
  idempotencyKey: string;
};

export type ShareableBookRecord = {
  id: string;
  title: string | null;
  draft: unknown;
  body: string | null;
  sections: unknown;
  memories: Array<{ memoryId: string }>;
};

export type SharedBookSection = TrustedBookSection & {
  sourceLabels: string[];
};

export type SharedBookSnapshot = {
  userId: string;
  galaxyId: string;
  bookId: string;
  legacySnapshot: false;
  token: string;
  draft: TrustedBookDraft;
  body: string;
  sections: SharedBookSection[];
  share: Pick<CreateBookShareInput, "showBody" | "showSourceTitles" | "showOriginalText">;
};

export type ShareCreateResponse = { token: string; url: string };

export type ShareIdempotencyStatus =
  | { kind: "completed"; operationId: string; response: ShareCreateResponse; status: number }
  | { kind: "processing"; operationId: string; status: 202 }
  | { kind: "expired"; operationId: string; status: 409; recovery: "query_or_reconcile" };

export interface BookShareDeps {
  executeIdempotentDbOperation(
    input: {
      userId: string;
      galaxyId: string;
      scope: string;
      key: string;
      requestHash: string;
    },
    operation: (transaction: unknown, operationId: string) => Promise<{
      resourceType: string;
      resourceId: string;
      result: ShareCreateResponse;
      response: ShareCreateResponse;
      responseStatus: number;
    }>,
  ): Promise<ShareIdempotencyStatus>;
  findShareableBook(input: BookScope & { bookId: string }, transaction: unknown): Promise<ShareableBookRecord | null>;
  createShareToken(): string;
  createSharedBookSnapshot(input: SharedBookSnapshot, transaction: unknown): Promise<{ id?: string; token: string }>;
}

export type RevokeBookShareInput = {
  idempotencyKey: string;
};

export type RevokeShareResponse = { token: string; revoked: true };

export type RevokeShareIdempotencyStatus =
  | { kind: "completed"; operationId: string; response: RevokeShareResponse; status: number }
  | { kind: "processing"; operationId: string; status: 202 }
  | { kind: "expired"; operationId: string; status: 409; recovery: "query_or_reconcile" };

export interface BookRevokeDeps {
  executeIdempotentDbOperation(
    input: {
      userId: string;
      galaxyId: string;
      scope: string;
      key: string;
      requestHash: string;
    },
    operation: (transaction: unknown, operationId: string) => Promise<{
      resourceType: string;
      resourceId: string;
      result: RevokeShareResponse;
      response: RevokeShareResponse;
      responseStatus: number;
    }>,
  ): Promise<RevokeShareIdempotencyStatus>;
  revokeSharedBookSnapshot(
    input: BookScope & { bookId: string; token: string },
    transaction: unknown,
  ): Promise<{ kind: "revoked" | "already_revoked"; id: string } | null>;
}

const defaultBookShareDeps: BookShareDeps = {
  executeIdempotentDbOperation: (input, operation) => executeIdempotentDbOperation(
    getPrismaClient(),
    prismaIdempotencyRepository,
    input,
    async (transaction, operationId) => operation(transaction, operationId) as never,
  ) as Promise<ShareIdempotencyStatus>,
  findShareableBook: (input, transaction) => findShareableBook(input, transaction as never) as Promise<ShareableBookRecord | null>,
  createShareToken: createSharedBookToken,
  createSharedBookSnapshot: (input, transaction) => createSharedBookSnapshot({
    ...input,
    draft: toInputJsonValue(input.draft),
    sections: toInputJsonValue(input.sections),
    share: toInputJsonValue(input.share),
  }, transaction as never),
};

const defaultBookRevokeDeps: BookRevokeDeps = {
  executeIdempotentDbOperation: (input, operation) => executeIdempotentDbOperation(
    getPrismaClient(),
    prismaIdempotencyRepository,
    input,
    async (transaction, operationId) => operation(transaction, operationId) as never,
  ) as Promise<RevokeShareIdempotencyStatus>,
  revokeSharedBookSnapshot: (input, transaction) => revokeSharedBookSnapshot(input, transaction as never),
};

export interface BookGenerationDeps {
  findEligibleBookSources(input: BookScope & { memoryIds: string[] }): Promise<EligibleBookSource[]>;
  getExistingIdempotentRequest(input: {
    userId: string;
    galaxyId: string;
    scope: string;
    key: string;
    requestHash: string;
  }): Promise<Exclude<BookIdempotencyStatus, { kind: "started" }> | null>;
  beginIdempotentRequest(input: {
    userId: string;
    galaxyId: string;
    scope: string;
    key: string;
    requestHash: string;
  }): Promise<BookIdempotencyStatus>;
  generateBook(input: {
    themeTemplateKey: string;
    memories: Array<{ id: string; title: string; summary: string }>;
  }): Promise<GeneratedBook>;
  createBookId(): string;
  persistBookAndComplete(input: {
    scope: BookScope;
    operationId: string;
    idempotencyKey: string;
    book: GeneratedBookPersistence;
    response: BookCreateResponse;
  }): Promise<void>;
  completeFailedBookGeneration(input: {
    operationId: string;
    idempotencyKey: string;
    scope: BookScope;
    error: DomainError;
  }): Promise<void>;
}

const defaultBookGenerationDeps: BookGenerationDeps = {
  findEligibleBookSources,
  getExistingIdempotentRequest: (input) => getExistingIdempotentRequest(
    prismaIdempotencyRepository,
    input,
  ) as Promise<Exclude<BookIdempotencyStatus, { kind: "started" }> | null>,
  beginIdempotentRequest: (input) => beginIdempotentRequest(prismaIdempotencyRepository, input) as Promise<BookIdempotencyStatus>,
  generateBook: (input) => getAiProvider().generateBook(input),
  createBookId: randomUUID,
  persistBookAndComplete: async (input) => {
    await getPrismaClient().$transaction(async (transaction) => {
      await createGeneratedBook({
        id: input.book.id,
        userId: input.scope.userId,
        galaxyId: input.scope.galaxyId,
        title: input.book.title,
        sourceRange: input.book.sourceRange,
        themeTemplateKey: input.book.themeTemplateKey,
        visibility: input.book.visibility,
        draft: toInputJsonValue(input.book.draft),
        body: input.book.body,
        sections: toInputJsonValue(input.book.sections),
        sourceMemoryIds: input.book.sourceMemoryIds,
      }, transaction as never);
      await completeIdempotentRequest(transactionIdempotencyRepository(transaction), {
        ...input.scope,
        scope: "book:create",
        key: input.idempotencyKey,
        operationId: input.operationId,
        resourceType: "book",
        resourceId: input.book.id,
        result: toInputJsonValue(input.response),
        response: toInputJsonValue(input.response),
        responseStatus: 201,
      });
    });
  },
  completeFailedBookGeneration: async (input) => {
    const response: BookGenerationErrorResponse = {
      code: input.error.code,
      message: input.error.message,
    };

    await getPrismaClient().$transaction(async (transaction) => {
      await completeIdempotentRequest(transactionIdempotencyRepository(transaction), {
        ...input.scope,
        scope: "book:create",
        key: input.idempotencyKey,
        operationId: input.operationId,
        resourceType: "book_generation_failure",
        resourceId: input.operationId,
        result: toInputJsonValue(response),
        response: toInputJsonValue(response),
        responseStatus: input.error.status,
      });
    });
  },
};

export async function createBookFromMemories(
  scope: BookScope,
  input: CreateBookFromMemoriesInput,
  deps: BookGenerationDeps = defaultBookGenerationDeps,
) {
  const requestHash = hashBookGenerationRequest({
    title: input.title,
    sourceMemoryIds: input.sourceMemoryIds,
    sourceRange: input.sourceRange,
    themeTemplateKey: input.themeTemplateKey,
    visibility: input.visibility,
  });
  const idempotencyRequest = {
    ...scope,
    scope: "book:create",
    key: input.idempotencyKey,
    requestHash,
  };
  const existing = await deps.getExistingIdempotentRequest(idempotencyRequest);

  if (existing) {
    return existing;
  }

  const sources = await deps.findEligibleBookSources({ ...scope, memoryIds: input.sourceMemoryIds });
  const sourceIds = new Set(sources.map((source) => source.id));

  if (sources.length !== input.sourceMemoryIds.length || input.sourceMemoryIds.some((id) => !sourceIds.has(id))) {
    throw invalidBookSource();
  }

  const aiInput = {
    themeTemplateKey: input.themeTemplateKey,
    memories: sources.map(({ id, title, summary }) => ({
      id,
      title: title?.trim() || "未命名记忆",
      summary: summary?.trim() || "",
    })),
  };

  if (JSON.stringify(aiInput).length > MAX_BOOK_AI_INPUT_CHARACTERS) {
    throw bookAiInputTooLarge();
  }

  const idempotency = await deps.beginIdempotentRequest(idempotencyRequest);

  if (idempotency.kind !== "started") {
    return idempotency;
  }

  try {
    const generated = await deps.generateBook(aiInput);
    const ready = validateGeneratedBook(generated);
    const id = deps.createBookId();
    const title = input.title?.trim() || ready.title;
    const sourceMemoryIds = [...input.sourceMemoryIds];
    const sourceLabels = Object.fromEntries(sources.map((source) => [
      source.id,
      source.title?.trim() || `记忆 ${source.id}`,
    ]));
    const sections = ready.sections.map((section) => ({
      ...section,
      sourceMemoryIds,
    }));
    const draft: TrustedBookDraft = {
      id,
      title,
      sourceRange: input.sourceRange,
      themeTemplateKey: input.themeTemplateKey,
      sourceMemoryIds,
      sourceLabels,
      intro: ready.intro,
      chapters: sections.map((section) => ({
        title: section.title,
        sourceMemoryIds: section.sourceMemoryIds,
      })),
    };
    const body = [ready.intro, ...sections.map((section) => `${section.title}\n${section.body}`)].join("\n\n");
    const book: GeneratedBookPersistence = {
      id,
      title,
      sourceRange: input.sourceRange,
      themeTemplateKey: input.themeTemplateKey,
      visibility: input.visibility,
      draft,
      body,
      sections,
      sourceMemoryIds,
    };
    const response: BookCreateResponse = { id, title, status: "ready", draft, body, sections };

    await deps.persistBookAndComplete({
      scope,
      operationId: idempotency.operationId,
      idempotencyKey: input.idempotencyKey,
      book,
      response,
    });

    return { kind: "completed" as const, operationId: idempotency.operationId, response, status: 201 };
  } catch (error) {
    const failure = safeBookGenerationFailure(error);

    try {
      await deps.completeFailedBookGeneration({
        operationId: idempotency.operationId,
        idempotencyKey: input.idempotencyKey,
        scope,
        error: failure,
      });
    } catch {
      // A best-effort terminal response must never mask the original operation failure.
    }

    throw failure;
  }
}

export async function createBookShare(
  scope: BookScope,
  bookId: string,
  input: CreateBookShareInput,
  deps: BookShareDeps = defaultBookShareDeps,
) {
  const share = {
    showBody: input.showBody,
    showSourceTitles: input.showSourceTitles,
    showOriginalText: input.showOriginalText,
  };

  return deps.executeIdempotentDbOperation({
    ...scope,
    scope: "book:share:create",
    key: input.idempotencyKey,
    requestHash: createHash("sha256").update(stableJson({ bookId, ...share })).digest("hex"),
  }, async (transaction) => {
    const book = await deps.findShareableBook({ ...scope, bookId }, transaction);

    if (!book) {
      throw sharedBookNotFound();
    }

    const token = deps.createShareToken();
    const snapshot = snapshotFromStoredBook(book, { ...scope, token, share });
    const stored = await deps.createSharedBookSnapshot(snapshot, transaction);
    const response = { token: stored.token, url: `/share/${stored.token}` };

    return {
      resourceType: "shared_book",
      resourceId: stored.id ?? stored.token,
      result: response,
      response,
      responseStatus: 201,
    };
  });
}

export async function revokeBookShare(
  scope: BookScope,
  bookId: string,
  token: string,
  input: RevokeBookShareInput,
  deps: BookRevokeDeps = defaultBookRevokeDeps,
) {
  return deps.executeIdempotentDbOperation({
    ...scope,
    scope: "book:share:revoke",
    key: input.idempotencyKey,
    requestHash: createHash("sha256").update(stableJson({ bookId, token })).digest("hex"),
  }, async (transaction) => {
    const revoked = await deps.revokeSharedBookSnapshot({ ...scope, bookId, token }, transaction);

    if (!revoked) {
      throw sharedBookNotFound();
    }

    const response = { token, revoked: true as const };
    return {
      resourceType: "shared_book",
      resourceId: revoked.id,
      result: response,
      response,
      responseStatus: 200,
    };
  });
}

function validateGeneratedBook(value: unknown): GeneratedBook {
  if (!isRecord(value) || !Array.isArray(value.sections)) {
    throw invalidAiProviderResponse();
  }

  const title = validText(value.title, 200);
  const intro = validText(value.intro, 5_000);

  if (!title || !intro || value.sections.length === 0 || value.sections.length > 40) {
    throw invalidAiProviderResponse();
  }

  const sections = value.sections.map((section) => {
    if (!isRecord(section)) {
      throw invalidAiProviderResponse();
    }

    const sectionTitle = validText(section.title, 200);
    const body = validText(section.body, 20_000);

    if (!sectionTitle || !body) {
      throw invalidAiProviderResponse();
    }

    return { title: sectionTitle, body };
  });
  const bodyLength = intro.length + sections.reduce((total, section) => total + section.title.length + section.body.length, 0);

  if (bodyLength > 200_000) {
    throw invalidAiProviderResponse();
  }

  return { title, intro, sections };
}

function snapshotFromStoredBook(
  book: ShareableBookRecord,
  input: {
    userId: string;
    galaxyId: string;
    token: string;
    share: SharedBookSnapshot["share"];
  },
): SharedBookSnapshot {
  const sourceMemoryIds = [...new Set(book.memories.map(({ memoryId }) => memoryId).filter(isNonBlankString))];

  if (sourceMemoryIds.length === 0 || !isRecord(book.draft) || !Array.isArray(book.sections)) {
    throw storedBookInvalid();
  }

  const draft = book.draft;
  const title = validText(book.title ?? draft.title, 200);
  const intro = validText(draft.intro, 5_000);
  const themeTemplateKey = validText(draft.themeTemplateKey, 200);
  const sourceRange = draft.sourceRange;
  const body = validText(book.body, 200_000);

  if (!title || !intro || !themeTemplateKey || !body || !isSourceRange(sourceRange)) {
    throw storedBookInvalid();
  }

  const validSourceIds = new Set(sourceMemoryIds);
  const storedLabels = isRecord(draft.sourceLabels) ? draft.sourceLabels : {};
  const sourceLabels = Object.fromEntries(sourceMemoryIds.map((memoryId) => [
    memoryId,
    validText(storedLabels[memoryId], 200) ?? `记忆 ${memoryId}`,
  ]));
  const sections = book.sections.map((value) => mapStoredSection(value, sourceMemoryIds, validSourceIds, sourceLabels));

  if (sections.length === 0 || sections.length > 40) {
    throw storedBookInvalid();
  }

  const trustedDraft: TrustedBookDraft = {
    id: book.id,
    title,
    sourceRange,
    themeTemplateKey,
    sourceMemoryIds,
    sourceLabels,
    intro,
    chapters: sections.map((section) => ({
      title: section.title,
      sourceMemoryIds: section.sourceMemoryIds,
    })),
  };

  return {
    userId: input.userId,
    galaxyId: input.galaxyId,
    bookId: book.id,
    legacySnapshot: false,
    token: input.token,
    draft: trustedDraft,
    body,
    sections,
    share: input.share,
  };
}

function mapStoredSection(
  value: unknown,
  sourceMemoryIds: string[],
  validSourceIds: Set<string>,
  sourceLabels: Record<string, string>,
): SharedBookSection {
  if (!isRecord(value)) {
    throw storedBookInvalid();
  }

  const title = validText(value.title, 200);
  const body = validText(value.body, 20_000);

  if (!title || !body) {
    throw storedBookInvalid();
  }

  const requestedSources = Array.isArray(value.sourceMemoryIds)
    ? value.sourceMemoryIds.filter((memoryId): memoryId is string => isNonBlankString(memoryId) && validSourceIds.has(memoryId))
    : [];
  const sectionSourceMemoryIds = [...new Set(requestedSources)];
  const mappedSourceMemoryIds = sectionSourceMemoryIds.length > 0 ? sectionSourceMemoryIds : sourceMemoryIds;

  return {
    title,
    body,
    sourceMemoryIds: mappedSourceMemoryIds,
    sourceLabels: mappedSourceMemoryIds.map((memoryId) => sourceLabels[memoryId] ?? `记忆 ${memoryId}`),
  };
}

function invalidBookSource() {
  return new DomainError(
    "INVALID_BOOK_SOURCE",
    422,
    "家书来源必须是当前星系中已确认、未删除且已授权生成家书的记忆。",
  );
}

function invalidAiProviderResponse() {
  return new DomainError("AI_PROVIDER_RESPONSE_INVALID", 502, "AI 服务返回内容无法处理，请稍后重试。");
}

function bookAiInputTooLarge() {
  return new DomainError("BOOK_AI_INPUT_TOO_LARGE", 422, "家书来源内容过长，请减少来源或精简摘要后重试。");
}

function safeBookGenerationFailure(error: unknown) {
  if (error instanceof DomainError) {
    return error;
  }

  return new DomainError("BOOK_GENERATION_FAILED", 500, "家书生成失败，请稍后重试。");
}

function sharedBookNotFound() {
  return new DomainError("SHARED_BOOK_NOT_FOUND", 404, "家书不存在或无权访问。");
}

function storedBookInvalid() {
  return new DomainError("BOOK_NOT_SHAREABLE", 409, "这封家书无法安全公开，请重新生成后再试。");
}

export function hashBookGenerationRequest(input: BookGenerationHashInput) {
  return createHash("sha256").update(stableJson(input)).digest("hex");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  const fields = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`);

  return `{${fields.join(",")}}`;
}

function validText(value: unknown, maximumLength: number) {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim();
  return text && text.length <= maximumLength ? text : null;
}

function isSourceRange(value: unknown): value is TrustedBookDraft["sourceRange"] {
  return value === "single_planet" || value === "binary_system" || value === "family_galaxy" || value === "memorial";
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function transactionIdempotencyRepository(transaction: unknown) {
  return {
    findByScope: (input: Parameters<typeof prismaIdempotencyRepository.findByScope>[0]) => (
      prismaIdempotencyRepository.findByScope(input, transaction as never)
    ),
    createProcessing: (input: Parameters<typeof prismaIdempotencyRepository.createProcessing>[0]) => (
      prismaIdempotencyRepository.createProcessing(input, transaction as never)
    ),
    complete: (input: Parameters<typeof prismaIdempotencyRepository.complete>[0]) => (
      prismaIdempotencyRepository.complete(input, transaction as never)
    ),
    isCreateConflict: prismaIdempotencyRepository.isCreateConflict,
  };
}

function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
