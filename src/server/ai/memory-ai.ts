import {
  AI_JOB_LEASE_DURATION_MS,
  completeMemoryAiJob,
  completeTextExtractionAiJob,
  findActiveMemoryAiJobsForMemory,
  findActiveTextExtractionAiJobsForMemory,
  renewMemoryAiJobLease,
  renewTextExtractionAiJobLease,
} from "@/server/db/ai-job-repo";
import {
  findReadableMemoryAssetsForAiJob,
  type ReadableMemoryAiAsset,
} from "@/server/db/asset-repo";
import {
  findActiveMemory,
  handoffActiveDraftMemoryToAiProcessing,
} from "@/server/db/memory-repo";
import { DomainError } from "@/server/domain-error";
import { MAX_IMAGE_SIZE_BYTES } from "@/server/media/asset-validation";
import { readPrivateAssetBytes } from "@/server/media/media-store";

import {
  deriveMemoryAiSource,
  MEMORY_EXTRACTION_PURPOSE,
  memoryAiSnapshotHash,
  type MemoryAiPipelineKind,
} from "./memory-ai-contract";
import { getAiProvider } from "./openai-client";
import { TEXT_EXTRACTION_PURPOSE, textExtractionRequestHash } from "./text-extraction-request";

export type TextExtractionJob = {
  id: string;
  userId: string;
  galaxyId: string;
  memoryId: string | null;
  leaseToken: string;
  leaseExpiresAt: Date;
  attempts: number;
  kind: "text_extraction";
  consentCapturedAt: Date | null;
  requestHash: string;
};

export async function processTextExtractionAiJob(job: TextExtractionJob): Promise<void> {
  if (!job.consentCapturedAt) {
    throw new DomainError("AI_CONSENT_REQUIRED", 400, "AI 作业缺少处理授权。");
  }

  if (!job.memoryId) {
    throw new DomainError("AI_JOB_MEMORY_REQUIRED", 409, "AI 作业缺少可处理的记忆。");
  }

  const memory = await findActiveMemory({
    userId: job.userId,
    galaxyId: job.galaxyId,
    memoryId: job.memoryId,
  });

  if (!memory) {
    throw new DomainError("MEMORY_NOT_FOUND", 404, "记忆不存在或无权访问。");
  }

  await assertCurrentTextExtractionLease(job);

  if (memory.status !== "draft" && memory.status !== "processing") {
    throw new DomainError("AI_CONSENT_STALE", 409, "记忆内容已变化，请重新确认后发起 AI 整理。");
  }

  const currentRequestHash = textExtractionRequestHash({
    memoryId: job.memoryId,
    sourceText: memory.sourceText,
    version: memory.version,
    purpose: TEXT_EXTRACTION_PURPOSE,
  });

  if (currentRequestHash !== job.requestHash) {
    throw new DomainError("AI_CONSENT_STALE", 409, "记忆内容已变化，请重新确认后发起 AI 整理。");
  }

  if (memory.status === "draft") {
    const handedOff = await handoffActiveDraftMemoryToAiProcessing({
      userId: job.userId,
      galaxyId: job.galaxyId,
      memoryId: job.memoryId,
      version: memory.version,
    });

    if (!handedOff) {
      throw new DomainError("AI_CONSENT_STALE", 409, "记忆内容已变化，请重新确认后发起 AI 整理。");
    }
  }

  // This short conditional write creates a fresh 30-second window for the
  // 25-second provider timeout plus completion margin. It never holds a
  // transaction or row lock across the remote request.
  const renewedLeaseExpiresAt = await renewTextExtractionAiJobLease({
    job,
    leaseDurationMs: AI_JOB_LEASE_DURATION_MS,
  });

  if (!renewedLeaseExpiresAt) {
    throw new DomainError("AI_JOB_LEASE_LOST", 409, "AI 作业租约已失效。");
  }

  const draft = await getAiProvider().extractMemory({
    sourceText: memory.sourceText,
    assetIds: [],
    occurredAtLabel: memory.occurredAtLabel ?? undefined,
  });

  await completeTextExtractionAiJob({
    job,
    memoryVersion: memory.version,
    draft,
  });
}

export type MemoryAiJob = {
  id: string;
  userId: string;
  galaxyId: string;
  memoryId: string | null;
  leaseToken: string;
  leaseExpiresAt: Date;
  attempts: number;
  kind: MemoryAiPipelineKind;
  consentCapturedAt: Date | null;
  requestHash: string;
};

const MAX_MEMORY_AI_SOURCE_CHARACTERS = 40_000;
const MAX_SINGLE_EVIDENCE_CHARACTERS = 20_000;

/**
 * Runs the persisted source pipeline selected at consent capture. Every path
 * ends in a single guarded memory extraction and then Task7's transactional
 * `processing -> needs_confirmation` completion; no source can auto-confirm.
 */
export async function processMemoryAiJob(job: MemoryAiJob): Promise<void> {
  if (!job.consentCapturedAt) {
    throw new DomainError("AI_CONSENT_REQUIRED", 400, "AI 作业缺少处理授权。");
  }

  if (!job.memoryId) {
    throw new DomainError("AI_JOB_MEMORY_REQUIRED", 409, "AI 作业缺少可处理的记忆。");
  }

  const memory = await findActiveMemory({
    userId: job.userId,
    galaxyId: job.galaxyId,
    memoryId: job.memoryId,
  });

  if (!memory) {
    throw new DomainError("MEMORY_NOT_FOUND", 404, "记忆不存在或无权访问。");
  }

  const snapshot = await readCurrentMemoryAiSnapshot({ job, memory });
  const { source } = snapshot;

  await assertCurrentMemoryAiLease(job);

  if (memory.status !== "draft" && memory.status !== "processing") {
    throw staleConsent();
  }

  if (memory.status === "draft") {
    const handedOff = await handoffActiveDraftMemoryToAiProcessing({
      userId: job.userId,
      galaxyId: job.galaxyId,
      memoryId: job.memoryId,
      version: memory.version,
    });

    if (!handedOff) {
      throw staleConsent();
    }
  }

  const revalidateSourceAssets = async () => {
    await readCurrentMemoryAiSnapshot({ job, memory });
  };
  const processingSnapshot = await readCurrentMemoryAiSnapshot({ job, memory });
  const processingAssets = processingSnapshot.assets;
  const provider = getAiProvider();
  const evidence = await collectSourceEvidence({
    job,
    sourceKind: source.sourceKind,
    assets: processingAssets,
    provider,
    revalidateSourceAssets,
  });
  const sourceText = composeMemoryExtractionSource(memory.sourceText, evidence.parts);

  if (!sourceText) {
    throw new DomainError("MEMORY_SOURCE_REQUIRED", 422, "请提供文字或已存储的素材。");
  }

  await revalidateSourceAssets();
  await renewMemoryAiProviderLease(job);
  const extractedDraft = await provider.extractMemory({
    sourceText,
    assetIds: processingAssets.map((asset) => asset.id),
    occurredAtLabel: memory.occurredAtLabel ?? undefined,
  });
  const draft = {
    ...extractedDraft,
    uncertainFields: uniqueStrings([
      ...extractedDraft.uncertainFields,
      ...evidence.uncertainFields,
    ]),
  };

  await completeMemoryAiJob({
    job,
    memoryVersion: memory.version,
    draft,
  });
}

async function collectSourceEvidence(input: {
  job: MemoryAiJob;
  sourceKind: "text" | "image" | "audio" | "document";
  assets: ReadableMemoryAiAsset[];
  provider: ReturnType<typeof getAiProvider>;
  revalidateSourceAssets: () => Promise<void>;
}): Promise<{ parts: string[]; uncertainFields: string[] }> {
  switch (input.sourceKind) {
    case "text":
      return { parts: [], uncertainFields: [] };
    case "image":
      return collectImageEvidence(input);
    case "audio":
      return collectAudioEvidence(input);
    case "document":
      return collectDocumentEvidence(input.assets);
  }
}

async function collectImageEvidence(input: {
  job: MemoryAiJob;
  assets: ReadableMemoryAiAsset[];
  provider: ReturnType<typeof getAiProvider>;
  revalidateSourceAssets: () => Promise<void>;
}) {
  const parts: string[] = [];
  const uncertainFields: string[] = [];

  for (const asset of input.assets) {
    const thumbnailStorageKey = asset.thumbnailStorageKey;

    if (!thumbnailStorageKey) {
      throw new DomainError("MEMORY_ASSET_DERIVATIVE_REQUIRED", 422, "图片缺少可供 AI 使用的安全派生副本。");
    }

    const bytes = await readPrivateAssetBytes(thumbnailStorageKey, MAX_IMAGE_SIZE_BYTES);
    const imageUrl = `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`;
    await input.revalidateSourceAssets();
    await renewMemoryAiProviderLease(input.job);
    const description = await input.provider.describeImage({
      // Thumbnails are server-generated JPEGs with metadata stripped at upload.
      imageUrl,
    });

    parts.push(`图片素材：${clipEvidence(description.description)}`);
    uncertainFields.push(...description.uncertainFields);
  }

  return { parts, uncertainFields };
}

async function collectAudioEvidence(input: {
  job: MemoryAiJob;
  assets: ReadableMemoryAiAsset[];
  provider: ReturnType<typeof getAiProvider>;
  revalidateSourceAssets: () => Promise<void>;
}) {
  const parts: string[] = [];

  for (const asset of input.assets) {
    // The explicit consent and active lease were checked before this worker
    // reads original audio bytes; no browser-provided path reaches this call.
    const bytes = await readPrivateAssetBytes(asset.storageKey, asset.sizeBytes);
    const audioBytes = new Uint8Array(bytes.byteLength);
    audioBytes.set(bytes);
    const audio = new Blob([audioBytes.buffer], { type: asset.mimeType });
    await input.revalidateSourceAssets();
    await renewMemoryAiProviderLease(input.job);
    const transcript = await input.provider.transcribeAudio({
      audio,
      fileName: asset.originalName,
    });

    parts.push(`音频转写：${clipEvidence(transcript.text)}`);
  }

  return { parts, uncertainFields: [] };
}

function collectDocumentEvidence(assets: ReadableMemoryAiAsset[]) {
  const parts: string[] = [];

  for (const asset of assets) {
    if (!asset.extractedText?.trim()) {
      throw new DomainError("DOCUMENT_TEXT_REQUIRED", 422, "文档没有可用于整理的文字内容。");
    }

    parts.push(`日记文件：${clipEvidence(asset.extractedText)}`);
  }

  return { parts, uncertainFields: [] };
}

function composeMemoryExtractionSource(sourceText: string, evidence: string[]) {
  const parts = sourceText.trim() ? [`用户补充：${sourceText.trim()}`] : [];

  for (const part of evidence) {
    const remaining = MAX_MEMORY_AI_SOURCE_CHARACTERS - parts.join("\n\n").length;

    if (remaining <= 0) {
      break;
    }

    parts.push(part.slice(0, remaining));
  }

  return parts.join("\n\n").slice(0, MAX_MEMORY_AI_SOURCE_CHARACTERS);
}

function clipEvidence(value: string) {
  return value.trim().slice(0, MAX_SINGLE_EVIDENCE_CHARACTERS);
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

async function readCurrentMemoryAiSnapshot(input: {
  job: MemoryAiJob;
  memory: {
    planetId: string;
    sourceText: string;
    version: number;
    visibility: "private" | "family" | "selected";
  };
}): Promise<{
  assets: ReadableMemoryAiAsset[];
  source: ReturnType<typeof deriveMemoryAiSource>;
}> {
  if (!input.job.memoryId) {
    throw new DomainError("AI_JOB_MEMORY_REQUIRED", 409, "AI 作业缺少可处理的记忆。");
  }

  const assets = await findReadableMemoryAssetsForAiJob({
    userId: input.job.userId,
    galaxyId: input.job.galaxyId,
    planetId: input.memory.planetId,
    memoryId: input.job.memoryId,
  });
  const currentRequestHash = memoryAiSnapshotHash({
    memoryId: input.job.memoryId,
    sourceText: input.memory.sourceText,
    version: input.memory.version,
    purpose: MEMORY_EXTRACTION_PURPOSE,
    assets,
  });

  if (!matchesCurrentMemoryAiRequestHash({
    job: input.job,
    memoryId: input.job.memoryId,
    sourceText: input.memory.sourceText,
    version: input.memory.version,
    currentRequestHash,
  })) {
    throw staleConsent();
  }

  try {
    const source = deriveMemoryAiSource({
      sourceText: input.memory.sourceText,
      visibility: input.memory.visibility,
      assets,
    });

    if (source.jobKind !== input.job.kind) {
      throw staleConsent();
    }

    return { assets, source };
  } catch (error) {
    if (error instanceof DomainError) {
      throw staleConsent();
    }

    throw error;
  }
}

function matchesCurrentMemoryAiRequestHash(input: {
  job: MemoryAiJob;
  memoryId: string;
  sourceText: string;
  version: number;
  currentRequestHash: string;
}) {
  if (input.currentRequestHash === input.job.requestHash) {
    return true;
  }

  // Task7 text jobs persisted this narrower hash before Task8 added the
  // server-owned text metadata asset to generic source snapshots. It is never
  // accepted for non-text job kinds and still binds the current Memory text
  // and version before any provider work can occur.
  return input.job.kind === "text_extraction"
    && input.job.requestHash === textExtractionRequestHash({
      memoryId: input.memoryId,
      sourceText: input.sourceText,
      version: input.version,
      purpose: TEXT_EXTRACTION_PURPOSE,
    });
}

async function renewMemoryAiProviderLease(job: MemoryAiJob): Promise<void> {
  const renewedLeaseExpiresAt = await renewMemoryAiJobLease({
    job,
    leaseDurationMs: AI_JOB_LEASE_DURATION_MS,
  });

  if (!renewedLeaseExpiresAt) {
    throw new DomainError("AI_JOB_LEASE_LOST", 409, "AI 作业租约已失效。");
  }
}

async function assertCurrentMemoryAiLease(job: MemoryAiJob): Promise<void> {
  if (!job.memoryId) {
    throw new DomainError("AI_JOB_MEMORY_REQUIRED", 409, "AI 作业缺少可处理的记忆。");
  }

  const activeJobs = await findActiveMemoryAiJobsForMemory({
    userId: job.userId,
    galaxyId: job.galaxyId,
    memoryId: job.memoryId,
  });
  const activeJob = activeJobs[0];

  if (activeJobs.length !== 1 || activeJob?.id !== job.id) {
    throw staleConsent();
  }

  if (
    activeJob.status !== "processing"
    || activeJob.leaseToken !== job.leaseToken
    || !activeJob.leaseExpiresAt
    || activeJob.leaseExpiresAt <= new Date()
  ) {
    throw new DomainError("AI_JOB_LEASE_LOST", 409, "AI 作业租约已失效。");
  }
}

function staleConsent() {
  return new DomainError("AI_CONSENT_STALE", 409, "记忆内容已变化，请重新确认后发起 AI 整理。");
}

async function assertCurrentTextExtractionLease(job: TextExtractionJob): Promise<void> {
  if (!job.memoryId) {
    throw new DomainError("AI_JOB_MEMORY_REQUIRED", 409, "AI 作业缺少可处理的记忆。");
  }

  const activeJobs = await findActiveTextExtractionAiJobsForMemory({
    userId: job.userId,
    galaxyId: job.galaxyId,
    memoryId: job.memoryId,
  });
  const activeJob = activeJobs[0];

  if (activeJobs.length !== 1 || activeJob?.id !== job.id) {
    throw new DomainError("AI_CONSENT_STALE", 409, "记忆内容已变化，请重新确认后发起 AI 整理。");
  }

  if (
    activeJob.status !== "processing"
    || activeJob.leaseToken !== job.leaseToken
    || !activeJob.leaseExpiresAt
    || activeJob.leaseExpiresAt <= new Date()
  ) {
    throw new DomainError("AI_JOB_LEASE_LOST", 409, "AI 作业租约已失效。");
  }
}
