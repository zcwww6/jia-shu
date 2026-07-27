import { describe, expect, it, vi } from "vitest";

import * as idempotencyService from "./idempotency.service";
import {
  beginIdempotentRequest,
  completeIdempotentRequest,
  getExistingIdempotentRequest,
  type IdempotencyRepository,
} from "./idempotency.service";

const input = {
  userId: "user-1",
  galaxyId: "galaxy-1",
  scope: "memory:create",
  key: "abcdefghijklmnop",
  requestHash: "hash-a",
};

const scope = {
  userId: input.userId,
  galaxyId: input.galaxyId,
  scope: input.scope,
  key: input.key,
};

function repo(overrides: Partial<IdempotencyRepository> = {}): IdempotencyRepository {
  return {
    findByScope: vi.fn().mockResolvedValue(null),
    createProcessing: vi.fn().mockResolvedValue({
      ...input,
      operationId: "operation-1",
      status: "processing",
    }),
    complete: vi.fn().mockResolvedValue({ count: 1 }),
    isCreateConflict: vi.fn().mockReturnValue(false),
    ...overrides,
  };
}

type TransactionJournal = {
  businessWrites: string[];
  idempotencyWrites: string[];
};

type TestTransaction = {
  journal: TransactionJournal;
};

function transactionHarness() {
  const commits: TransactionJournal[] = [];
  const rollbacks: TransactionJournal[] = [];
  const db = {
    $transaction: vi.fn(async (callback: (transaction: TestTransaction) => Promise<unknown>) => {
      const journal: TransactionJournal = { businessWrites: [], idempotencyWrites: [] };

      try {
        const result = await callback({ journal });
        commits.push(journal);
        return result;
      } catch (error) {
        rollbacks.push(journal);
        throw error;
      }
    }),
  };

  return { db, commits, rollbacks };
}

function transactionalRepo(overrides: Record<string, unknown> = {}) {
  const repository = {
    findByScope: vi.fn().mockResolvedValue(null),
    createProcessing: vi.fn(async (_request: unknown, transaction: TestTransaction) => {
      transaction.journal.idempotencyWrites.push("processing");
      return { ...input, operationId: "operation-1", status: "processing" };
    }),
    complete: vi.fn(async (_completion: unknown, transaction: TestTransaction) => {
      transaction.journal.idempotencyWrites.push("completed");
      return { count: 1 };
    }),
    isCreateConflict: vi.fn().mockReturnValue(false),
  };

  return { ...repository, ...overrides };
}

const successfulCompletion = {
  resourceType: "memory",
  resourceId: "memory-1",
  result: { id: "memory-1" },
  response: { id: "memory-1", status: "draft" },
  responseStatus: 201,
};

describe("idempotency service", () => {
  it("preflights a matching existing request without creating processing state", async () => {
    const idempotencyRepo = repo({
      findByScope: vi.fn().mockResolvedValue({
        ...input,
        operationId: "operation-cached",
        status: "completed",
        response: { id: "memory-1", status: "draft" },
        responseStatus: 201,
      }),
    });
    await expect(getExistingIdempotentRequest(
      idempotencyRepo,
      input,
      { now: new Date("2026-07-17T00:00:00.000Z") },
    )).resolves.toEqual({
      kind: "completed",
      operationId: "operation-cached",
      response: { id: "memory-1", status: "draft" },
      status: 201,
    });
    expect(idempotencyRepo.createProcessing).not.toHaveBeenCalled();
  });

  it("starts the first request with a newly allocated operation id", async () => {
    const idempotencyRepo = repo();
    const now = new Date("2026-07-17T00:00:00.000Z");

    await expect(beginIdempotentRequest(idempotencyRepo, input, { now, processingTtlMs: 60_000 })).resolves.toEqual({
      kind: "started",
      operationId: "operation-1",
    });
    expect(idempotencyRepo.createProcessing).toHaveBeenCalledWith({
      ...input,
      expiresAt: new Date("2026-07-17T00:01:00.000Z"),
    });
  });

  it("rejects invalid processing TTL configuration before it reaches the repository", async () => {
    const now = new Date("2026-07-17T00:00:00.000Z");

    for (const processingTtlMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER]) {
      const idempotencyRepo = repo();

      await expect(
        beginIdempotentRequest(idempotencyRepo, input, { now, processingTtlMs }),
      ).rejects.toMatchObject({ code: "INVALID_IDEMPOTENCY_TTL", status: 400 });
      expect(idempotencyRepo.findByScope).not.toHaveBeenCalled();
      expect(idempotencyRepo.createProcessing).not.toHaveBeenCalled();
    }
  });

  it("returns the cached completed response for the same key and request hash", async () => {
    const idempotencyRepo = repo({
      findByScope: vi.fn().mockResolvedValue({
        ...input,
        operationId: "operation-1",
        status: "completed",
        response: { id: "memory-1", status: "draft" },
        responseStatus: 201,
      }),
    });

    await expect(beginIdempotentRequest(idempotencyRepo, input)).resolves.toEqual({
      kind: "completed",
      operationId: "operation-1",
      response: { id: "memory-1", status: "draft" },
      status: 201,
    });
    expect(idempotencyRepo.createProcessing).not.toHaveBeenCalled();
  });

  it("rejects a reused key with a different request hash", async () => {
    const idempotencyRepo = repo({
      findByScope: vi.fn().mockResolvedValue({
        ...input,
        requestHash: "hash-b",
        operationId: "operation-1",
        status: "processing",
      }),
    });

    await expect(beginIdempotentRequest(idempotencyRepo, input)).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
      status: 409,
    });
  });

  it("returns accepted processing semantics for a matching in-flight request", async () => {
    const now = new Date("2026-07-17T00:00:00.000Z");
    const idempotencyRepo = repo({
      findByScope: vi.fn().mockResolvedValue({
        ...input,
        operationId: "operation-1",
        status: "processing",
        expiresAt: new Date("2026-07-17T00:01:00.000Z"),
      }),
    });

    await expect(beginIdempotentRequest(idempotencyRepo, input, { now })).resolves.toEqual({
      kind: "processing",
      operationId: "operation-1",
      status: 202,
    });
  });

  it("returns a recoverable expired result without reclaiming a matching processing key", async () => {
    const now = new Date("2026-07-17T00:00:00.000Z");
    const idempotencyRepo = repo({
      findByScope: vi.fn().mockResolvedValue({
        ...input,
        operationId: "operation-expired",
        status: "processing",
        expiresAt: new Date("2026-07-16T23:59:59.999Z"),
      }),
    });

    await expect(beginIdempotentRequest(idempotencyRepo, input, { now })).resolves.toEqual({
      kind: "expired",
      operationId: "operation-expired",
      status: 409,
      recovery: "query_or_reconcile",
    });
    expect(idempotencyRepo.createProcessing).not.toHaveBeenCalled();
  });

  it("treats legacy processing records without an expiration as unresolved instead of permanent 202", async () => {
    const idempotencyRepo = repo({
      findByScope: vi.fn().mockResolvedValue({
        ...input,
        operationId: "operation-legacy",
        status: "processing",
        expiresAt: null,
      }),
    });

    await expect(beginIdempotentRequest(idempotencyRepo, input, { now: new Date("2026-07-17T00:00:00.000Z") })).resolves.toEqual({
      kind: "expired",
      operationId: "operation-legacy",
      status: 409,
      recovery: "query_or_reconcile",
    });
  });

  it("exposes a scoped status lookup without revealing the request hash", async () => {
    const idempotencyRepo = repo({
      findByScope: vi.fn().mockResolvedValue({
        ...input,
        operationId: "operation-1",
        status: "completed",
        response: { id: "memory-1", status: "draft" },
        responseStatus: 201,
      }),
    });

    await expect(
      idempotencyService.getIdempotencyStatus(idempotencyRepo, scope, { now: new Date("2026-07-17T00:00:00.000Z") }),
    ).resolves.toEqual({
      kind: "completed",
      operationId: "operation-1",
      response: { id: "memory-1", status: "draft" },
      status: 201,
    });
    expect(idempotencyRepo.findByScope).toHaveBeenCalledWith(scope);
  });

  it("rereads after a P2002 create race and returns the winning processing operation", async () => {
    const uniqueError = new Error("P2002");
    const now = new Date("2026-07-17T00:00:00.000Z");
    const idempotencyRepo = repo({
      findByScope: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          ...input,
          operationId: "operation-race",
          status: "processing",
          expiresAt: new Date("2026-07-17T00:01:00.000Z"),
        }),
      createProcessing: vi.fn().mockRejectedValue(uniqueError),
      isCreateConflict: vi.fn().mockReturnValue(true),
    });

    await expect(beginIdempotentRequest(idempotencyRepo, input, { now })).resolves.toEqual({
      kind: "processing",
      operationId: "operation-race",
      status: 202,
    });
    expect(idempotencyRepo.isCreateConflict).toHaveBeenCalledWith(uniqueError);
    expect(idempotencyRepo.findByScope).toHaveBeenCalledTimes(2);
  });

  it("writes resource, cached response, response status, and completion time through the injected repo", async () => {
    const idempotencyRepo = repo();
    const completedAt = new Date("2026-07-16T00:00:00.000Z");

    await completeIdempotentRequest(idempotencyRepo, {
      ...input,
      operationId: "operation-1",
      resourceType: "memory",
      resourceId: "memory-1",
      result: { id: "memory-1" },
      response: { id: "memory-1", status: "draft" },
      responseStatus: 201,
      completedAt,
    });

    expect(idempotencyRepo.complete).toHaveBeenCalledWith({
      ...input,
      operationId: "operation-1",
      resourceType: "memory",
      resourceId: "memory-1",
      result: { id: "memory-1" },
      response: { id: "memory-1", status: "draft" },
      responseStatus: 201,
      completedAt,
    });
  });

  it("rejects completion when no scoped processing record was updated", async () => {
    const idempotencyRepo = repo({
      complete: vi.fn().mockResolvedValue({ count: 0 }),
    });

    await expect(
      completeIdempotentRequest(idempotencyRepo, {
        ...input,
        operationId: "operation-1",
        resourceType: "memory",
        resourceId: "memory-1",
        result: { id: "memory-1" },
        response: { id: "memory-1", status: "draft" },
        responseStatus: 201,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", status: 409 });
  });

  it("allows the original operation to complete after its begin response became expired", async () => {
    const idempotencyRepo = repo({
      findByScope: vi.fn().mockResolvedValue({
        ...input,
        operationId: "operation-expired",
        status: "processing",
        expiresAt: new Date("2026-07-16T23:59:59.999Z"),
      }),
    });

    await expect(beginIdempotentRequest(idempotencyRepo, input, { now: new Date("2026-07-17T00:00:00.000Z") })).resolves.toMatchObject({
      kind: "expired",
      operationId: "operation-expired",
    });
    await expect(
      completeIdempotentRequest(idempotencyRepo, {
        ...input,
        operationId: "operation-expired",
        ...successfulCompletion,
      }),
    ).resolves.toEqual({ count: 1 });
  });

  it("commits synchronous resource writes and idempotency completion together", async () => {
    const harness = transactionHarness();
    const idempotencyRepo = transactionalRepo();
    const now = new Date("2026-07-17T00:00:00.000Z");

    await expect(
      idempotencyService.executeIdempotentDbOperation(
        harness.db as never,
        idempotencyRepo as never,
        input,
        async (transaction, operationId) => {
          (transaction as unknown as TestTransaction).journal.businessWrites.push(`memory:${operationId}`);
          return successfulCompletion;
        },
        { now, processingTtlMs: 60_000 },
      ),
    ).resolves.toEqual({
      kind: "completed",
      operationId: "operation-1",
      response: { id: "memory-1", status: "draft" },
      status: 201,
    });
    expect(harness.commits).toEqual([
      { businessWrites: ["memory:operation-1"], idempotencyWrites: ["processing", "completed"] },
    ]);
    expect(harness.rollbacks).toEqual([]);
    expect(idempotencyRepo.createProcessing).toHaveBeenCalledWith({
      ...input,
      expiresAt: new Date("2026-07-17T00:01:00.000Z"),
    }, expect.anything());
    expect(idempotencyRepo.complete).toHaveBeenCalledWith({
      ...scope,
      operationId: "operation-1",
      ...successfulCompletion,
      completedAt: now,
    }, expect.anything());
  });

  it("rolls back the resource write and processing record when completion fails", async () => {
    const harness = transactionHarness();
    const completionError = new Error("completion unavailable");
    const idempotencyRepo = transactionalRepo({
      complete: vi.fn(async (_completion: unknown, transaction: TestTransaction) => {
        transaction.journal.idempotencyWrites.push("completion-attempt");
        throw completionError;
      }),
    });

    await expect(
      idempotencyService.executeIdempotentDbOperation(
        harness.db as never,
        idempotencyRepo as never,
        input,
        async (transaction) => {
          (transaction as unknown as TestTransaction).journal.businessWrites.push("memory-1");
          return successfulCompletion;
        },
      ),
    ).rejects.toBe(completionError);
    expect(harness.commits).toEqual([]);
    expect(harness.rollbacks).toEqual([
      { businessWrites: ["memory-1"], idempotencyWrites: ["processing", "completion-attempt"] },
    ]);
  });

  it("rolls back the processing record when the synchronous resource callback throws", async () => {
    const harness = transactionHarness();
    const callbackError = new Error("resource write failed");
    const idempotencyRepo = transactionalRepo();

    await expect(
      idempotencyService.executeIdempotentDbOperation(
        harness.db as never,
        idempotencyRepo as never,
        input,
        async (transaction) => {
          (transaction as unknown as TestTransaction).journal.businessWrites.push("memory-1");
          throw callbackError;
        },
      ),
    ).rejects.toBe(callbackError);
    expect(harness.commits).toEqual([]);
    expect(harness.rollbacks).toEqual([
      { businessWrites: ["memory-1"], idempotencyWrites: ["processing"] },
    ]);
  });

  it("returns the cached completed response without executing the callback", async () => {
    const harness = transactionHarness();
    const callback = vi.fn();
    const idempotencyRepo = transactionalRepo({
      findByScope: vi.fn().mockResolvedValue({
        ...input,
        operationId: "operation-cached",
        status: "completed",
        response: { id: "memory-1", status: "draft" },
        responseStatus: 201,
      }),
    });

    await expect(
      idempotencyService.executeIdempotentDbOperation(
        harness.db as never,
        idempotencyRepo as never,
        input,
        callback,
      ),
    ).resolves.toEqual({
      kind: "completed",
      operationId: "operation-cached",
      response: { id: "memory-1", status: "draft" },
      status: 201,
    });
    expect(callback).not.toHaveBeenCalled();
    expect(idempotencyRepo.createProcessing).not.toHaveBeenCalled();
    expect(idempotencyRepo.complete).not.toHaveBeenCalled();
  });

  it("does not execute a new callback for an expired processing record", async () => {
    const harness = transactionHarness();
    const callback = vi.fn();
    const idempotencyRepo = transactionalRepo({
      findByScope: vi.fn().mockResolvedValue({
        ...input,
        operationId: "operation-expired",
        status: "processing",
        expiresAt: new Date("2026-07-16T23:59:59.999Z"),
      }),
    });

    await expect(
      idempotencyService.executeIdempotentDbOperation(
        harness.db as never,
        idempotencyRepo as never,
        input,
        callback,
        { now: new Date("2026-07-17T00:00:00.000Z") },
      ),
    ).resolves.toEqual({
      kind: "expired",
      operationId: "operation-expired",
      status: 409,
      recovery: "query_or_reconcile",
    });
    expect(callback).not.toHaveBeenCalled();
    expect(idempotencyRepo.createProcessing).not.toHaveBeenCalled();
  });

  it("rereads the P2002 winner in a new transaction without executing a duplicate callback", async () => {
    const harness = transactionHarness();
    const uniqueError = new Error("P2002");
    const callback = vi.fn();
    const idempotencyRepo = transactionalRepo({
      findByScope: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          ...input,
          operationId: "operation-winner",
          status: "completed",
          response: { id: "memory-winner" },
          responseStatus: 201,
        }),
      createProcessing: vi.fn(async (_request: unknown, transaction: TestTransaction) => {
        transaction.journal.idempotencyWrites.push("processing-race");
        throw uniqueError;
      }),
      isCreateConflict: vi.fn().mockReturnValue(true),
    });

    await expect(
      idempotencyService.executeIdempotentDbOperation(
        harness.db as never,
        idempotencyRepo as never,
        input,
        callback,
      ),
    ).resolves.toEqual({
      kind: "completed",
      operationId: "operation-winner",
      response: { id: "memory-winner" },
      status: 201,
    });
    expect(harness.db.$transaction).toHaveBeenCalledTimes(2);
    expect(callback).not.toHaveBeenCalled();
    expect(harness.commits).toEqual([{ businessWrites: [], idempotencyWrites: [] }]);
    expect(harness.rollbacks).toEqual([{ businessWrites: [], idempotencyWrites: ["processing-race"] }]);
  });
});
