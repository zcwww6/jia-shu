import { beforeEach, describe, expect, it, vi } from "vitest";

const { getPrismaClient } = vi.hoisted(() => ({
  getPrismaClient: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  getPrismaClient,
}));

import {
  completeIdempotencyRecord,
  createProcessingIdempotencyRecord,
  findIdempotencyRecord,
} from "./idempotency-repo";

const scope = {
  userId: "user-1",
  galaxyId: "galaxy-1",
  scope: "memory:create",
  key: "abcdefghijklmnop",
};

describe("idempotency repo", () => {
  beforeEach(() => {
    getPrismaClient.mockReset();
  });

  it("creates a processing record scoped by user, galaxy, operation scope, and key", async () => {
    const create = vi.fn().mockResolvedValue({ operationId: "operation-1" });
    getPrismaClient.mockReturnValue({ idempotencyRecord: { create } });
    const expiresAt = new Date("2026-07-16T00:15:00.000Z");

    await createProcessingIdempotencyRecord({ ...scope, requestHash: "hash-a", expiresAt });

    expect(create).toHaveBeenCalledWith({
      data: { ...scope, requestHash: "hash-a", expiresAt, status: "processing" },
    });
  });

  it("uses a supplied transaction delegate for scoped lookup, create, and completion", async () => {
    const globalFindUnique = vi.fn();
    const globalCreate = vi.fn();
    const globalUpdateMany = vi.fn();
    const findUnique = vi.fn().mockResolvedValue(null);
    const create = vi.fn().mockResolvedValue({ operationId: "operation-1" });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = {
      idempotencyRecord: { findUnique, create, updateMany },
    };
    const completedAt = new Date("2026-07-16T00:00:00.000Z");
    const expiresAt = new Date("2026-07-16T00:15:00.000Z");
    getPrismaClient.mockReturnValue({
      idempotencyRecord: {
        findUnique: globalFindUnique,
        create: globalCreate,
        updateMany: globalUpdateMany,
      },
    });

    await findIdempotencyRecord(scope, transaction as never);
    await createProcessingIdempotencyRecord({ ...scope, requestHash: "hash-a", expiresAt }, transaction as never);
    await completeIdempotencyRecord({
      ...scope,
      operationId: "operation-1",
      resourceType: "memory",
      resourceId: "memory-1",
      result: { id: "memory-1" },
      response: { id: "memory-1", status: "draft" },
      responseStatus: 201,
      completedAt,
    }, transaction as never);

    expect(findUnique).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
    expect(updateMany).toHaveBeenCalledOnce();
    expect(globalFindUnique).not.toHaveBeenCalled();
    expect(globalCreate).not.toHaveBeenCalled();
    expect(globalUpdateMany).not.toHaveBeenCalled();
  });

  it("rereads the exact composite idempotency scope", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    getPrismaClient.mockReturnValue({ idempotencyRecord: { findUnique } });

    await findIdempotencyRecord(scope);

    expect(findUnique).toHaveBeenCalledWith({
      where: { userId_galaxyId_scope_key: scope },
    });
  });

  it("completes only the processing record in the same scope and writes the cached response", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    getPrismaClient.mockReturnValue({ idempotencyRecord: { updateMany } });
    const completedAt = new Date("2026-07-16T00:00:00.000Z");

    await completeIdempotencyRecord({
      ...scope,
      operationId: "operation-1",
      resourceType: "memory",
      resourceId: "memory-1",
      result: { id: "memory-1" },
      response: { id: "memory-1", status: "draft" },
      responseStatus: 201,
      completedAt,
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: { ...scope, operationId: "operation-1", status: "processing" },
      data: {
        status: "completed",
        resourceType: "memory",
        resourceId: "memory-1",
        result: { id: "memory-1" },
        response: { id: "memory-1", status: "draft" },
        responseStatus: 201,
        completedAt,
      },
    });
  });
});
