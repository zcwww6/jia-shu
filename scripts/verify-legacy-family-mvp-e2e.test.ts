import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

describe("legacy family MVP end-to-end verifier", () => {
  it("covers the authenticated family story and removes its isolated subject", async () => {
    const script = await readFile(resolve(process.cwd(), "scripts/verify-legacy-family-mvp-e2e.ts"), "utf8");

    expect(script).toContain("next-auth/jwt");
    expect(script).toContain("/api/planets");
    expect(script).toContain("/relationships");
    expect(script).toContain("/api/assets");
    expect(script).toContain("/ai-jobs");
    expect(script).toContain("/api/resonances/scan");
    expect(script).toContain("/api/books");
    expect(script).toContain("/share/");
    expect(script).toContain('kind: "audio"');
    expect(script).toContain("createPcmWave");
    expect(script).toContain("cleanupE2eSubject");
    expect(script).toContain("postgresContainer");
    expect(script).toContain("POSTGRES_USER");
    expect(script).not.toContain('import type { PrismaClient }');
    expect(script).toContain('UPDATE "Planet" SET "coverAssetId" = NULL');
    expect(script).toContain('DELETE FROM "Galaxy"');
    expect(script).toContain('DELETE FROM "User"');
    expect(script).toContain("const mediaDirectory = `/data/media/${userId}`");
    expect(script).toContain("test ! -e ${mediaDirectory}");
  });

  it("uses a PNG fixture that survives the production normalization pipeline", async () => {
    const script = await readFile(resolve(process.cwd(), "scripts/verify-legacy-family-mvp-e2e.ts"), "utf8");
    const encoded = script.match(/const onePixelPng = Buffer\.from\(\s*"([^"]+)"/)?.[1];
    expect(encoded).toBeTruthy();

    const bytes = Buffer.from(encoded!, "base64");
    await expect(sharp(bytes).rotate().toBuffer()).resolves.toBeInstanceOf(Buffer);
    await expect(sharp(bytes).rotate().resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true }).jpeg().toBuffer()).resolves.toBeInstanceOf(Buffer);
  });
});
