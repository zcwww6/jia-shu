import { Prisma, type PrismaClient } from "@prisma/client";

import { getPrismaClient } from "@/server/db/client";

export type IdempotencyScope = {
  userId: string;
  galaxyId: string;
  scope: string;
  key: string;
};

export type IdempotencyDatabaseClient = Pick<PrismaClient, "idempotencyRecord">;

export async function findIdempotencyRecord(
  input: IdempotencyScope,
  client?: IdempotencyDatabaseClient,
) {
  const prisma = client ?? getPrismaClient();

  return prisma.idempotencyRecord.findUnique({
    where: {
      userId_galaxyId_scope_key: input,
    },
  });
}

export async function createProcessingIdempotencyRecord(input: IdempotencyScope & {
  requestHash: string;
  expiresAt: Date;
}, client?: IdempotencyDatabaseClient) {
  const prisma = client ?? getPrismaClient();

  return prisma.idempotencyRecord.create({
    data: {
      ...input,
      status: "processing",
    },
  });
}

export async function completeIdempotencyRecord(input: IdempotencyScope & {
  operationId: string;
  resourceType: string;
  resourceId: string;
  result: Prisma.InputJsonValue;
  response: Prisma.InputJsonValue;
  responseStatus: number;
  completedAt: Date;
}, client?: IdempotencyDatabaseClient) {
  const prisma = client ?? getPrismaClient();

  return prisma.idempotencyRecord.updateMany({
    where: {
      ...scopeWhere(input),
      operationId: input.operationId,
      status: "processing",
    },
    data: {
      status: "completed",
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      result: input.result,
      response: input.response,
      responseStatus: input.responseStatus,
      completedAt: input.completedAt,
    },
  });
}

export function isIdempotencyCreateConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export const prismaIdempotencyRepository = {
  findByScope: findIdempotencyRecord,
  createProcessing: createProcessingIdempotencyRecord,
  complete: completeIdempotencyRecord,
  isCreateConflict: isIdempotencyCreateConflict,
};

function scopeWhere(input: IdempotencyScope) {
  return {
    userId: input.userId,
    galaxyId: input.galaxyId,
    scope: input.scope,
    key: input.key,
  };
}
