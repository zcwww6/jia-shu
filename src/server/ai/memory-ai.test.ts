import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMORY_EXTRACTION_PURPOSE, memoryAiSnapshotHash } from "./memory-ai-contract";
import { TEXT_EXTRACTION_PURPOSE, textExtractionRequestHash } from "./text-extraction-request";
import type { ReadableMemoryAiAsset } from "@/server/db/asset-repo";
import { validateAsset } from "@/server/media/asset-validation";

const SERVER_IMAGE_DERIVATIVE_CAP_BYTES = 10 * 1024 * 1024;

const { getAiProvider } = vi.hoisted(() => ({ getAiProvider: vi.fn() }));
const { findActiveMemory, handoffActiveDraftMemoryToAiProcessing } = vi.hoisted(() => ({
  findActiveMemory: vi.fn(),
  handoffActiveDraftMemoryToAiProcessing: vi.fn(),
}));
const { findReadableMemoryAssetsForAiJob } = vi.hoisted(() => ({ findReadableMemoryAssetsForAiJob: vi.fn() }));
const { readPrivateAssetBytes } = vi.hoisted(() => ({ readPrivateAssetBytes: vi.fn() }));
const {
  AI_JOB_LEASE_DURATION_MS,
  completeMemoryAiJob,
  completeTextExtractionAiJob,
  findActiveMemoryAiJobsForMemory,
  findActiveTextExtractionAiJobsForMemory,
  renewMemoryAiJobLease,
  renewTextExtractionAiJobLease,
} = vi.hoisted(() => ({
  AI_JOB_LEASE_DURATION_MS: 30_000,
  completeMemoryAiJob: vi.fn(),
  completeTextExtractionAiJob: vi.fn(),
  findActiveMemoryAiJobsForMemory: vi.fn(),
  findActiveTextExtractionAiJobsForMemory: vi.fn(),
  renewMemoryAiJobLease: vi.fn(),
  renewTextExtractionAiJobLease: vi.fn(),
}));

vi.mock("./openai-client", () => ({ getAiProvider }));
vi.mock("@/server/db/memory-repo", () => ({
  findActiveMemory,
  handoffActiveDraftMemoryToAiProcessing,
}));
vi.mock("@/server/db/asset-repo", () => ({ findReadableMemoryAssetsForAiJob }));
vi.mock("@/server/media/media-store", () => ({ readPrivateAssetBytes }));
vi.mock("@/server/db/ai-job-repo", () => ({
  AI_JOB_LEASE_DURATION_MS,
  completeMemoryAiJob,
  completeTextExtractionAiJob,
  findActiveMemoryAiJobsForMemory,
  findActiveTextExtractionAiJobsForMemory,
  renewMemoryAiJobLease,
  renewTextExtractionAiJobLease,
}));

import { processMemoryAiJob, processTextExtractionAiJob } from "./memory-ai";

const job = {
  id: "job-1",
  userId: "user-1",
  galaxyId: "galaxy-1",
  memoryId: "memory-1",
  leaseToken: "lease-token",
  leaseExpiresAt: new Date("2099-07-17T00:00:30.000Z"),
  attempts: 1,
  kind: "text_extraction" as const,
  consentCapturedAt: new Date("2026-07-17T00:00:00.000Z"),
  requestHash: textExtractionRequestHash({
    memoryId: "memory-1",
    sourceText: "第一次搬进新家的晚上。",
    version: 4,
    purpose: TEXT_EXTRACTION_PURPOSE,
  }),
};

describe("text extraction memory AI", () => {
  beforeEach(() => {
    getAiProvider.mockReset();
    findActiveMemory.mockReset();
    handoffActiveDraftMemoryToAiProcessing.mockReset();
    findReadableMemoryAssetsForAiJob.mockReset();
    readPrivateAssetBytes.mockReset();
    completeMemoryAiJob.mockReset();
    completeTextExtractionAiJob.mockReset();
    findActiveMemoryAiJobsForMemory.mockReset();
    findActiveTextExtractionAiJobsForMemory.mockReset();
    renewMemoryAiJobLease.mockReset();
    renewTextExtractionAiJobLease.mockReset();
    findActiveMemoryAiJobsForMemory.mockResolvedValue([{
      id: "job-generic",
      status: "processing",
      leaseToken: "lease-token",
      leaseExpiresAt: new Date("2099-07-17T00:00:30.000Z"),
    }]);
    findActiveTextExtractionAiJobsForMemory.mockResolvedValue([{
      id: job.id,
      status: "processing",
      leaseToken: job.leaseToken,
      leaseExpiresAt: job.leaseExpiresAt,
    }]);
    renewMemoryAiJobLease.mockResolvedValue(new Date("2099-07-17T00:00:30.000Z"));
    renewTextExtractionAiJobLease.mockResolvedValue(new Date("2099-07-17T00:00:30.000Z"));
  });

  const genericFixtureFor = (
    sourceKind: "text" | "image" | "audio" | "document",
    sourceTextOverride?: string,
  ) => {
    const sourceText = sourceTextOverride ?? (sourceKind === "text" ? "妈妈在除夕包饺子。" : "这是用户补充的上下文。");
    const assets: ReadableMemoryAiAsset[] = sourceKind === "text" ? [{
      id: "asset-text",
      kind: "text" as const,
      sha256: "text-hash",
      visibility: "private" as const,
      storageKey: "internal/memory-text-meta/asset-text",
      thumbnailStorageKey: null,
      normalizedStorageKey: null,
      mimeType: "text/plain; charset=utf-8",
      originalName: "memory.txt",
      sizeBytes: 30,
      extractedText: null,
      transcript: null,
    }] : [{
      id: `asset-${sourceKind}`,
      kind: sourceKind,
      sha256: `${sourceKind}-hash`,
      visibility: "private" as const,
      storageKey: `user-1/as/asset-${sourceKind}.${sourceKind === "audio" ? "wav" : sourceKind === "document" ? "pdf" : "jpg"}`,
      thumbnailStorageKey: sourceKind === "image" ? "user-1/as/asset-image_thumbnail.jpg" : null,
      normalizedStorageKey: sourceKind === "image" ? "user-1/as/asset-image_normalized.jpg" : null,
      mimeType: sourceKind === "image" ? "image/jpeg" : sourceKind === "audio" ? "audio/wav" : "application/pdf",
      originalName: sourceKind === "image" ? "family.jpg" : sourceKind === "audio" ? "voice.wav" : "diary.pdf",
      sizeBytes: 3,
      extractedText: sourceKind === "document" ? "日记中的本地提取文字。" : null,
      transcript: null,
    }];
    const jobKind: "text_extraction" | "image_extraction" | "audio_transcription" | "document_extraction" = sourceKind === "text"
      ? "text_extraction"
      : sourceKind === "image"
        ? "image_extraction"
        : sourceKind === "audio"
          ? "audio_transcription"
          : "document_extraction";
    const job = {
      id: "job-generic",
      userId: "user-1",
      galaxyId: "galaxy-1",
      planetId: "planet-1",
      memoryId: "memory-1",
      assetId: null,
      resonanceCandidateId: null,
      bookId: null,
      kind: jobKind,
      status: "processing" as const,
      attempts: 1,
      consentCapturedAt: new Date("2026-07-17T00:00:00.000Z"),
      requestHash: memoryAiSnapshotHash({
        memoryId: "memory-1",
        sourceText,
        version: 4,
        purpose: MEMORY_EXTRACTION_PURPOSE,
        assets,
      }),
      leaseToken: "lease-token",
      leaseExpiresAt: new Date("2099-07-17T00:00:30.000Z"),
    };

    return { sourceKind, sourceText, assets, job };
  };

  it.each(["text", "image", "audio", "document"] as const)(
    "processes a %s source pipeline into a needs-confirmation draft without auto-confirming it",
    async (sourceKind) => {
      const fixture = genericFixtureFor(sourceKind);
      const extractMemory = vi.fn().mockResolvedValue({
        title: "待核对的记忆",
        summary: "AI 仅基于受控来源整理。",
        people: [],
        emotions: [],
        uncertainFields: ["people"],
      });
      const describeImage = vi.fn().mockResolvedValue({
        description: "一家人在搬家那天站在新家门口。",
        uncertainFields: ["people"],
      });
      const transcribeAudio = vi.fn().mockResolvedValue({ text: "这是搬家当天录下的声音。" });
      getAiProvider.mockReturnValue({ extractMemory, describeImage, transcribeAudio });
      findActiveMemory.mockResolvedValue({
        id: "memory-1",
        userId: "user-1",
        galaxyId: "galaxy-1",
        planetId: "planet-1",
        sourceText: fixture.sourceText,
        occurredAtLabel: "2018 年夏天",
        visibility: "private",
        status: "draft",
        version: 4,
      });
      findReadableMemoryAssetsForAiJob.mockResolvedValue(fixture.assets);
      findActiveMemoryAiJobsForMemory.mockResolvedValue([{
        id: fixture.job.id,
        status: "processing",
        leaseToken: fixture.job.leaseToken,
        leaseExpiresAt: fixture.job.leaseExpiresAt,
      }]);
      handoffActiveDraftMemoryToAiProcessing.mockResolvedValue(true);
      readPrivateAssetBytes.mockResolvedValue(new Uint8Array([1, 2, 3]));
      completeMemoryAiJob.mockResolvedValue(undefined);

      await processMemoryAiJob(fixture.job);

      expect(extractMemory).toHaveBeenCalledWith(expect.objectContaining({
        assetIds: fixture.assets.map((asset) => asset.id),
        occurredAtLabel: "2018 年夏天",
      }));
      expect(completeMemoryAiJob).toHaveBeenCalledWith({
        job: fixture.job,
        memoryVersion: 4,
        draft: expect.objectContaining({ uncertainFields: expect.arrayContaining(["people"]) }),
      });
      expect(JSON.stringify(completeMemoryAiJob.mock.calls)).not.toContain('"confirmed"');

      if (sourceKind === "image") {
        expect(describeImage).toHaveBeenCalledWith({
          imageUrl: expect.stringMatching(/^data:image\/jpeg;base64,/),
        });
        expect(readPrivateAssetBytes).toHaveBeenCalledWith(
          "user-1/as/asset-image_thumbnail.jpg",
          SERVER_IMAGE_DERIVATIVE_CAP_BYTES,
        );
        expect(renewMemoryAiJobLease).toHaveBeenCalledTimes(2);
      } else if (sourceKind === "audio") {
        expect(transcribeAudio).toHaveBeenCalledWith(expect.objectContaining({ fileName: "voice.wav" }));
        expect(readPrivateAssetBytes).toHaveBeenCalledWith("user-1/as/asset-audio.wav", 3);
        expect(renewMemoryAiJobLease).toHaveBeenCalledTimes(2);
      } else if (sourceKind === "document") {
        expect(readPrivateAssetBytes).not.toHaveBeenCalled();
        expect(renewMemoryAiJobLease).toHaveBeenCalledTimes(1);
      } else {
        expect(readPrivateAssetBytes).not.toHaveBeenCalled();
        expect(renewMemoryAiJobLease).toHaveBeenCalledTimes(1);
      }
    },
  );

  it("reads a tiny PNG's larger server-generated JPEG thumbnail with the fixed derivative cap", async () => {
    const tinyPng = await sharp({
      create: {
        width: 1,
        height: 1,
        channels: 4,
        background: { r: 1, g: 2, b: 3, alpha: 1 },
      },
    }).png({ compressionLevel: 9 }).toBuffer();
    const validated = await validateAsset({
      declaredMime: "image/png",
      bytes: tinyPng,
      originalName: "tiny.png",
      adapters: {
        detect: async () => ({ mime: "image/png", ext: "png" }),
      },
    });
    const thumbnailBytes = (validated as {
      derivatives: { thumbnailBytes: Uint8Array };
    }).derivatives.thumbnailBytes;

    expect(thumbnailBytes.byteLength).toBeGreaterThan(tinyPng.byteLength);

    const fixture = genericFixtureFor("image");
    const assets = [{ ...fixture.assets[0], sizeBytes: tinyPng.byteLength }];
    const imageJob = {
      ...fixture.job,
      requestHash: memoryAiSnapshotHash({
        memoryId: "memory-1",
        sourceText: fixture.sourceText,
        version: 4,
        purpose: MEMORY_EXTRACTION_PURPOSE,
        assets,
      }),
    };
    const extractMemory = vi.fn().mockResolvedValue({
      title: "待核对的记忆",
      summary: "AI 仅基于受控来源整理。",
      people: [],
      emotions: [],
      uncertainFields: [],
    });
    const describeImage = vi.fn().mockResolvedValue({
      description: "一张很小的图片。",
      uncertainFields: [],
    });
    getAiProvider.mockReturnValue({ extractMemory, describeImage, transcribeAudio: vi.fn() });
    findActiveMemory.mockResolvedValue({
      id: "memory-1",
      userId: "user-1",
      galaxyId: "galaxy-1",
      planetId: "planet-1",
      sourceText: fixture.sourceText,
      occurredAtLabel: null,
      visibility: "private",
      status: "draft",
      version: 4,
    });
    findReadableMemoryAssetsForAiJob.mockResolvedValue(assets);
    findActiveMemoryAiJobsForMemory.mockResolvedValue([{
      id: imageJob.id,
      status: "processing",
      leaseToken: imageJob.leaseToken,
      leaseExpiresAt: imageJob.leaseExpiresAt,
    }]);
    handoffActiveDraftMemoryToAiProcessing.mockResolvedValue(true);
    readPrivateAssetBytes.mockImplementation(async (_key, maxBytes) => {
      expect(maxBytes).toBeGreaterThanOrEqual(thumbnailBytes.byteLength);
      return thumbnailBytes;
    });
    completeMemoryAiJob.mockResolvedValue(undefined);

    await expect(processMemoryAiJob(imageJob)).resolves.toBeUndefined();

    expect(readPrivateAssetBytes).toHaveBeenCalledWith(
      "user-1/as/asset-image_thumbnail.jpg",
      SERVER_IMAGE_DERIVATIVE_CAP_BYTES,
    );
  });

  it("processes a pre-Task8 queued legacy text hash through the generic pipeline", async () => {
    const fixture = genericFixtureFor("text");
    const legacyJob = {
      ...fixture.job,
      requestHash: textExtractionRequestHash({
        memoryId: "memory-1",
        sourceText: fixture.sourceText,
        version: 4,
        purpose: TEXT_EXTRACTION_PURPOSE,
      }),
    };
    const extractMemory = vi.fn().mockResolvedValue({
      title: "待核对的文字记忆",
      summary: "来自旧队列的文字快照。",
      people: [],
      emotions: [],
      uncertainFields: [],
    });
    getAiProvider.mockReturnValue({ extractMemory, describeImage: vi.fn(), transcribeAudio: vi.fn() });
    findActiveMemory.mockResolvedValue({
      id: "memory-1",
      userId: "user-1",
      galaxyId: "galaxy-1",
      planetId: "planet-1",
      sourceText: fixture.sourceText,
      occurredAtLabel: null,
      visibility: "private",
      status: "draft",
      version: 4,
    });
    findReadableMemoryAssetsForAiJob.mockResolvedValue(fixture.assets);
    findActiveMemoryAiJobsForMemory.mockResolvedValue([{
      id: legacyJob.id,
      status: "processing",
      leaseToken: legacyJob.leaseToken,
      leaseExpiresAt: legacyJob.leaseExpiresAt,
    }]);
    handoffActiveDraftMemoryToAiProcessing.mockResolvedValue(true);
    completeMemoryAiJob.mockResolvedValue(undefined);

    await expect(processMemoryAiJob(legacyJob)).resolves.toBeUndefined();

    expect(extractMemory).toHaveBeenCalledWith(expect.objectContaining({
      sourceText: `用户补充：${fixture.sourceText}`,
      assetIds: ["asset-text"],
    }));
    expect(completeMemoryAiJob).toHaveBeenCalledWith(expect.objectContaining({
      job: legacyJob,
      memoryVersion: 4,
    }));
  });

  it("does not accept a legacy text hash when its source text has changed", async () => {
    const fixture = genericFixtureFor("text", "更新后的文字记忆。");
    const legacyJob = {
      ...fixture.job,
      requestHash: textExtractionRequestHash({
        memoryId: "memory-1",
        sourceText: "旧的文字记忆。",
        version: 4,
        purpose: TEXT_EXTRACTION_PURPOSE,
      }),
    };
    getAiProvider.mockReturnValue({ extractMemory: vi.fn(), describeImage: vi.fn(), transcribeAudio: vi.fn() });
    findActiveMemory.mockResolvedValue({
      id: "memory-1",
      userId: "user-1",
      galaxyId: "galaxy-1",
      planetId: "planet-1",
      sourceText: fixture.sourceText,
      occurredAtLabel: null,
      visibility: "private",
      status: "draft",
      version: 4,
    });
    findReadableMemoryAssetsForAiJob.mockResolvedValue(fixture.assets);

    await expect(processMemoryAiJob(legacyJob))
      .rejects.toMatchObject({ code: "AI_CONSENT_STALE", status: 409 });

    expect(getAiProvider).not.toHaveBeenCalled();
  });

  it("does not apply the legacy text-hash compatibility path to an image job", async () => {
    const fixture = genericFixtureFor("image");
    const imageJob = {
      ...fixture.job,
      requestHash: textExtractionRequestHash({
        memoryId: "memory-1",
        sourceText: fixture.sourceText,
        version: 4,
        purpose: TEXT_EXTRACTION_PURPOSE,
      }),
    };
    getAiProvider.mockReturnValue({ extractMemory: vi.fn(), describeImage: vi.fn(), transcribeAudio: vi.fn() });
    findActiveMemory.mockResolvedValue({
      id: "memory-1",
      userId: "user-1",
      galaxyId: "galaxy-1",
      planetId: "planet-1",
      sourceText: fixture.sourceText,
      occurredAtLabel: null,
      visibility: "private",
      status: "draft",
      version: 4,
    });
    findReadableMemoryAssetsForAiJob.mockResolvedValue(fixture.assets);

    await expect(processMemoryAiJob(imageJob))
      .rejects.toMatchObject({ code: "AI_CONSENT_STALE", status: 409 });

    expect(getAiProvider).not.toHaveBeenCalled();
  });

  it.each(["image", "audio"] as const)(
    "does not call a %s provider when a slow private read loses its lease",
    async (sourceKind) => {
      const fixture = genericFixtureFor(sourceKind);
      const extractMemory = vi.fn();
      const describeImage = vi.fn();
      const transcribeAudio = vi.fn();
      getAiProvider.mockReturnValue({ extractMemory, describeImage, transcribeAudio });
      findActiveMemory.mockResolvedValue({
        id: "memory-1",
        userId: "user-1",
        galaxyId: "galaxy-1",
        planetId: "planet-1",
        sourceText: fixture.sourceText,
        occurredAtLabel: null,
        visibility: "private",
        status: "draft",
        version: 4,
      });
      findReadableMemoryAssetsForAiJob.mockResolvedValue(fixture.assets);
      findActiveMemoryAiJobsForMemory.mockResolvedValue([{
        id: fixture.job.id,
        status: "processing",
        leaseToken: fixture.job.leaseToken,
        leaseExpiresAt: fixture.job.leaseExpiresAt,
      }]);
      handoffActiveDraftMemoryToAiProcessing.mockResolvedValue(true);

      let releasePrivateRead: ((bytes: Uint8Array) => void) | undefined;
      readPrivateAssetBytes.mockImplementation(() => new Promise<Uint8Array>((resolve) => {
        releasePrivateRead = resolve;
      }));
      renewMemoryAiJobLease.mockResolvedValueOnce(null);

      const processing = processMemoryAiJob(fixture.job);
      const outcome = processing.then(
        () => ({ kind: "resolved" as const }),
        (error: unknown) => ({ kind: "rejected" as const, error }),
      );

      await vi.waitFor(() => expect(readPrivateAssetBytes).toHaveBeenCalledTimes(1));
      if (!releasePrivateRead) throw new Error("expected the private read to be pending");
      releasePrivateRead(new Uint8Array([1, 2, 3]));

      await expect(outcome).resolves.toMatchObject({
        kind: "rejected",
        error: { code: "AI_JOB_LEASE_LOST", status: 409 },
      });
      expect(renewMemoryAiJobLease).toHaveBeenCalledWith({
        job: fixture.job,
        leaseDurationMs: 30_000,
      });
      expect(describeImage).not.toHaveBeenCalled();
      expect(transcribeAudio).not.toHaveBeenCalled();
      expect(extractMemory).not.toHaveBeenCalled();
    },
  );

  it("does not read an image derivative or call a provider when its asset snapshot is stale", async () => {
    const fixture = genericFixtureFor("image");
    getAiProvider.mockReturnValue({ extractMemory: vi.fn(), describeImage: vi.fn(), transcribeAudio: vi.fn() });
    findActiveMemory.mockResolvedValue({
      id: "memory-1",
      userId: "user-1",
      galaxyId: "galaxy-1",
      planetId: "planet-1",
      sourceText: fixture.sourceText,
      occurredAtLabel: null,
      visibility: "private",
      status: "draft",
      version: 4,
    });
    findReadableMemoryAssetsForAiJob.mockResolvedValue([{
      ...fixture.assets[0],
      sha256: "changed-after-consent",
    }]);

    await expect(processMemoryAiJob(fixture.job))
      .rejects.toMatchObject({ code: "AI_CONSENT_STALE", status: 409 });

    expect(readPrivateAssetBytes).not.toHaveBeenCalled();
    expect(getAiProvider).not.toHaveBeenCalled();
  });

  it("does not call a provider when an image lacks its server-generated thumbnail", async () => {
    const fixture = genericFixtureFor("image");
    const assets = [{ ...fixture.assets[0], thumbnailStorageKey: null }];
    const extractMemory = vi.fn();
    const describeImage = vi.fn();
    getAiProvider.mockReturnValue({ extractMemory, describeImage, transcribeAudio: vi.fn() });
    findActiveMemory.mockResolvedValue({
      id: "memory-1",
      userId: "user-1",
      galaxyId: "galaxy-1",
      planetId: "planet-1",
      sourceText: fixture.sourceText,
      occurredAtLabel: null,
      visibility: "private",
      status: "draft",
      version: 4,
    });
    findReadableMemoryAssetsForAiJob.mockResolvedValue(assets);
    findActiveMemoryAiJobsForMemory.mockResolvedValue([{
      id: fixture.job.id,
      status: "processing",
      leaseToken: fixture.job.leaseToken,
      leaseExpiresAt: fixture.job.leaseExpiresAt,
    }]);
    handoffActiveDraftMemoryToAiProcessing.mockResolvedValue(true);

    await expect(processMemoryAiJob(fixture.job))
      .rejects.toMatchObject({ code: "MEMORY_ASSET_DERIVATIVE_REQUIRED", status: 422 });

    expect(readPrivateAssetBytes).not.toHaveBeenCalled();
    expect(describeImage).not.toHaveBeenCalled();
    expect(extractMemory).not.toHaveBeenCalled();
  });

  it("does not call a provider when a document lacks locally extracted text", async () => {
    const fixture = genericFixtureFor("document");
    const assets = [{ ...fixture.assets[0], extractedText: null }];
    const extractMemory = vi.fn();
    getAiProvider.mockReturnValue({ extractMemory, describeImage: vi.fn(), transcribeAudio: vi.fn() });
    findActiveMemory.mockResolvedValue({
      id: "memory-1",
      userId: "user-1",
      galaxyId: "galaxy-1",
      planetId: "planet-1",
      sourceText: fixture.sourceText,
      occurredAtLabel: null,
      visibility: "private",
      status: "draft",
      version: 4,
    });
    findReadableMemoryAssetsForAiJob.mockResolvedValue(assets);
    findActiveMemoryAiJobsForMemory.mockResolvedValue([{
      id: fixture.job.id,
      status: "processing",
      leaseToken: fixture.job.leaseToken,
      leaseExpiresAt: fixture.job.leaseExpiresAt,
    }]);
    handoffActiveDraftMemoryToAiProcessing.mockResolvedValue(true);

    await expect(processMemoryAiJob(fixture.job))
      .rejects.toMatchObject({ code: "DOCUMENT_TEXT_REQUIRED", status: 422 });

    expect(readPrivateAssetBytes).not.toHaveBeenCalled();
    expect(extractMemory).not.toHaveBeenCalled();
  });

  it.each(["deleted", "failed"] as const)(
    "treats a %s image that has no text fallback as terminally stale before source derivation",
    async () => {
      const fixture = genericFixtureFor("image", "");
      const extractMemory = vi.fn();
      const describeImage = vi.fn();
      getAiProvider.mockReturnValue({ extractMemory, describeImage, transcribeAudio: vi.fn() });
      findActiveMemory.mockResolvedValue({
        id: "memory-1",
        userId: "user-1",
        galaxyId: "galaxy-1",
        planetId: "planet-1",
        sourceText: "",
        occurredAtLabel: null,
        visibility: "private",
        status: "draft",
        version: 4,
      });
      // Both a soft-deleted asset and an asset that has become failed are absent
      // from the scoped readable query.
      findReadableMemoryAssetsForAiJob.mockResolvedValue([]);

      await expect(processMemoryAiJob(fixture.job))
        .rejects.toMatchObject({ code: "AI_CONSENT_STALE", status: 409 });

      expect(readPrivateAssetBytes).not.toHaveBeenCalled();
      expect(extractMemory).not.toHaveBeenCalled();
      expect(describeImage).not.toHaveBeenCalled();
    },
  );

  it.each([
    { label: "visibility", memoryPatch: { visibility: "family" as const, version: 5 } },
    { label: "version", memoryPatch: { visibility: "private" as const, version: 5 } },
  ])("treats a $label snapshot change as terminally stale before source validation", async ({ memoryPatch }) => {
    const fixture = genericFixtureFor("image");
    const extractMemory = vi.fn();
    const describeImage = vi.fn();
    getAiProvider.mockReturnValue({ extractMemory, describeImage, transcribeAudio: vi.fn() });
    findActiveMemory.mockResolvedValue({
      id: "memory-1",
      userId: "user-1",
      galaxyId: "galaxy-1",
      planetId: "planet-1",
      sourceText: fixture.sourceText,
      occurredAtLabel: null,
      status: "draft",
      ...memoryPatch,
    });
    findReadableMemoryAssetsForAiJob.mockResolvedValue(fixture.assets);

    await expect(processMemoryAiJob(fixture.job))
      .rejects.toMatchObject({ code: "AI_CONSENT_STALE", status: 409 });

    expect(readPrivateAssetBytes).not.toHaveBeenCalled();
    expect(extractMemory).not.toHaveBeenCalled();
    expect(describeImage).not.toHaveBeenCalled();
  });

  it("treats a synchronized visibility change as stale for the old queued snapshot", async () => {
    const fixture = genericFixtureFor("image");
    const synchronizedAssets = fixture.assets.map((asset) => ({ ...asset, visibility: "family" as const }));
    const extractMemory = vi.fn();
    const describeImage = vi.fn();
    getAiProvider.mockReturnValue({ extractMemory, describeImage, transcribeAudio: vi.fn() });
    findActiveMemory.mockResolvedValue({
      id: "memory-1",
      userId: "user-1",
      galaxyId: "galaxy-1",
      planetId: "planet-1",
      sourceText: fixture.sourceText,
      occurredAtLabel: null,
      visibility: "family",
      status: "draft",
      version: 5,
    });
    findReadableMemoryAssetsForAiJob.mockResolvedValue(synchronizedAssets);

    await expect(processMemoryAiJob(fixture.job))
      .rejects.toMatchObject({ code: "AI_CONSENT_STALE", status: 409 });

    expect(readPrivateAssetBytes).not.toHaveBeenCalled();
    expect(extractMemory).not.toHaveBeenCalled();
    expect(describeImage).not.toHaveBeenCalled();
  });

  it("does not read a private image when its asset is deleted after the Memory starts processing", async () => {
    const fixture = genericFixtureFor("image");
    const extractMemory = vi.fn().mockResolvedValue({
      title: "不应生成",
      summary: "不应生成",
      people: [],
      emotions: [],
      uncertainFields: [],
    });
    const describeImage = vi.fn().mockResolvedValue({ description: "不应描述", uncertainFields: [] });
    getAiProvider.mockReturnValue({ extractMemory, describeImage, transcribeAudio: vi.fn() });
    findActiveMemory.mockResolvedValue({
      id: "memory-1",
      userId: "user-1",
      galaxyId: "galaxy-1",
      planetId: "planet-1",
      sourceText: fixture.sourceText,
      occurredAtLabel: null,
      visibility: "private",
      status: "draft",
      version: 4,
    });
    let currentAssets = fixture.assets;
    findReadableMemoryAssetsForAiJob.mockImplementation(async () => currentAssets);
    findActiveMemoryAiJobsForMemory.mockResolvedValue([{
      id: fixture.job.id,
      status: "processing",
      leaseToken: fixture.job.leaseToken,
      leaseExpiresAt: fixture.job.leaseExpiresAt,
    }]);
    handoffActiveDraftMemoryToAiProcessing.mockImplementation(async () => {
      currentAssets = [];
      return true;
    });
    readPrivateAssetBytes.mockResolvedValue(new Uint8Array([1, 2, 3]));

    await expect(processMemoryAiJob(fixture.job))
      .rejects.toMatchObject({ code: "AI_CONSENT_STALE", status: 409 });

    expect(readPrivateAssetBytes).not.toHaveBeenCalled();
    expect(describeImage).not.toHaveBeenCalled();
    expect(extractMemory).not.toHaveBeenCalled();
  });

  it.each([
    { label: "is soft-deleted", currentAssets: () => [] },
    { label: "changes SHA-256", currentAssets: (fixture: ReturnType<typeof genericFixtureFor>) => [{
      ...fixture.assets[0],
      sha256: "changed-after-read",
    }] },
    { label: "changes visibility", currentAssets: (fixture: ReturnType<typeof genericFixtureFor>) => [{
      ...fixture.assets[0],
      visibility: "family" as const,
    }] },
  ])("does not call an image provider when its asset $label during a slow private read", async ({ currentAssets: changedAssets }) => {
    const fixture = genericFixtureFor("image");
    const extractMemory = vi.fn().mockResolvedValue({
      title: "不应生成",
      summary: "不应生成",
      people: [],
      emotions: [],
      uncertainFields: [],
    });
    const describeImage = vi.fn().mockResolvedValue({ description: "不应描述", uncertainFields: [] });
    getAiProvider.mockReturnValue({ extractMemory, describeImage, transcribeAudio: vi.fn() });
    findActiveMemory.mockResolvedValue({
      id: "memory-1",
      userId: "user-1",
      galaxyId: "galaxy-1",
      planetId: "planet-1",
      sourceText: fixture.sourceText,
      occurredAtLabel: null,
      visibility: "private",
      status: "draft",
      version: 4,
    });
    let currentAssets = fixture.assets;
    findReadableMemoryAssetsForAiJob.mockImplementation(async () => currentAssets);
    findActiveMemoryAiJobsForMemory.mockResolvedValue([{
      id: fixture.job.id,
      status: "processing",
      leaseToken: fixture.job.leaseToken,
      leaseExpiresAt: fixture.job.leaseExpiresAt,
    }]);
    handoffActiveDraftMemoryToAiProcessing.mockResolvedValue(true);
    completeMemoryAiJob.mockResolvedValue(undefined);

    let releasePrivateRead: ((bytes: Uint8Array) => void) | undefined;
    readPrivateAssetBytes.mockImplementation(() => new Promise<Uint8Array>((resolve) => {
      releasePrivateRead = resolve;
    }));

    const processing = processMemoryAiJob(fixture.job);
    const outcome = processing.then(
      () => ({ kind: "resolved" as const }),
      (error: unknown) => ({ kind: "rejected" as const, error }),
    );

    await vi.waitFor(() => expect(readPrivateAssetBytes).toHaveBeenCalledTimes(1));
    currentAssets = changedAssets(fixture);
    if (!releasePrivateRead) throw new Error("expected the private read to be pending");
    releasePrivateRead(new Uint8Array([1, 2, 3]));

    await expect(outcome).resolves.toMatchObject({
      kind: "rejected",
      error: { code: "AI_CONSENT_STALE", status: 409 },
    });
    expect(describeImage).not.toHaveBeenCalled();
    expect(extractMemory).not.toHaveBeenCalled();
  });

  it("does not call the final extractor when an image asset changes after its description", async () => {
    const fixture = genericFixtureFor("image");
    const extractMemory = vi.fn().mockResolvedValue({
      title: "不应生成",
      summary: "不应生成",
      people: [],
      emotions: [],
      uncertainFields: [],
    });
    let currentAssets = fixture.assets;
    const describeImage = vi.fn().mockImplementation(async () => {
      currentAssets = [{ ...fixture.assets[0], sha256: "changed-after-description" }];
      return { description: "一张等待整理的图片。", uncertainFields: [] };
    });
    getAiProvider.mockReturnValue({ extractMemory, describeImage, transcribeAudio: vi.fn() });
    findActiveMemory.mockResolvedValue({
      id: "memory-1",
      userId: "user-1",
      galaxyId: "galaxy-1",
      planetId: "planet-1",
      sourceText: fixture.sourceText,
      occurredAtLabel: null,
      visibility: "private",
      status: "draft",
      version: 4,
    });
    findReadableMemoryAssetsForAiJob.mockImplementation(async () => currentAssets);
    findActiveMemoryAiJobsForMemory.mockResolvedValue([{
      id: fixture.job.id,
      status: "processing",
      leaseToken: fixture.job.leaseToken,
      leaseExpiresAt: fixture.job.leaseExpiresAt,
    }]);
    handoffActiveDraftMemoryToAiProcessing.mockResolvedValue(true);
    readPrivateAssetBytes.mockResolvedValue(new Uint8Array([1, 2, 3]));

    await expect(processMemoryAiJob(fixture.job))
      .rejects.toMatchObject({ code: "AI_CONSENT_STALE", status: 409 });

    expect(describeImage).toHaveBeenCalledTimes(1);
    expect(extractMemory).not.toHaveBeenCalled();
  });

  it("writes a provider draft back as needs_confirmation with the raw uncertainty list", async () => {
    const extractMemory = vi.fn().mockResolvedValue({
      title: "新家的晚上",
      summary: "全家第一次在新家吃晚饭。",
      people: ["妈妈", "我"],
      emotions: ["安心"],
      uncertainFields: ["occurredAtLabel", "people"],
    });
    getAiProvider.mockReturnValue({ extractMemory });
    findActiveMemory.mockResolvedValue({
      id: "memory-1",
      userId: "user-1",
      galaxyId: "galaxy-1",
      sourceText: "第一次搬进新家的晚上。",
      occurredAtLabel: "2018 年夏天",
      status: "draft",
      version: 4,
    });
    handoffActiveDraftMemoryToAiProcessing.mockResolvedValue(true);
    completeTextExtractionAiJob.mockResolvedValue(undefined);

    await processTextExtractionAiJob(job);

    expect(findActiveMemory).toHaveBeenCalledWith({
      userId: "user-1",
      galaxyId: "galaxy-1",
      memoryId: "memory-1",
    });
    expect(extractMemory).toHaveBeenCalledWith({
      sourceText: "第一次搬进新家的晚上。",
      assetIds: [],
      occurredAtLabel: "2018 年夏天",
    });
    expect(completeTextExtractionAiJob).toHaveBeenCalledWith({
      job,
      memoryVersion: 4,
      draft: {
        title: "新家的晚上",
        summary: "全家第一次在新家吃晚饭。",
        people: ["妈妈", "我"],
        emotions: ["安心"],
        uncertainFields: ["occurredAtLabel", "people"],
      },
    });
  });

  it("does not call the provider when a concurrent PATCH wins after the worker reads its old snapshot", async () => {
    const extractMemory = vi.fn();
    getAiProvider.mockReturnValue({ extractMemory });
    findActiveMemory.mockResolvedValue({
      id: "memory-1",
      userId: "user-1",
      galaxyId: "galaxy-1",
      sourceText: "第一次搬进新家的晚上。",
      occurredAtLabel: "2018 年夏天",
      status: "draft",
      version: 4,
    });
    // Simulate PATCH winning after findActiveMemory returned the old snapshot.
    handoffActiveDraftMemoryToAiProcessing.mockResolvedValue(false);

    await expect(processTextExtractionAiJob(job))
      .rejects.toMatchObject({ code: "AI_CONSENT_STALE", status: 409 });

    expect(handoffActiveDraftMemoryToAiProcessing).toHaveBeenCalledWith({
      userId: "user-1",
      galaxyId: "galaxy-1",
      memoryId: "memory-1",
      version: 4,
    });
    expect(getAiProvider).not.toHaveBeenCalled();
    expect(extractMemory).not.toHaveBeenCalled();
    expect(completeTextExtractionAiJob).not.toHaveBeenCalled();
  });

  it("does not hand off or call the provider after this worker's lease has expired", async () => {
    const extractMemory = vi.fn().mockResolvedValue({
      title: "不应生成",
      summary: "不应生成",
      people: [],
      emotions: [],
      uncertainFields: [],
    });
    getAiProvider.mockReturnValue({ extractMemory });
    findActiveMemory.mockResolvedValue({
      id: "memory-1",
      userId: "user-1",
      galaxyId: "galaxy-1",
      sourceText: "第一次搬进新家的晚上。",
      occurredAtLabel: "2018 年夏天",
      status: "draft",
      version: 4,
    });
    findActiveTextExtractionAiJobsForMemory.mockResolvedValue([{
      id: job.id,
      status: "processing",
      leaseToken: job.leaseToken,
      leaseExpiresAt: new Date("2000-01-01T00:00:00.000Z"),
    }]);
    handoffActiveDraftMemoryToAiProcessing.mockResolvedValue(true);
    completeTextExtractionAiJob.mockResolvedValue(undefined);

    await expect(processTextExtractionAiJob(job))
      .rejects.toMatchObject({ code: "AI_JOB_LEASE_LOST", status: 409 });

    expect(handoffActiveDraftMemoryToAiProcessing).not.toHaveBeenCalled();
    expect(getAiProvider).not.toHaveBeenCalled();
    expect(extractMemory).not.toHaveBeenCalled();
  });

  it("continues a reclaimed processing snapshot only for the same active text job", async () => {
    const extractMemory = vi.fn().mockResolvedValue({
      title: "新家的晚上",
      summary: "全家第一次在新家吃晚饭。",
      people: ["妈妈", "我"],
      emotions: ["安心"],
      uncertainFields: [],
    });
    getAiProvider.mockReturnValue({ extractMemory });
    findActiveMemory.mockResolvedValue({
      id: "memory-1",
      userId: "user-1",
      galaxyId: "galaxy-1",
      sourceText: "第一次搬进新家的晚上。",
      occurredAtLabel: "2018 年夏天",
      status: "processing",
      version: 4,
    });
    completeTextExtractionAiJob.mockResolvedValue(undefined);

    await expect(processTextExtractionAiJob(job)).resolves.toBeUndefined();

    expect(handoffActiveDraftMemoryToAiProcessing).not.toHaveBeenCalled();
    expect(extractMemory).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a processing snapshot belongs to a different active job", async () => {
    const extractMemory = vi.fn();
    getAiProvider.mockReturnValue({ extractMemory });
    findActiveMemory.mockResolvedValue({
      id: "memory-1",
      userId: "user-1",
      galaxyId: "galaxy-1",
      sourceText: "第一次搬进新家的晚上。",
      occurredAtLabel: "2018 年夏天",
      status: "processing",
      version: 4,
    });
    findActiveTextExtractionAiJobsForMemory.mockResolvedValue([{
      id: "different-job",
      status: "processing",
      leaseToken: "different-lease-token",
      leaseExpiresAt: job.leaseExpiresAt,
    }]);

    await expect(processTextExtractionAiJob(job))
      .rejects.toMatchObject({ code: "AI_CONSENT_STALE", status: 409 });

    expect(getAiProvider).not.toHaveBeenCalled();
    expect(extractMemory).not.toHaveBeenCalled();
  });

  it("does not call the provider when a near-expiry lease cannot be renewed for the provider budget", async () => {
    const extractMemory = vi.fn().mockResolvedValue({
      title: "不应生成",
      summary: "不应生成",
      people: [],
      emotions: [],
      uncertainFields: [],
    });
    getAiProvider.mockReturnValue({ extractMemory });
    findActiveMemory.mockResolvedValue({
      id: "memory-1",
      userId: "user-1",
      galaxyId: "galaxy-1",
      sourceText: "第一次搬进新家的晚上。",
      occurredAtLabel: "2018 年夏天",
      status: "draft",
      version: 4,
    });
    findActiveTextExtractionAiJobsForMemory.mockResolvedValue([{
      id: job.id,
      status: "processing",
      leaseToken: job.leaseToken,
      leaseExpiresAt: new Date(Date.now() + 10_000),
    }]);
    handoffActiveDraftMemoryToAiProcessing.mockResolvedValue(true);
    renewTextExtractionAiJobLease.mockResolvedValue(null);
    completeTextExtractionAiJob.mockResolvedValue(undefined);

    await expect(processTextExtractionAiJob(job))
      .rejects.toMatchObject({ code: "AI_JOB_LEASE_LOST", status: 409 });

    expect(renewTextExtractionAiJobLease).toHaveBeenCalledWith({
      job,
      leaseDurationMs: 30_000,
    });
    expect(getAiProvider).not.toHaveBeenCalled();
    expect(extractMemory).not.toHaveBeenCalled();
  });

  it("does not call the provider when the atomic renewal loses ownership to a reclaimer", async () => {
    const extractMemory = vi.fn().mockResolvedValue({
      title: "不应生成",
      summary: "不应生成",
      people: [],
      emotions: [],
      uncertainFields: [],
    });
    getAiProvider.mockReturnValue({ extractMemory });
    findActiveMemory.mockResolvedValue({
      id: "memory-1",
      userId: "user-1",
      galaxyId: "galaxy-1",
      sourceText: "第一次搬进新家的晚上。",
      occurredAtLabel: "2018 年夏天",
      status: "processing",
      version: 4,
    });
    renewTextExtractionAiJobLease.mockResolvedValue(null);
    completeTextExtractionAiJob.mockResolvedValue(undefined);

    await expect(processTextExtractionAiJob(job))
      .rejects.toMatchObject({ code: "AI_JOB_LEASE_LOST", status: 409 });

    expect(renewTextExtractionAiJobLease).toHaveBeenCalledWith({
      job,
      leaseDurationMs: 30_000,
    });
    expect(getAiProvider).not.toHaveBeenCalled();
    expect(extractMemory).not.toHaveBeenCalled();
  });

  it("does not touch memory or provider state when a queued job lacks captured consent", async () => {
    await expect(processTextExtractionAiJob({ ...job, consentCapturedAt: null }))
      .rejects.toMatchObject({ code: "AI_CONSENT_REQUIRED", status: 400 });

    expect(findActiveMemory).not.toHaveBeenCalled();
    expect(getAiProvider).not.toHaveBeenCalled();
    expect(completeTextExtractionAiJob).not.toHaveBeenCalled();
  });

  it("fails closed without calling the provider when consent snapshot text or version is stale", async () => {
    const extractMemory = vi.fn().mockResolvedValue({
      title: "不应生成",
      summary: "不应生成",
      people: [],
      emotions: [],
      uncertainFields: [],
    });
    getAiProvider.mockReturnValue({ extractMemory });
    findActiveMemory.mockResolvedValue({
      id: "memory-1",
      userId: "user-1",
      galaxyId: "galaxy-1",
      sourceText: "第一次搬进新家的那个晚上。",
      occurredAtLabel: "2018 年夏天",
      status: "draft",
      version: 5,
    });

    await expect(processTextExtractionAiJob(job))
      .rejects.toMatchObject({ code: "AI_CONSENT_STALE", status: 409 });

    expect(getAiProvider).not.toHaveBeenCalled();
    expect(extractMemory).not.toHaveBeenCalled();
    expect(completeTextExtractionAiJob).not.toHaveBeenCalled();
  });
});
