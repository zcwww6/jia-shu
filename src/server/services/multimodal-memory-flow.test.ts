import { beforeEach, describe, expect, it, vi } from "vitest";

const { getPrismaClient } = vi.hoisted(() => ({ getPrismaClient: vi.fn() }));
const { lockActivePlanetForMemory } = vi.hoisted(() => ({ lockActivePlanetForMemory: vi.fn() }));
const {
  createMemoryWithAssets,
  createMemoryWithTextAsset,
  findActiveMemory,
  lockAssetsForMemory,
  lockActiveDraftMemoryForAiJob,
} = vi.hoisted(() => ({
  createMemoryWithAssets: vi.fn(),
  createMemoryWithTextAsset: vi.fn(),
  findActiveMemory: vi.fn(),
  lockAssetsForMemory: vi.fn(),
  lockActiveDraftMemoryForAiJob: vi.fn(),
}));
const { lockReadableMemoryAssetsForAiJob } = vi.hoisted(() => ({ lockReadableMemoryAssetsForAiJob: vi.fn() }));
const { createAiJob, findActiveMemoryAiJobsForMemory } = vi.hoisted(() => ({
  createAiJob: vi.fn(),
  findActiveMemoryAiJobsForMemory: vi.fn(),
}));
const { executeIdempotentDbOperation } = vi.hoisted(() => ({ executeIdempotentDbOperation: vi.fn() }));
const { assertMemoryAiCapabilitiesConfigured } = vi.hoisted(() => ({ assertMemoryAiCapabilitiesConfigured: vi.fn() }));

vi.mock("@/server/db/client", () => ({ getPrismaClient }));
vi.mock("@/server/db/planet-repo", () => ({ lockActivePlanetForMemory }));
vi.mock("@/server/db/memory-repo", () => ({
  createMemoryWithAssets,
  createMemoryWithTextAsset,
  findActiveMemory,
  lockAssetsForMemory,
  lockActiveDraftMemoryForAiJob,
}));
vi.mock("@/server/db/asset-repo", () => ({ lockReadableMemoryAssetsForAiJob }));
vi.mock("@/server/db/ai-job-repo", () => ({ createAiJob, findActiveMemoryAiJobsForMemory }));
vi.mock("@/server/db/idempotency-repo", () => ({ prismaIdempotencyRepository: {} }));
vi.mock("@/server/services/idempotency.service", () => ({ executeIdempotentDbOperation }));
vi.mock("@/server/ai/openai-client", () => ({ assertMemoryAiCapabilitiesConfigured }));

import { createMemoryAiJob } from "./ai-job.service";
import { createAssetBackedMemory } from "./memory.service";

const scope = { userId: "user-1", galaxyId: "galaxy-1" };
const planetId = "ck8m3x8xy000000000000000";

function fixtureFor(kind: "text" | "image" | "audio" | "document") {
  const sourceText = kind === "text" ? "妈妈在除夕包饺子。" : "这是用户补充的上下文。";
  const assetIds = kind === "text" ? [] : [`asset-${kind}`];
  const assets = kind === "text" ? [{
    id: "asset-text",
    kind: "text" as const,
    sha256: "text-hash",
    visibility: "private" as const,
  }] : [{
    id: `asset-${kind}`,
    kind,
    sha256: `${kind}-hash`,
    visibility: "private" as const,
  }];
  const jobKind = kind === "text"
    ? "text_extraction"
    : kind === "image"
      ? "image_extraction"
      : kind === "audio"
        ? "audio_transcription"
        : "document_extraction";

  return { kind, sourceText, assetIds, assets, jobKind };
}

describe("multimodal memory service flow", () => {
  beforeEach(() => {
    getPrismaClient.mockReset();
    lockActivePlanetForMemory.mockReset();
    createMemoryWithAssets.mockReset();
    createMemoryWithTextAsset.mockReset();
    findActiveMemory.mockReset();
    lockAssetsForMemory.mockReset();
    lockActiveDraftMemoryForAiJob.mockReset();
    lockReadableMemoryAssetsForAiJob.mockReset();
    createAiJob.mockReset();
    findActiveMemoryAiJobsForMemory.mockReset();
    executeIdempotentDbOperation.mockReset();
    assertMemoryAiCapabilitiesConfigured.mockReset();
  });

  it.each(["text", "image", "audio", "document"] as const)(
    "creates a %s draft first, then queues its consented pipeline without confirmation",
    async (kind) => {
      const fixture = fixtureFor(kind);
      const memory = {
        id: `memory-${kind}`,
        userId: scope.userId,
        galaxyId: scope.galaxyId,
        planetId,
        sourceText: fixture.sourceText,
        title: null,
        summary: null,
        tags: null,
        uncertainFields: null,
        occurredAtLabel: null,
        occurredAt: null,
        visibility: "private" as const,
        allowResonance: false,
        allowBook: false,
        status: "draft" as const,
        confirmedAt: null,
        version: 1,
        embedding: null,
        embeddingModel: null,
        deletedAt: null,
        purgeAfter: null,
        createdAt: new Date("2026-07-19T00:00:00.000Z"),
        updatedAt: new Date("2026-07-19T00:00:00.000Z"),
      };
      const transaction = {};
      getPrismaClient.mockReturnValue({ $transaction: vi.fn() });
      lockActivePlanetForMemory.mockResolvedValue([{ id: planetId }]);
      lockAssetsForMemory.mockResolvedValue(fixture.assets);
      createMemoryWithTextAsset.mockResolvedValue(memory);
      createMemoryWithAssets.mockResolvedValue(memory);
      findActiveMemory.mockResolvedValue(memory);
      lockActiveDraftMemoryForAiJob.mockResolvedValue([{ ...memory }]);
      lockReadableMemoryAssetsForAiJob.mockResolvedValue(fixture.assets);
      findActiveMemoryAiJobsForMemory.mockResolvedValue([]);
      createAiJob.mockResolvedValue({
        id: `job-${kind}`,
        kind: fixture.jobKind,
        status: "queued",
        attempts: 0,
        errorCode: null,
        completedAt: null,
      });
      executeIdempotentDbOperation.mockImplementation(async (_database, _repo, _input, operation) => {
        const completion = await operation(transaction, "operation-1");
        return {
          kind: "completed",
          operationId: "operation-1",
          response: completion.response,
          status: completion.responseStatus,
        };
      });

      const created = await createAssetBackedMemory(scope, {
        planetId,
        sourceText: fixture.sourceText,
        assetIds: fixture.assetIds,
        visibility: "private",
        idempotencyKey: `memory-${kind}-create-key-01`,
      });

      expect(created).toMatchObject({
        kind: "completed",
        status: 201,
        response: { id: memory.id, status: "draft", confirmedAt: null },
      });
      expect(createAiJob).not.toHaveBeenCalled();

      if (kind === "text") {
        expect(lockAssetsForMemory).not.toHaveBeenCalled();
      } else {
        expect(lockAssetsForMemory).toHaveBeenCalledWith(expect.objectContaining({
          ...scope,
          planetId,
          assetIds: fixture.assetIds,
          visibility: "private",
        }), transaction);
      }

      const queued = await createMemoryAiJob(scope, memory.id, {
        consent: true,
        idempotencyKey: `memory-${kind}-ai-key-0001`,
      });

      expect(queued).toMatchObject({
        kind: "completed",
        status: 202,
        response: { kind: fixture.jobKind, status: "queued" },
      });
      expect(memory.status).toBe("draft");
      expect(memory.status).not.toBe("confirmed");
      expect(createAiJob).toHaveBeenCalledTimes(1);
      expect(assertMemoryAiCapabilitiesConfigured).toHaveBeenCalledWith({ sourceKind: kind });
    },
  );
});
