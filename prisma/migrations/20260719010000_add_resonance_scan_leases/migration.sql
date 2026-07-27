-- CreateTable
CREATE TABLE "ResonanceScanLease" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "galaxyId" TEXT NOT NULL,
    "sourceMemoryId" TEXT NOT NULL,
    "targetMemoryId" TEXT NOT NULL,
    "leaseToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResonanceScanLease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ResonanceScanLease_id_userId_galaxyId_key" ON "ResonanceScanLease"("id", "userId", "galaxyId");

-- CreateIndex
CREATE UNIQUE INDEX "ResonanceScanLease_userId_galaxyId_sourceMemoryId_targetMemoryId_key" ON "ResonanceScanLease"("userId", "galaxyId", "sourceMemoryId", "targetMemoryId");

-- CreateIndex
CREATE INDEX "ResonanceScanLease_expiresAt_idx" ON "ResonanceScanLease"("expiresAt");

-- AddForeignKey
ALTER TABLE "ResonanceScanLease" ADD CONSTRAINT "ResonanceScanLease_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResonanceScanLease" ADD CONSTRAINT "ResonanceScanLease_galaxyId_userId_fkey" FOREIGN KEY ("galaxyId", "userId") REFERENCES "Galaxy"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;
