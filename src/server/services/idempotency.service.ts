import type { Prisma } from "@prisma/client";

import { DomainError } from "@/server/domain-error";

export const DEFAULT_PROCESSING_TTL_MS = 15 * 60 * 1000;

export type IdempotencyScope = {
  userId: string;
  galaxyId: string;
  scope: string;
  key: string;
};

export type BeginIdempotentRequestInput = IdempotencyScope & {
  requestHash: string;
};

export type IdempotencyTimingOptions = {
  now?: Date;
  processingTtlMs?: number;
};

export type StoredIdempotencyRecord = BeginIdempotentRequestInput & {
  operationId: string;
  status: string;
  expiresAt?: Date | null;
  result?: unknown | null;
  response?: unknown | null;
  responseStatus?: number | null;
};

export type CreateProcessingIdempotentRequestInput = BeginIdempotentRequestInput & {
  expiresAt: Date;
};

export type CompleteIdempotentRequestInput = IdempotencyScope & {
  operationId: string;
  resourceType: string;
  resourceId: string;
  result: Prisma.InputJsonValue;
  response: Prisma.InputJsonValue;
  responseStatus: number;
  completedAt?: Date;
};

export type IdempotencyStatus =
  | {
    kind: "completed";
    operationId: string;
    response: unknown;
    status: number;
  }
  | {
    kind: "processing";
    operationId: string;
    status: 202;
  }
  | {
    kind: "expired";
    operationId: string;
    status: 409;
    recovery: "query_or_reconcile";
  };

export type IdempotentDbOperationCompletion = Omit<CompleteIdempotentRequestInput, "operationId" | "completedAt" | keyof IdempotencyScope>;

export interface IdempotencyRepository<TTransaction = undefined> {
  findByScope(input: IdempotencyScope, transaction?: TTransaction): Promise<StoredIdempotencyRecord | null>;
  createProcessing(input: CreateProcessingIdempotentRequestInput, transaction?: TTransaction): Promise<StoredIdempotencyRecord>;
  complete(input: Omit<CompleteIdempotentRequestInput, "completedAt"> & { completedAt: Date }, transaction?: TTransaction): Promise<{ count: number }>;
  isCreateConflict(error: unknown): boolean;
}

export interface IdempotencyTransactionRunner {
  $transaction<T>(callback: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T>;
}

/**
 * Begins an idempotent operation for asynchronous work. Expiration never grants a
 * new caller permission to reclaim the key; callers must query or reconcile the
 * recorded operation instead. A late original operation can still call complete.
 */
export async function beginIdempotentRequest(
  repo: IdempotencyRepository,
  input: BeginIdempotentRequestInput,
  options: IdempotencyTimingOptions = {},
) {
  const timing = resolveProcessingTiming(options);
  const { now } = timing;
  const existing = await getExistingIdempotentRequest(repo, input, { now });

  if (existing) {
    return existing;
  }

  try {
    const created = await repo.createProcessing(createProcessingInput(input, timing.expiresAt));
    return {
      kind: "started" as const,
      operationId: created.operationId,
    };
  } catch (error) {
    if (!repo.isCreateConflict(error)) {
      throw error;
    }

    const winner = await repo.findByScope(scopeOf(input));

    if (!winner) {
      throw error;
    }

    return resolveExistingRecord(winner, input.requestHash, now);
  }
}

/**
 * Checks a request's existing scoped record without creating processing state.
 * The returned status is safe to replay and a reused key with another hash
 * still raises the same conflict as beginIdempotentRequest.
 */
export async function getExistingIdempotentRequest(
  repo: IdempotencyRepository,
  input: BeginIdempotentRequestInput,
  options: Pick<IdempotencyTimingOptions, "now"> = {},
): Promise<IdempotencyStatus | null> {
  const record = await repo.findByScope(scopeOf(input));

  return record ? resolveExistingRecord(record, input.requestHash, options.now ?? new Date()) : null;
}

/**
 * Returns only a scoped, recovery-safe view of an operation. The request hash is
 * intentionally not exposed, and a missing expiration is treated as unresolved.
 */
export async function getIdempotencyStatus(
  repo: IdempotencyRepository,
  input: IdempotencyScope,
  options: IdempotencyTimingOptions = {},
): Promise<IdempotencyStatus | null> {
  const record = await repo.findByScope(scopeOf(input));

  return record ? statusFromRecord(record, options.now ?? new Date()) : null;
}

export async function completeIdempotentRequest(
  repo: IdempotencyRepository,
  input: CompleteIdempotentRequestInput,
) {
  const { completedAt = new Date(), ...completion } = input;
  const result = await repo.complete({
    ...completion,
    completedAt,
  });

  assertSingleCompletion(result.count);
  return result;
}

/**
 * Runs a synchronous resource write and idempotency completion in the same
 * PostgreSQL interactive transaction. The callback must use the transaction
 * client it receives; never use this primitive for external AI or media effects.
 * Those operations need an outbox, operationId, and reconciliation workflow in
 * Task 7 because a database transaction cannot roll back external side effects.
 */
export async function executeIdempotentDbOperation(
  database: IdempotencyTransactionRunner,
  repo: IdempotencyRepository<Prisma.TransactionClient>,
  input: BeginIdempotentRequestInput,
  operation: (
    transaction: Prisma.TransactionClient,
    operationId: string,
  ) => Promise<IdempotentDbOperationCompletion>,
  options: IdempotencyTimingOptions = {},
): Promise<IdempotencyStatus> {
  const timing = resolveProcessingTiming(options);

  try {
    return await executeTransactionalAttempt(database, repo, input, operation, timing.now, timing.expiresAt);
  } catch (error) {
    if (!(error instanceof IdempotencyCreateRaceError)) {
      throw error;
    }

    return database.$transaction(async (transaction) => {
      const winner = await repo.findByScope(scopeOf(input), transaction);

      if (!winner) {
        throw error.originalError;
      }

      return resolveExistingRecord(winner, input.requestHash, timing.now);
    });
  }
}

async function executeTransactionalAttempt(
  database: IdempotencyTransactionRunner,
  repo: IdempotencyRepository<Prisma.TransactionClient>,
  input: BeginIdempotentRequestInput,
  operation: (
    transaction: Prisma.TransactionClient,
    operationId: string,
  ) => Promise<IdempotentDbOperationCompletion>,
  now: Date,
  expiresAt: Date,
): Promise<IdempotencyStatus> {
  return database.$transaction(async (transaction) => {
    const existing = await repo.findByScope(scopeOf(input), transaction);

    if (existing) {
      return resolveExistingRecord(existing, input.requestHash, now);
    }

    let created: StoredIdempotencyRecord;

    try {
      created = await repo.createProcessing(createProcessingInput(input, expiresAt), transaction);
    } catch (error) {
      if (repo.isCreateConflict(error)) {
        throw new IdempotencyCreateRaceError(error);
      }

      throw error;
    }

    const completion = await operation(transaction, created.operationId);
    const result = await repo.complete({
      ...scopeOf(input),
      operationId: created.operationId,
      ...completion,
      completedAt: now,
    }, transaction);

    assertSingleCompletion(result.count);

    return {
      kind: "completed",
      operationId: created.operationId,
      response: completion.response,
      status: completion.responseStatus,
    };
  });
}

function createProcessingInput(
  input: BeginIdempotentRequestInput,
  expiresAt: Date,
): CreateProcessingIdempotentRequestInput {
  return {
    ...input,
    expiresAt,
  };
}

function resolveProcessingTiming(options: IdempotencyTimingOptions) {
  const now = options.now ?? new Date();
  const processingTtlMs = options.processingTtlMs ?? DEFAULT_PROCESSING_TTL_MS;
  const expiresAt = new Date(now.getTime() + processingTtlMs);

  if (
    !Number.isFinite(now.getTime())
    || !Number.isSafeInteger(processingTtlMs)
    || processingTtlMs <= 0
    || !Number.isFinite(expiresAt.getTime())
  ) {
    throw new DomainError("INVALID_IDEMPOTENCY_TTL", 400, "幂等处理时限无效。");
  }

  return { now, expiresAt };
}

function resolveExistingRecord(
  record: StoredIdempotencyRecord,
  requestHash: string,
  now: Date,
): IdempotencyStatus {
  if (record.requestHash !== requestHash) {
    throw new DomainError("IDEMPOTENCY_CONFLICT", 409, "幂等请求与原始请求不一致。");
  }

  return statusFromRecord(record, now);
}

function statusFromRecord(record: StoredIdempotencyRecord, now: Date): IdempotencyStatus {
  if (record.status === "completed") {
    return {
      kind: "completed",
      operationId: record.operationId,
      response: record.response ?? record.result ?? null,
      status: record.responseStatus ?? 200,
    };
  }

  if (!record.expiresAt || record.expiresAt.getTime() <= now.getTime()) {
    return {
      kind: "expired",
      operationId: record.operationId,
      status: 409,
      recovery: "query_or_reconcile",
    };
  }

  return {
    kind: "processing",
    operationId: record.operationId,
    status: 202,
  };
}

function assertSingleCompletion(count: number) {
  if (count !== 1) {
    throw new DomainError("IDEMPOTENCY_CONFLICT", 409, "幂等请求状态已变更，请检查后重试。");
  }
}

function scopeOf(input: IdempotencyScope): IdempotencyScope {
  return {
    userId: input.userId,
    galaxyId: input.galaxyId,
    scope: input.scope,
    key: input.key,
  };
}

class IdempotencyCreateRaceError extends Error {
  constructor(public readonly originalError: unknown) {
    super("Idempotency create raced with another request.");
    this.name = "IdempotencyCreateRaceError";
  }
}
