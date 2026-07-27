-- CreateEnum
CREATE TYPE "ContentVisibility" AS ENUM ('private', 'family', 'selected');

-- CreateEnum
CREATE TYPE "PlanetLifeState" AS ENUM ('active', 'memorial');

-- CreateEnum
CREATE TYPE "PlanetRelationshipKind" AS ENUM ('self', 'parent', 'child', 'partner', 'ancestor', 'other');

-- CreateEnum
CREATE TYPE "MemoryStatus" AS ENUM ('draft', 'processing', 'needs_confirmation', 'confirmed', 'archived');

-- CreateEnum
CREATE TYPE "MemoryAssetKind" AS ENUM ('text', 'image', 'audio', 'document', 'planet_cover');

-- CreateEnum
CREATE TYPE "AssetProcessingStatus" AS ENUM ('stored', 'processing', 'ready', 'failed');

-- CreateEnum
CREATE TYPE "AiJobKind" AS ENUM ('text_extraction', 'image_extraction', 'audio_transcription', 'document_extraction', 'embedding', 'resonance_scan', 'book_generation');

-- CreateEnum
CREATE TYPE "AiJobStatus" AS ENUM ('queued', 'processing', 'succeeded', 'failed');

-- CreateEnum
CREATE TYPE "ResonanceStatus" AS ENUM ('candidate', 'confirmed', 'rejected');

-- CreateEnum
CREATE TYPE "BookStatus" AS ENUM ('draft', 'ready', 'published', 'archived');

-- AlterEnum: rebuilding avoids using a newly added enum value inside the same transaction.
CREATE TYPE "PlanetType_new" AS ENUM ('self', 'parent', 'child', 'memorial', 'public', 'partner', 'other');
ALTER TABLE "Planet" ALTER COLUMN "type" TYPE "PlanetType_new" USING ("type"::text::"PlanetType_new");
DROP TYPE "PlanetType";
ALTER TYPE "PlanetType_new" RENAME TO "PlanetType";

-- DropForeignKey
ALTER TABLE "Galaxy" DROP CONSTRAINT "Galaxy_userId_fkey";

-- DropForeignKey
ALTER TABLE "Planet" DROP CONSTRAINT "Planet_galaxyId_fkey";

-- DropForeignKey
ALTER TABLE "Planet" DROP CONSTRAINT "Planet_userId_fkey";

-- DropForeignKey
ALTER TABLE "SharedBook" DROP CONSTRAINT "SharedBook_userId_fkey";

-- Normalize legacy Planet ownership before replacing independent foreign keys with a composite scope key.
UPDATE "Planet" AS "planet"
SET "userId" = "galaxy"."userId"
FROM "Galaxy" AS "galaxy"
WHERE "planet"."galaxyId" = "galaxy"."id"
  AND "planet"."userId" <> "galaxy"."userId";

-- AlterTable: retain legacy memorial state before normalizing it out of the relationship-type column.
ALTER TABLE "Planet" ADD COLUMN "lifeState" "PlanetLifeState" NOT NULL DEFAULT 'active';
UPDATE "Planet" SET "lifeState" = 'memorial' WHERE "type" = 'memorial';
UPDATE "Planet" SET "type" = 'other' WHERE "type" = 'memorial';
ALTER TABLE "Planet" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Planet" ADD COLUMN "archivedAt" TIMESTAMP(3),
ADD COLUMN "coverAssetId" TEXT,
ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "purgeAfter" TIMESTAMP(3);
ALTER TABLE "Planet" ADD CONSTRAINT "Planet_type_not_memorial_check" CHECK ("type" <> 'memorial');

-- AlterTable: old token snapshots are scoped where possible and explicitly marked when no owner galaxy exists.
ALTER TABLE "SharedBook" ADD COLUMN "bookId" TEXT,
ADD COLUMN "galaxyId" TEXT,
ADD COLUMN "legacySnapshot" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "revokedAt" TIMESTAMP(3);
UPDATE "SharedBook" AS "sharedBook"
SET "galaxyId" = "galaxy"."id"
FROM "Galaxy" AS "galaxy"
WHERE "galaxy"."userId" = "sharedBook"."userId";
UPDATE "SharedBook" SET "legacySnapshot" = true WHERE "galaxyId" IS NULL;
ALTER TABLE "SharedBook" ADD CONSTRAINT "SharedBook_galaxyId_or_legacySnapshot_check" CHECK ("galaxyId" IS NOT NULL OR "legacySnapshot");
ALTER TABLE "SharedBook" ADD CONSTRAINT "SharedBook_bookId_requires_galaxyId_check" CHECK ("bookId" IS NULL OR "galaxyId" IS NOT NULL);

-- CreateTable
CREATE TABLE "Memory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "galaxyId" TEXT NOT NULL,
    "planetId" TEXT NOT NULL,
    "sourceText" TEXT NOT NULL,
    "title" TEXT,
    "summary" TEXT,
    "tags" JSONB,
    "uncertainFields" JSONB,
    "occurredAtLabel" TEXT,
    "occurredAt" TIMESTAMP(3),
    "visibility" "ContentVisibility" NOT NULL DEFAULT 'private',
    "allowResonance" BOOLEAN NOT NULL DEFAULT false,
    "allowBook" BOOLEAN NOT NULL DEFAULT false,
    "status" "MemoryStatus" NOT NULL DEFAULT 'draft',
    "confirmedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "embedding" JSONB,
    "embeddingModel" TEXT,
    "deletedAt" TIMESTAMP(3),
    "purgeAfter" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Memory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryAsset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "galaxyId" TEXT NOT NULL,
    "planetId" TEXT NOT NULL,
    "memoryId" TEXT,
    "kind" "MemoryAssetKind" NOT NULL,
    "visibility" "ContentVisibility" NOT NULL DEFAULT 'private',
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "durationMs" INTEGER,
    "extractedText" TEXT,
    "transcript" TEXT,
    "thumbnailStorageKey" TEXT,
    "normalizedStorageKey" TEXT,
    "status" "AssetProcessingStatus" NOT NULL DEFAULT 'stored',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "purgeAfter" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemoryAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "galaxyId" TEXT NOT NULL,
    "planetId" TEXT,
    "memoryId" TEXT,
    "assetId" TEXT,
    "resonanceCandidateId" TEXT,
    "bookId" TEXT,
    "kind" "AiJobKind" NOT NULL,
    "status" "AiJobStatus" NOT NULL DEFAULT 'queued',
    "consentCapturedAt" TIMESTAMP(3) NOT NULL,
    "requestHash" TEXT NOT NULL,
    "model" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanetRelationship" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "galaxyId" TEXT NOT NULL,
    "sourcePlanetId" TEXT NOT NULL,
    "targetPlanetId" TEXT NOT NULL,
    "relationshipType" "PlanetRelationshipKind" NOT NULL,
    "label" TEXT,
    "visibility" "ContentVisibility" NOT NULL DEFAULT 'private',
    "confirmedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "purgeAfter" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanetRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResonanceCandidate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "galaxyId" TEXT NOT NULL,
    "sourceMemoryId" TEXT NOT NULL,
    "targetMemoryId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ResonanceStatus" NOT NULL DEFAULT 'candidate',
    "confirmedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "purgeAfter" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResonanceCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Book" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "galaxyId" TEXT NOT NULL,
    "title" TEXT,
    "sourceRange" TEXT,
    "themeTemplateKey" TEXT,
    "draft" JSONB,
    "body" TEXT,
    "sections" JSONB,
    "visibility" "ContentVisibility" NOT NULL DEFAULT 'private',
    "status" "BookStatus" NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "purgeAfter" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Book_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookMemory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "galaxyId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "memoryId" TEXT NOT NULL,
    "chapterKey" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "purgeAfter" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "galaxyId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "resourceType" TEXT,
    "resourceId" TEXT,
    "result" JSONB,
    "response" JSONB,
    "responseStatus" INTEGER,
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Memory_userId_galaxyId_deletedAt_idx" ON "Memory"("userId", "galaxyId", "deletedAt");

-- CreateIndex
CREATE INDEX "Memory_planetId_status_deletedAt_idx" ON "Memory"("planetId", "status", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Memory_id_userId_galaxyId_key" ON "Memory"("id", "userId", "galaxyId");

-- CreateIndex
CREATE UNIQUE INDEX "MemoryAsset_storageKey_key" ON "MemoryAsset"("storageKey");

-- CreateIndex
CREATE INDEX "MemoryAsset_userId_galaxyId_deletedAt_idx" ON "MemoryAsset"("userId", "galaxyId", "deletedAt");

-- CreateIndex
CREATE INDEX "MemoryAsset_planetId_deletedAt_idx" ON "MemoryAsset"("planetId", "deletedAt");

-- CreateIndex
CREATE INDEX "MemoryAsset_memoryId_idx" ON "MemoryAsset"("memoryId");

-- CreateIndex
CREATE INDEX "MemoryAsset_userId_galaxyId_sha256_idx" ON "MemoryAsset"("userId", "galaxyId", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "MemoryAsset_id_userId_galaxyId_key" ON "MemoryAsset"("id", "userId", "galaxyId");

-- CreateIndex
CREATE INDEX "AiJob_status_leaseExpiresAt_idx" ON "AiJob"("status", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "AiJob_userId_galaxyId_status_idx" ON "AiJob"("userId", "galaxyId", "status");

-- CreateIndex
CREATE INDEX "AiJob_memoryId_idx" ON "AiJob"("memoryId");

-- CreateIndex
CREATE INDEX "AiJob_assetId_idx" ON "AiJob"("assetId");

-- CreateIndex
CREATE INDEX "AiJob_resonanceCandidateId_idx" ON "AiJob"("resonanceCandidateId");

-- CreateIndex
CREATE INDEX "AiJob_bookId_idx" ON "AiJob"("bookId");

-- CreateIndex
CREATE UNIQUE INDEX "AiJob_id_userId_galaxyId_key" ON "AiJob"("id", "userId", "galaxyId");

-- CreateIndex
CREATE INDEX "PlanetRelationship_userId_galaxyId_sourcePlanetId_deletedAt_idx" ON "PlanetRelationship"("userId", "galaxyId", "sourcePlanetId", "deletedAt");

-- CreateIndex
CREATE INDEX "PlanetRelationship_userId_galaxyId_targetPlanetId_deletedAt_idx" ON "PlanetRelationship"("userId", "galaxyId", "targetPlanetId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlanetRelationship_id_userId_galaxyId_key" ON "PlanetRelationship"("id", "userId", "galaxyId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanetRelationship_userId_galaxyId_sourcePlanetId_targetPla_key" ON "PlanetRelationship"("userId", "galaxyId", "sourcePlanetId", "targetPlanetId", "relationshipType");

-- CreateIndex
CREATE INDEX "ResonanceCandidate_userId_galaxyId_status_deletedAt_idx" ON "ResonanceCandidate"("userId", "galaxyId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "ResonanceCandidate_sourceMemoryId_idx" ON "ResonanceCandidate"("sourceMemoryId");

-- CreateIndex
CREATE INDEX "ResonanceCandidate_targetMemoryId_idx" ON "ResonanceCandidate"("targetMemoryId");

-- CreateIndex
CREATE UNIQUE INDEX "ResonanceCandidate_id_userId_galaxyId_key" ON "ResonanceCandidate"("id", "userId", "galaxyId");

-- CreateIndex
CREATE UNIQUE INDEX "ResonanceCandidate_userId_galaxyId_sourceMemoryId_targetMem_key" ON "ResonanceCandidate"("userId", "galaxyId", "sourceMemoryId", "targetMemoryId");

-- CreateIndex
CREATE INDEX "Book_userId_galaxyId_status_deletedAt_idx" ON "Book"("userId", "galaxyId", "status", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Book_id_userId_galaxyId_key" ON "Book"("id", "userId", "galaxyId");

-- CreateIndex
CREATE INDEX "BookMemory_userId_galaxyId_bookId_deletedAt_idx" ON "BookMemory"("userId", "galaxyId", "bookId", "deletedAt");

-- CreateIndex
CREATE INDEX "BookMemory_memoryId_idx" ON "BookMemory"("memoryId");

-- CreateIndex
CREATE UNIQUE INDEX "BookMemory_id_userId_galaxyId_key" ON "BookMemory"("id", "userId", "galaxyId");

-- CreateIndex
CREATE UNIQUE INDEX "BookMemory_bookId_memoryId_key" ON "BookMemory"("bookId", "memoryId");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_operationId_key" ON "IdempotencyRecord"("operationId");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_userId_galaxyId_scope_status_idx" ON "IdempotencyRecord"("userId", "galaxyId", "scope", "status");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_id_userId_galaxyId_key" ON "IdempotencyRecord"("id", "userId", "galaxyId");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_userId_galaxyId_scope_key_key" ON "IdempotencyRecord"("userId", "galaxyId", "scope", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Galaxy_id_userId_key" ON "Galaxy"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Planet_coverAssetId_key" ON "Planet"("coverAssetId");

-- CreateIndex
CREATE INDEX "Planet_userId_galaxyId_deletedAt_idx" ON "Planet"("userId", "galaxyId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Planet_id_userId_galaxyId_key" ON "Planet"("id", "userId", "galaxyId");

-- CreateIndex
CREATE UNIQUE INDEX "Planet_coverAssetId_userId_galaxyId_key" ON "Planet"("coverAssetId", "userId", "galaxyId");

-- CreateIndex
CREATE INDEX "SharedBook_userId_galaxyId_idx" ON "SharedBook"("userId", "galaxyId");

-- CreateIndex
CREATE INDEX "SharedBook_bookId_idx" ON "SharedBook"("bookId");

-- CreateIndex
CREATE UNIQUE INDEX "SharedBook_id_userId_galaxyId_key" ON "SharedBook"("id", "userId", "galaxyId");

-- AddForeignKey
ALTER TABLE "Galaxy" ADD CONSTRAINT "Galaxy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Planet" ADD CONSTRAINT "Planet_galaxyId_userId_fkey" FOREIGN KEY ("galaxyId", "userId") REFERENCES "Galaxy"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Planet" ADD CONSTRAINT "Planet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Planet" ADD CONSTRAINT "Planet_coverAssetId_userId_galaxyId_fkey" FOREIGN KEY ("coverAssetId", "userId", "galaxyId") REFERENCES "MemoryAsset"("id", "userId", "galaxyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_galaxyId_userId_fkey" FOREIGN KEY ("galaxyId", "userId") REFERENCES "Galaxy"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_planetId_userId_galaxyId_fkey" FOREIGN KEY ("planetId", "userId", "galaxyId") REFERENCES "Planet"("id", "userId", "galaxyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryAsset" ADD CONSTRAINT "MemoryAsset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryAsset" ADD CONSTRAINT "MemoryAsset_galaxyId_userId_fkey" FOREIGN KEY ("galaxyId", "userId") REFERENCES "Galaxy"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryAsset" ADD CONSTRAINT "MemoryAsset_planetId_userId_galaxyId_fkey" FOREIGN KEY ("planetId", "userId", "galaxyId") REFERENCES "Planet"("id", "userId", "galaxyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryAsset" ADD CONSTRAINT "MemoryAsset_memoryId_userId_galaxyId_fkey" FOREIGN KEY ("memoryId", "userId", "galaxyId") REFERENCES "Memory"("id", "userId", "galaxyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiJob" ADD CONSTRAINT "AiJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiJob" ADD CONSTRAINT "AiJob_galaxyId_userId_fkey" FOREIGN KEY ("galaxyId", "userId") REFERENCES "Galaxy"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiJob" ADD CONSTRAINT "AiJob_planetId_userId_galaxyId_fkey" FOREIGN KEY ("planetId", "userId", "galaxyId") REFERENCES "Planet"("id", "userId", "galaxyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiJob" ADD CONSTRAINT "AiJob_memoryId_userId_galaxyId_fkey" FOREIGN KEY ("memoryId", "userId", "galaxyId") REFERENCES "Memory"("id", "userId", "galaxyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiJob" ADD CONSTRAINT "AiJob_assetId_userId_galaxyId_fkey" FOREIGN KEY ("assetId", "userId", "galaxyId") REFERENCES "MemoryAsset"("id", "userId", "galaxyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiJob" ADD CONSTRAINT "AiJob_resonanceCandidateId_userId_galaxyId_fkey" FOREIGN KEY ("resonanceCandidateId", "userId", "galaxyId") REFERENCES "ResonanceCandidate"("id", "userId", "galaxyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiJob" ADD CONSTRAINT "AiJob_bookId_userId_galaxyId_fkey" FOREIGN KEY ("bookId", "userId", "galaxyId") REFERENCES "Book"("id", "userId", "galaxyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanetRelationship" ADD CONSTRAINT "PlanetRelationship_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanetRelationship" ADD CONSTRAINT "PlanetRelationship_galaxyId_userId_fkey" FOREIGN KEY ("galaxyId", "userId") REFERENCES "Galaxy"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanetRelationship" ADD CONSTRAINT "PlanetRelationship_sourcePlanetId_userId_galaxyId_fkey" FOREIGN KEY ("sourcePlanetId", "userId", "galaxyId") REFERENCES "Planet"("id", "userId", "galaxyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanetRelationship" ADD CONSTRAINT "PlanetRelationship_targetPlanetId_userId_galaxyId_fkey" FOREIGN KEY ("targetPlanetId", "userId", "galaxyId") REFERENCES "Planet"("id", "userId", "galaxyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResonanceCandidate" ADD CONSTRAINT "ResonanceCandidate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResonanceCandidate" ADD CONSTRAINT "ResonanceCandidate_galaxyId_userId_fkey" FOREIGN KEY ("galaxyId", "userId") REFERENCES "Galaxy"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResonanceCandidate" ADD CONSTRAINT "ResonanceCandidate_sourceMemoryId_userId_galaxyId_fkey" FOREIGN KEY ("sourceMemoryId", "userId", "galaxyId") REFERENCES "Memory"("id", "userId", "galaxyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResonanceCandidate" ADD CONSTRAINT "ResonanceCandidate_targetMemoryId_userId_galaxyId_fkey" FOREIGN KEY ("targetMemoryId", "userId", "galaxyId") REFERENCES "Memory"("id", "userId", "galaxyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Book" ADD CONSTRAINT "Book_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Book" ADD CONSTRAINT "Book_galaxyId_userId_fkey" FOREIGN KEY ("galaxyId", "userId") REFERENCES "Galaxy"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookMemory" ADD CONSTRAINT "BookMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookMemory" ADD CONSTRAINT "BookMemory_galaxyId_userId_fkey" FOREIGN KEY ("galaxyId", "userId") REFERENCES "Galaxy"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookMemory" ADD CONSTRAINT "BookMemory_bookId_userId_galaxyId_fkey" FOREIGN KEY ("bookId", "userId", "galaxyId") REFERENCES "Book"("id", "userId", "galaxyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookMemory" ADD CONSTRAINT "BookMemory_memoryId_userId_galaxyId_fkey" FOREIGN KEY ("memoryId", "userId", "galaxyId") REFERENCES "Memory"("id", "userId", "galaxyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedBook" ADD CONSTRAINT "SharedBook_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedBook" ADD CONSTRAINT "SharedBook_galaxyId_userId_fkey" FOREIGN KEY ("galaxyId", "userId") REFERENCES "Galaxy"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedBook" ADD CONSTRAINT "SharedBook_bookId_userId_galaxyId_fkey" FOREIGN KEY ("bookId", "userId", "galaxyId") REFERENCES "Book"("id", "userId", "galaxyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_galaxyId_userId_fkey" FOREIGN KEY ("galaxyId", "userId") REFERENCES "Galaxy"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;
