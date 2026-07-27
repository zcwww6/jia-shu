import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { softDeleteAsset } from "@/server/db/asset-repo";
import { archiveFamilyPlanet } from "@/server/services/planet.service";

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function hasErrorCode(value: unknown, code: string) {
  return value instanceof Error && "code" in value && value.code === code;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  expect(databaseUrl, "DATABASE_URL is required");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID().replaceAll("-", "");

  try {
    const user = await prisma.user.create({ data: { email: `cover-archive-race-${suffix}@example.test` } });
    const galaxy = await prisma.galaxy.create({ data: { userId: user.id, name: "Cover archive race verification" } });
    const planet = await prisma.planet.create({
      data: { userId: user.id, galaxyId: galaxy.id, name: "Covered planet", type: "other" },
    });
    const asset = await prisma.memoryAsset.create({
      data: {
        userId: user.id,
        galaxyId: galaxy.id,
        planetId: planet.id,
        kind: "image",
        visibility: "private",
        storageKey: `verification/${suffix}/cover.jpg`,
        mimeType: "image/jpeg",
        sizeBytes: 1,
        sha256: suffix,
        originalName: "cover.jpg",
        status: "stored",
      },
    });
    const coveredPlanet = await prisma.planet.update({
      where: { id: planet.id },
      data: { coverAssetId: asset.id },
    });
    const scope = { userId: user.id, galaxyId: galaxy.id };

    const outcomes = await Promise.allSettled([
      archiveFamilyPlanet(scope, coveredPlanet.id, coveredPlanet.version),
      softDeleteAsset({ ...scope, assetId: asset.id, version: asset.version }),
    ]);

    const archive = outcomes[0];
    const assetDelete = outcomes[1];
    expect(archive?.status === "fulfilled", "archive did not complete during the cover deletion race");
    expect(
      assetDelete?.status === "rejected" && hasErrorCode(assetDelete.reason, "ASSET_IN_USE"),
      "cover asset deletion did not fail closed with ASSET_IN_USE",
    );

    const [finalPlanet, finalAsset] = await Promise.all([
      prisma.planet.findUnique({ where: { id: planet.id } }),
      prisma.memoryAsset.findUnique({ where: { id: asset.id } }),
    ]);
    expect(finalPlanet?.archivedAt !== null && finalPlanet?.deletedAt !== null, "archive state was not persisted");
    expect(finalPlanet?.coverAssetId === asset.id, "archive unexpectedly removed the recoverable cover reference");
    expect(finalAsset?.deletedAt === null, "archive left its cover asset soft-deleted");

    process.stdout.write("postgres-cover-asset-archive-race=passed\n");
  } finally {
    await prisma.$disconnect();
  }
}

void main();
