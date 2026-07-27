import { describe, expect, it, vi } from "vitest";

import { DomainError } from "@/server/domain-error";

const {
  getPrismaClient,
  findEligibleBookSources,
  createGeneratedBook,
  findShareableBook,
  createSharedBookSnapshot,
  revokeSharedBookSnapshot,
  createSharedBookToken,
  getAiProvider,
  getExistingIdempotentRequest,
  beginIdempotentRequest,
  completeIdempotentRequest,
  executeIdempotentDbOperation,
  prismaIdempotencyRepository,
} = vi.hoisted(() => ({
  getPrismaClient: vi.fn(),
  findEligibleBookSources: vi.fn(),
  createGeneratedBook: vi.fn(),
  findShareableBook: vi.fn(),
  createSharedBookSnapshot: vi.fn(),
  revokeSharedBookSnapshot: vi.fn(),
  createSharedBookToken: vi.fn(),
  getAiProvider: vi.fn(),
  getExistingIdempotentRequest: vi.fn(),
  beginIdempotentRequest: vi.fn(),
  completeIdempotentRequest: vi.fn(),
  executeIdempotentDbOperation: vi.fn(),
  prismaIdempotencyRepository: {
    findByScope: vi.fn(),
    createProcessing: vi.fn(),
    complete: vi.fn(),
    isCreateConflict: vi.fn(),
  },
}));

vi.mock("@/server/db/client", () => ({ getPrismaClient }));
vi.mock("@/server/db/book-repo", () => ({ findEligibleBookSources, createGeneratedBook, findShareableBook }));
vi.mock("@/server/db/shared-book-repo", () => ({ createSharedBookSnapshot, revokeSharedBookSnapshot }));
vi.mock("@/server/store/shared-books", () => ({ createSharedBookToken }));
vi.mock("@/server/ai/openai-client", () => ({ getAiProvider }));
vi.mock("@/server/services/idempotency.service", () => ({
  getExistingIdempotentRequest,
  beginIdempotentRequest,
  completeIdempotentRequest,
  executeIdempotentDbOperation,
}));
vi.mock("@/server/db/idempotency-repo", () => ({ prismaIdempotencyRepository }));

import * as bookService from "./book.service";

const { createBookFromMemories } = bookService;
const bookServiceWithHash = bookService as typeof bookService & {
  hashBookGenerationRequest: (input: {
    title?: string;
    sourceMemoryIds: string[];
    sourceRange: string;
    themeTemplateKey: string;
    visibility: string;
  }) => string;
};
const bookServiceWithLimits = bookService as typeof bookService & {
  MAX_BOOK_AI_INPUT_CHARACTERS: number;
};
const bookServiceWithSharing = bookService as typeof bookService & {
  createBookShare: (
    scope: { userId: string; galaxyId: string },
    bookId: string,
    input: { showBody: boolean; showSourceTitles: boolean; showOriginalText: boolean; idempotencyKey: string },
    deps: unknown,
  ) => Promise<unknown>;
  revokeBookShare: (
    scope: { userId: string; galaxyId: string },
    bookId: string,
    token: string,
    input: { idempotencyKey: string },
    deps: unknown,
  ) => Promise<unknown>;
};

const scope = { userId: "user-1", galaxyId: "galaxy-1" };
const bookInput = {
  sourceMemoryIds: ["ck8m3x8xy000000000000001", "ck8m3x8xy000000000000003"],
  sourceRange: "binary_system" as const,
  themeTemplateKey: "family_reunion",
  visibility: "family" as const,
  idempotencyKey: "book-create-key-00001",
};

describe("book service", () => {
  it("uses a stable SHA-256 request hash for book idempotency", () => {
    expect(bookServiceWithHash.hashBookGenerationRequest).toBeTypeOf("function");
    const first = bookServiceWithHash.hashBookGenerationRequest({
      title: "家书",
      sourceMemoryIds: ["memory-1", "memory-2"],
      sourceRange: "binary_system",
      themeTemplateKey: "family_reunion",
      visibility: "family",
    });
    const replay = bookServiceWithHash.hashBookGenerationRequest({
      visibility: "family",
      themeTemplateKey: "family_reunion",
      sourceRange: "binary_system",
      sourceMemoryIds: ["memory-1", "memory-2"],
      title: "家书",
    });

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(replay).toBe(first);
    expect(bookServiceWithHash.hashBookGenerationRequest({
      title: "另一封家书",
      sourceMemoryIds: ["memory-1", "memory-2"],
      sourceRange: "binary_system",
      themeTemplateKey: "family_reunion",
      visibility: "family",
    })).not.toBe(first);
  });

  it("replays a matching completed request before checking sources that later become ineligible", async () => {
    const cachedResult = {
      kind: "completed" as const,
      operationId: "operation-cached-1",
      response: { id: "book-cached-1", status: "ready" },
      status: 201,
    };
    const getExistingIdempotentRequest = vi.fn().mockResolvedValue(cachedResult);
    const findEligibleBookSources = vi.fn().mockResolvedValue([]);
    const beginIdempotentRequest = vi.fn();
    const generateBook = vi.fn();

    await expect(createBookFromMemories(scope, bookInput, {
      getExistingIdempotentRequest,
      findEligibleBookSources,
      beginIdempotentRequest,
      generateBook,
    } as never)).resolves.toEqual(cachedResult);

    expect(getExistingIdempotentRequest).toHaveBeenCalledWith(expect.objectContaining({
      ...scope,
      scope: "book:create",
      key: bookInput.idempotencyKey,
    }));
    expect(findEligibleBookSources).not.toHaveBeenCalled();
    expect(beginIdempotentRequest).not.toHaveBeenCalled();
    expect(generateBook).not.toHaveBeenCalled();
  });

  it("rejects a conflicting existing key before checking now-ineligible sources", async () => {
    const conflict = Object.assign(new Error("idempotency conflict"), {
      code: "IDEMPOTENCY_CONFLICT",
      status: 409,
    });
    const getExistingIdempotentRequest = vi.fn().mockRejectedValue(conflict);
    const findEligibleBookSources = vi.fn().mockResolvedValue([]);
    const beginIdempotentRequest = vi.fn();

    await expect(createBookFromMemories(scope, bookInput, {
      getExistingIdempotentRequest,
      findEligibleBookSources,
      beginIdempotentRequest,
      generateBook: vi.fn(),
    } as never)).rejects.toBe(conflict);

    expect(findEligibleBookSources).not.toHaveBeenCalled();
    expect(beginIdempotentRequest).not.toHaveBeenCalled();
  });

  it("rejects incomplete, unconfirmed, deleted, or out-of-scope sources before calling AI", async () => {
    const findEligibleBookSources = vi.fn().mockResolvedValue([
      { id: bookInput.sourceMemoryIds[0], title: "除夕团圆饭", summary: "一家人围桌而坐。" },
    ]);
    const generateBook = vi.fn();

    await expect(
      createBookFromMemories(scope, bookInput, {
        getExistingIdempotentRequest: vi.fn().mockResolvedValue(null),
        findEligibleBookSources,
        generateBook,
      } as never),
    ).rejects.toMatchObject({ code: "INVALID_BOOK_SOURCE", status: 422 });

    expect(findEligibleBookSources).toHaveBeenCalledWith({
      ...scope,
      memoryIds: bookInput.sourceMemoryIds,
    });
    expect(generateBook).not.toHaveBeenCalled();
  });

  it("exports the deterministic book AI input character limit", () => {
    expect(bookServiceWithLimits.MAX_BOOK_AI_INPUT_CHARACTERS).toBe(48_000);
  });

  it("allows an AI payload at the character limit but rejects one character over it before idempotency begins", async () => {
    const payloadWithCharacterCount = (characterCount: number) => {
      const memories = [
        { id: bookInput.sourceMemoryIds[0], title: "除夕团圆饭", summary: "" },
        { id: bookInput.sourceMemoryIds[1], title: "窗外烟花", summary: "孩子趴在窗边看烟花。" },
      ];
      const emptyPayloadLength = JSON.stringify({ themeTemplateKey: bookInput.themeTemplateKey, memories }).length;

      memories[0] = {
        ...memories[0],
        summary: "x".repeat(characterCount - emptyPayloadLength),
      };

      return memories;
    };
    const beginIdempotentRequest = vi.fn().mockResolvedValue({ kind: "started", operationId: "operation-budget-1" });
    const generateBook = vi.fn().mockResolvedValue({
      title: "除夕的团圆饭",
      intro: "这一年的团圆，从一桌热饭开始。",
      sections: [{ title: "围桌", body: "一家人在灯下慢慢说话。" }],
    });
    const persistBookAndComplete = vi.fn();
    const deps = {
      getExistingIdempotentRequest: vi.fn().mockResolvedValue(null),
      findEligibleBookSources: vi.fn()
        .mockResolvedValueOnce(payloadWithCharacterCount(48_000))
        .mockResolvedValueOnce(payloadWithCharacterCount(48_001)),
      beginIdempotentRequest,
      generateBook,
      createBookId: () => "book-budget-1",
      persistBookAndComplete,
    };

    await expect(createBookFromMemories(scope, bookInput, deps as never)).resolves.toMatchObject({
      kind: "completed",
      status: 201,
    });
    await expect(createBookFromMemories(scope, bookInput, deps as never)).rejects.toMatchObject({
      code: "BOOK_AI_INPUT_TOO_LARGE",
      status: 422,
    });

    expect(beginIdempotentRequest).toHaveBeenCalledTimes(1);
    expect(generateBook).toHaveBeenCalledTimes(1);
  });

  it("sends only trusted memory metadata to AI then persists a traceable ready book", async () => {
    const calls: string[] = [];
    const findEligibleBookSources = vi.fn().mockResolvedValue([
      {
        id: bookInput.sourceMemoryIds[0],
        title: "除夕团圆饭",
        summary: "一家人围桌而坐。",
        sourceText: "这段原文绝不能离开服务端。",
      },
      {
        id: bookInput.sourceMemoryIds[1],
        title: "窗外烟花",
        summary: "孩子趴在窗边看烟花。",
        sourceText: "另一段私密原文。",
      },
    ]);
    const beginIdempotentRequest = vi.fn().mockResolvedValue({ kind: "started", operationId: "operation-1" });
    const generateBook = vi.fn(async () => {
      calls.push("ai");
      return {
        title: "除夕的团圆饭",
        intro: "这一年的团圆，从一桌热饭开始。",
        sections: [{ title: "围桌", body: "一家人在灯下慢慢说话。" }],
      };
    });
    const persistBookAndComplete = vi.fn(async () => {
      calls.push("write");
    });

    const result = await createBookFromMemories(scope, bookInput, {
      getExistingIdempotentRequest: vi.fn().mockResolvedValue(null),
      findEligibleBookSources,
      beginIdempotentRequest,
      generateBook,
      createBookId: () => "book-1",
      persistBookAndComplete,
    } as never);

    expect(generateBook).toHaveBeenCalledWith({
      themeTemplateKey: "family_reunion",
      memories: [
        { id: bookInput.sourceMemoryIds[0], title: "除夕团圆饭", summary: "一家人围桌而坐。" },
        { id: bookInput.sourceMemoryIds[1], title: "窗外烟花", summary: "孩子趴在窗边看烟花。" },
      ],
    });
    const aiInput = (generateBook.mock.calls as unknown[][])[0]?.[0];
    expect(JSON.stringify(aiInput)).not.toContain("私密原文");
    expect(calls).toEqual(["ai", "write"]);
    expect(persistBookAndComplete).toHaveBeenCalledWith(expect.objectContaining({
      scope,
      operationId: "operation-1",
      response: expect.objectContaining({
        id: "book-1",
        title: "除夕的团圆饭",
        status: "ready",
        body: "这一年的团圆，从一桌热饭开始。\n\n围桌\n一家人在灯下慢慢说话。",
        sections: [{
          title: "围桌",
          body: "一家人在灯下慢慢说话。",
          sourceMemoryIds: bookInput.sourceMemoryIds,
        }],
      }),
      book: expect.objectContaining({
        id: "book-1",
        sourceMemoryIds: bookInput.sourceMemoryIds,
        draft: expect.objectContaining({
          id: "book-1",
          sourceMemoryIds: bookInput.sourceMemoryIds,
          intro: "这一年的团圆，从一桌热饭开始。",
          chapters: [{ title: "围桌", sourceMemoryIds: bookInput.sourceMemoryIds }],
        }),
      }),
    }));
    expect(result).toEqual(expect.objectContaining({
      kind: "completed",
      operationId: "operation-1",
      status: 201,
      response: expect.objectContaining({ id: "book-1", status: "ready" }),
    }));
  });

  it("maps a malformed provider response to AI_PROVIDER_RESPONSE_INVALID before any book write", async () => {
    const persistBookAndComplete = vi.fn();
    const completeFailedBookGeneration = vi.fn();

    await expect(createBookFromMemories(scope, bookInput, {
      getExistingIdempotentRequest: vi.fn().mockResolvedValue(null),
      findEligibleBookSources: vi.fn().mockResolvedValue([
        { id: bookInput.sourceMemoryIds[0], title: "除夕团圆饭", summary: "一家人围桌而坐。" },
        { id: bookInput.sourceMemoryIds[1], title: "窗外烟花", summary: "孩子趴在窗边看烟花。" },
      ]),
      beginIdempotentRequest: vi.fn().mockResolvedValue({ kind: "started", operationId: "operation-invalid-ai-1" }),
      generateBook: vi.fn().mockResolvedValue(null),
      createBookId: () => "book-1",
      persistBookAndComplete,
      completeFailedBookGeneration,
    } as never)).rejects.toMatchObject({ code: "AI_PROVIDER_RESPONSE_INVALID", status: 502 });

    expect(persistBookAndComplete).not.toHaveBeenCalled();
    expect(completeFailedBookGeneration).toHaveBeenCalledWith(expect.objectContaining({
      operationId: "operation-invalid-ai-1",
      error: expect.objectContaining({ code: "AI_PROVIDER_RESPONSE_INVALID", status: 502 }),
    }));
  });

  it("caches a provider failure as a terminal response so a replay never calls AI again", async () => {
    const failure = new DomainError("AI_PROVIDER_UNAVAILABLE", 503, "AI 服务暂不可用，请稍后重试。");
    let cached: {
      kind: "completed";
      operationId: string;
      response: { code: string; message: string };
      status: number;
    } | null = null;
    const findEligibleBookSources = vi.fn().mockResolvedValue([
      { id: bookInput.sourceMemoryIds[0], title: "除夕团圆饭", summary: "一家人围桌而坐。" },
      { id: bookInput.sourceMemoryIds[1], title: "窗外烟花", summary: "孩子趴在窗边看烟花。" },
    ]);
    const generateBook = vi.fn().mockRejectedValue(failure);
    const completeFailedBookGeneration = vi.fn(async (input: {
      operationId: string;
      error: DomainError;
    }) => {
      cached = {
        kind: "completed",
        operationId: input.operationId,
        response: { code: input.error.code, message: input.error.message },
        status: input.error.status,
      };
    });
    const deps = {
      getExistingIdempotentRequest: vi.fn(async () => cached),
      findEligibleBookSources,
      beginIdempotentRequest: vi.fn().mockResolvedValue({ kind: "started", operationId: "operation-failure-1" }),
      generateBook,
      completeFailedBookGeneration,
    };

    await expect(createBookFromMemories(scope, bookInput, deps as never)).rejects.toBe(failure);
    await expect(createBookFromMemories(scope, bookInput, deps as never)).resolves.toEqual({
      kind: "completed",
      operationId: "operation-failure-1",
      response: { code: "AI_PROVIDER_UNAVAILABLE", message: "AI 服务暂不可用，请稍后重试。" },
      status: 503,
    });

    expect(completeFailedBookGeneration).toHaveBeenCalledWith({
      operationId: "operation-failure-1",
      idempotencyKey: bookInput.idempotencyKey,
      scope,
      error: failure,
    });
    expect(findEligibleBookSources).toHaveBeenCalledTimes(1);
    expect(generateBook).toHaveBeenCalledTimes(1);
  });

  it("caches a persistence revalidation failure as a terminal response", async () => {
    const failure = new DomainError(
      "INVALID_BOOK_SOURCE",
      422,
      "家书来源必须是当前星系中已确认、未删除且已授权生成家书的记忆。",
    );
    let cached: {
      kind: "completed";
      operationId: string;
      response: { code: string; message: string };
      status: number;
    } | null = null;
    const generateBook = vi.fn().mockResolvedValue({
      title: "除夕的团圆饭",
      intro: "这一年的团圆，从一桌热饭开始。",
      sections: [{ title: "围桌", body: "一家人在灯下慢慢说话。" }],
    });
    const persistBookAndComplete = vi.fn().mockRejectedValue(failure);
    const completeFailedBookGeneration = vi.fn(async (input: {
      operationId: string;
      error: DomainError;
    }) => {
      cached = {
        kind: "completed",
        operationId: input.operationId,
        response: { code: input.error.code, message: input.error.message },
        status: input.error.status,
      };
    });
    const deps = {
      getExistingIdempotentRequest: vi.fn(async () => cached),
      findEligibleBookSources: vi.fn().mockResolvedValue([
        { id: bookInput.sourceMemoryIds[0], title: "除夕团圆饭", summary: "一家人围桌而坐。" },
        { id: bookInput.sourceMemoryIds[1], title: "窗外烟花", summary: "孩子趴在窗边看烟花。" },
      ]),
      beginIdempotentRequest: vi.fn().mockResolvedValue({ kind: "started", operationId: "operation-revalidation-1" }),
      generateBook,
      createBookId: () => "book-revalidation-1",
      persistBookAndComplete,
      completeFailedBookGeneration,
    };

    await expect(createBookFromMemories(scope, bookInput, deps as never)).rejects.toBe(failure);
    await expect(createBookFromMemories(scope, bookInput, deps as never)).resolves.toEqual({
      kind: "completed",
      operationId: "operation-revalidation-1",
      response: { code: "INVALID_BOOK_SOURCE", message: failure.message },
      status: 422,
    });

    expect(persistBookAndComplete).toHaveBeenCalledTimes(1);
    expect(completeFailedBookGeneration).toHaveBeenCalledTimes(1);
    expect(generateBook).toHaveBeenCalledTimes(1);
  });

  it("does not mask the original generation failure when terminal completion fails", async () => {
    const failure = new DomainError("AI_PROVIDER_UNAVAILABLE", 503, "AI 服务暂不可用，请稍后重试。");
    const completeFailedBookGeneration = vi.fn().mockRejectedValue(new Error("idempotency write unavailable"));

    await expect(createBookFromMemories(scope, bookInput, {
      getExistingIdempotentRequest: vi.fn().mockResolvedValue(null),
      findEligibleBookSources: vi.fn().mockResolvedValue([
        { id: bookInput.sourceMemoryIds[0], title: "除夕团圆饭", summary: "一家人围桌而坐。" },
        { id: bookInput.sourceMemoryIds[1], title: "窗外烟花", summary: "孩子趴在窗边看烟花。" },
      ]),
      beginIdempotentRequest: vi.fn().mockResolvedValue({ kind: "started", operationId: "operation-completion-fail-1" }),
      generateBook: vi.fn().mockRejectedValue(failure),
      completeFailedBookGeneration,
    } as never)).rejects.toBe(failure);

    expect(completeFailedBookGeneration).toHaveBeenCalledWith(expect.objectContaining({
      operationId: "operation-completion-fail-1",
      error: failure,
    }));
  });

  it("normalizes an unknown generation failure before caching the terminal response", async () => {
    const completeFailedBookGeneration = vi.fn();

    await expect(createBookFromMemories(scope, bookInput, {
      getExistingIdempotentRequest: vi.fn().mockResolvedValue(null),
      findEligibleBookSources: vi.fn().mockResolvedValue([
        { id: bookInput.sourceMemoryIds[0], title: "除夕团圆饭", summary: "一家人围桌而坐。" },
        { id: bookInput.sourceMemoryIds[1], title: "窗外烟花", summary: "孩子趴在窗边看烟花。" },
      ]),
      beginIdempotentRequest: vi.fn().mockResolvedValue({ kind: "started", operationId: "operation-unknown-failure-1" }),
      generateBook: vi.fn().mockRejectedValue(new Error("provider internals must not escape")),
      completeFailedBookGeneration,
    } as never)).rejects.toMatchObject({ code: "BOOK_GENERATION_FAILED", status: 500 });

    expect(completeFailedBookGeneration).toHaveBeenCalledWith(expect.objectContaining({
      operationId: "operation-unknown-failure-1",
      error: expect.objectContaining({
        code: "BOOK_GENERATION_FAILED",
        status: 500,
        message: "家书生成失败，请稍后重试。",
      }),
    }));
  });

  it("uses a short transaction to cache a default terminal generation failure", async () => {
    const failure = new DomainError("AI_PROVIDER_UNAVAILABLE", 503, "AI 服务暂不可用，请稍后重试。");
    const transaction = { idempotencyRecord: {} };
    const $transaction = vi.fn(async (callback: (transaction: unknown) => Promise<unknown>) => callback(transaction));
    findEligibleBookSources.mockResolvedValue([
      { id: bookInput.sourceMemoryIds[0], title: "除夕团圆饭", summary: "一家人围桌而坐。" },
      { id: bookInput.sourceMemoryIds[1], title: "窗外烟花", summary: "孩子趴在窗边看烟花。" },
    ]);
    getExistingIdempotentRequest.mockResolvedValue(null);
    beginIdempotentRequest.mockResolvedValue({ kind: "started", operationId: "operation-default-failure-1" });
    getAiProvider.mockReturnValue({ generateBook: vi.fn().mockRejectedValue(failure) });
    getPrismaClient.mockReturnValue({ $transaction });
    completeIdempotentRequest.mockResolvedValue({ count: 1 });

    await expect((createBookFromMemories as unknown as (
      scope: { userId: string; galaxyId: string },
      input: typeof bookInput,
    ) => Promise<unknown>)(scope, bookInput)).rejects.toBe(failure);

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(completeIdempotentRequest).toHaveBeenCalledWith(expect.objectContaining({
      complete: expect.any(Function),
    }), expect.objectContaining({
      ...scope,
      scope: "book:create",
      key: bookInput.idempotencyKey,
      operationId: "operation-default-failure-1",
      response: { code: "AI_PROVIDER_UNAVAILABLE", message: failure.message },
      responseStatus: 503,
    }));
  });

  it("uses the default dependencies without holding its database transaction across the AI call", async () => {
    const calls: string[] = [];
    findEligibleBookSources.mockResolvedValue([
      { id: bookInput.sourceMemoryIds[0], title: "除夕团圆饭", summary: "一家人围桌而坐。" },
      { id: bookInput.sourceMemoryIds[1], title: "窗外烟花", summary: "孩子趴在窗边看烟花。" },
    ]);
    beginIdempotentRequest.mockImplementation(async () => {
      calls.push("begin");
      return { kind: "started", operationId: "operation-default-1" };
    });
    getAiProvider.mockReturnValue({
      generateBook: vi.fn(async () => {
        calls.push("ai");
        return {
          title: "默认依赖家书",
          intro: "默认依赖安全地调用 AI。",
          sections: [{ title: "围桌", body: "只有 AI 生成的内容会被保存。" }],
        };
      }),
    });
    const transaction = { book: {}, idempotencyRecord: {} };
    getPrismaClient.mockReturnValue({
      $transaction: vi.fn(async (callback: (transaction: unknown) => Promise<unknown>) => {
        calls.push("transaction");
        return callback(transaction);
      }),
    });
    createGeneratedBook.mockImplementation(async () => {
      calls.push("book");
      return { id: "unused-return-id" };
    });
    completeIdempotentRequest.mockImplementation(async () => {
      calls.push("complete");
      return { count: 1 };
    });

    const result = await (createBookFromMemories as unknown as (
      scope: { userId: string; galaxyId: string },
      input: typeof bookInput,
    ) => Promise<unknown>)(scope, bookInput);

    expect(calls).toEqual(["begin", "ai", "transaction", "book", "complete"]);
    expect(createGeneratedBook).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      galaxyId: "galaxy-1",
      sourceMemoryIds: bookInput.sourceMemoryIds,
      draft: expect.objectContaining({ sourceMemoryIds: bookInput.sourceMemoryIds }),
    }), transaction);
    expect(completeIdempotentRequest).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      userId: "user-1",
      galaxyId: "galaxy-1",
      scope: "book:create",
      key: bookInput.idempotencyKey,
      operationId: "operation-default-1",
      responseStatus: 201,
    }));
    expect(result).toEqual(expect.objectContaining({ kind: "completed", status: 201 }));
  });

  it("derives a share snapshot only from the saved book and BookMemory sources", async () => {
    const savedBook = {
      id: "book-1",
      title: "数据库中保存的家书",
      draft: {
        id: "book-1",
        title: "数据库中保存的家书",
        sourceRange: "binary_system",
        themeTemplateKey: "family_reunion",
        sourceMemoryIds: ["memory-1"],
        sourceLabels: { "memory-1": "妈妈的除夕回忆" },
        intro: "这是已保存的 AI 前言。",
        chapters: [{ title: "围桌", sourceMemoryIds: ["memory-1"] }],
      },
      body: "这是已保存的 AI 正文。",
      sections: [{
        title: "围桌",
        body: "这是已保存的 AI 章节。",
        sourceMemoryIds: ["memory-1", "attacker-memory"],
        sourceText: "绝不能进入公开快照的原文。",
        assetUrl: "https://private.example/media.jpg",
      }],
      memories: [{ memoryId: "memory-1" }],
    };
    const findShareableBook = vi.fn().mockResolvedValue(savedBook);
    const createSharedBookSnapshot = vi.fn().mockResolvedValue({ token: "a".repeat(64) });
    const executeIdempotentDbOperation = vi.fn(async (
      _request: unknown,
      operation: (transaction: unknown, operationId: string) => Promise<Record<string, unknown>>,
    ) => {
      const completion = await operation({}, "operation-share-1");
      return {
        kind: "completed",
        operationId: "operation-share-1",
        status: completion.responseStatus,
        response: completion.response,
      };
    });

    const result = await bookServiceWithSharing.createBookShare(
      scope,
      "book-1",
      {
        showBody: true,
        showSourceTitles: true,
        showOriginalText: false,
        idempotencyKey: "book-share-key-000001",
      },
      {
        executeIdempotentDbOperation,
        findShareableBook,
        createShareToken: () => "a".repeat(64),
        createSharedBookSnapshot,
      },
    );

    expect(findShareableBook).toHaveBeenCalledWith({ ...scope, bookId: "book-1" }, {});
    expect(createSharedBookSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      galaxyId: "galaxy-1",
      bookId: "book-1",
      legacySnapshot: false,
      token: "a".repeat(64),
      draft: expect.objectContaining({
        id: "book-1",
        title: "数据库中保存的家书",
        sourceMemoryIds: ["memory-1"],
      }),
      body: "这是已保存的 AI 正文。",
      sections: [{
        title: "围桌",
        body: "这是已保存的 AI 章节。",
        sourceMemoryIds: ["memory-1"],
        sourceLabels: ["妈妈的除夕回忆"],
      }],
      share: { showBody: true, showSourceTitles: true, showOriginalText: false },
    }), {});
    expect(JSON.stringify(createSharedBookSnapshot.mock.calls[0][0])).not.toContain("绝不能进入公开快照");
    expect(JSON.stringify(createSharedBookSnapshot.mock.calls[0][0])).not.toContain("private.example");
    expect(result).toEqual({
      kind: "completed",
      operationId: "operation-share-1",
      status: 201,
      response: { token: "a".repeat(64), url: `/share/${"a".repeat(64)}` },
    });
  });

  it("uses the synchronous idempotency transaction for default snapshot sharing", async () => {
    const transaction = { book: {}, sharedBook: {}, idempotencyRecord: {} };
    getPrismaClient.mockReturnValue({ transactionRunner: true });
    findShareableBook.mockResolvedValue({
      id: "book-1",
      title: "数据库中保存的家书",
      draft: {
        title: "数据库中保存的家书",
        sourceRange: "binary_system",
        themeTemplateKey: "family_reunion",
        sourceLabels: { "memory-1": "妈妈的除夕回忆" },
        intro: "已保存的 AI 前言。",
      },
      body: "已保存的 AI 正文。",
      sections: [{ title: "围桌", body: "已保存的 AI 章节。", sourceMemoryIds: ["memory-1"] }],
      memories: [{ memoryId: "memory-1" }],
    });
    createSharedBookToken.mockReturnValue("b".repeat(64));
    createSharedBookSnapshot.mockResolvedValue({ id: "shared-1", token: "b".repeat(64) });
    executeIdempotentDbOperation.mockImplementation(async (
      _database: unknown,
      _repo: unknown,
      _request: unknown,
      operation: (transaction: unknown, operationId: string) => Promise<Record<string, unknown>>,
    ) => {
      const completion = await operation(transaction, "operation-default-share-1");
      return {
        kind: "completed",
        operationId: "operation-default-share-1",
        status: completion.responseStatus,
        response: completion.response,
      };
    });

    const result = await (bookServiceWithSharing.createBookShare as unknown as (
      scope: { userId: string; galaxyId: string },
      bookId: string,
      input: { showBody: boolean; showSourceTitles: boolean; showOriginalText: boolean; idempotencyKey: string },
    ) => Promise<unknown>)(scope, "book-1", {
      showBody: true,
      showSourceTitles: true,
      showOriginalText: false,
      idempotencyKey: "book-share-default-key",
    });

    expect(executeIdempotentDbOperation).toHaveBeenCalledWith(
      { transactionRunner: true },
      prismaIdempotencyRepository,
      expect.objectContaining({ scope: "book:share:create", key: "book-share-default-key" }),
      expect.any(Function),
    );
    expect(findShareableBook).toHaveBeenCalledWith({ ...scope, bookId: "book-1" }, transaction);
    expect(createSharedBookSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      bookId: "book-1",
      legacySnapshot: false,
      token: "b".repeat(64),
    }), transaction);
    expect(result).toEqual({
      kind: "completed",
      operationId: "operation-default-share-1",
      status: 201,
      response: { token: "b".repeat(64), url: `/share/${"b".repeat(64)}` },
    });
  });

  it("revokes only the scoped snapshot and treats a repeated revocation as safe", async () => {
    const revokeSharedBookSnapshot = vi.fn().mockResolvedValue({ kind: "already_revoked", id: "shared-1" });
    const executeIdempotentDbOperation = vi.fn(async (
      _request: unknown,
      operation: (transaction: unknown, operationId: string) => Promise<Record<string, unknown>>,
    ) => {
      const completion = await operation({}, "operation-revoke-1");
      return {
        kind: "completed",
        operationId: "operation-revoke-1",
        status: completion.responseStatus,
        response: completion.response,
      };
    });

    const result = await bookServiceWithSharing.revokeBookShare(
      scope,
      "book-1",
      "c".repeat(64),
      { idempotencyKey: "book-revoke-key-00001" },
      { executeIdempotentDbOperation, revokeSharedBookSnapshot },
    );

    expect(revokeSharedBookSnapshot).toHaveBeenCalledWith({
      ...scope,
      bookId: "book-1",
      token: "c".repeat(64),
    }, {});
    expect(result).toEqual({
      kind: "completed",
      operationId: "operation-revoke-1",
      status: 200,
      response: { token: "c".repeat(64), revoked: true },
    });
  });
});
