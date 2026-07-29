import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const workspaceRoot = process.cwd();

describe("legacy family demo data seed", () => {
  it("keeps a complete, non-destructive family-story seed contract", async () => {
    const script = await readFile(resolve(process.cwd(), "scripts/seed-legacy-demo-data.ts"), "utf8");

    expect(script).toContain("--dry-run");
    expect(script).toContain("写入演示数据必须同时提供 --user-id 与 --galaxy-id");
    expect(script).toContain("assertExplicitWriteScope(options)");
    expect(script).toContain("ON CONFLICT DO NOTHING");
    expect(script).toContain("BEGIN;");
    expect(script).toContain("COMMIT;");
    expect(script).toContain("林晚晴");
    expect(script).toContain("沈知秋");
    expect(script).toContain("林小满");
    expect(script).toContain("纪念星");
    expect(script).toContain("团圆饭");
    expect(script).toContain("雨夜送学");
    expect(script).toContain("外婆的菜谱");
    expect(script).toContain("成长");
    expect(script).toContain("ResonanceCandidate");
    expect(script).toContain("SharedBook");
    expect(script).toContain('INSERT INTO "MemoryAsset"');
    expect(script).toContain('"normalizedStorageKey"');
    expect(script).toContain('"thumbnailStorageKey"');
    expect(script).toContain('"coverAssetId"');
    expect(script).toContain("MEDIA_STORAGE_ROOT");
    expect(script).toContain("docker", ["cp"]);
    expect(script).not.toContain("DELETE FROM");
    expect(script).not.toContain("UPDATE \"User\"");
  });

  it("reports deterministic scoped demo-media metadata without connecting to Docker", async () => {
    const { stdout } = await execFileAsync(process.execPath, [
      resolve(workspaceRoot, "node_modules/tsx/dist/cli.mjs"),
      "scripts/seed-legacy-demo-data.ts",
      "--dry-run",
    ], {
      cwd: workspaceRoot,
      windowsHide: true,
    });
    const result = JSON.parse(stdout) as {
      intended: Record<string, number>;
      media: {
        assetIdDerivation: string;
        dimensions: { height: number; width: number };
        mimeType: string;
        sourceImages: string[];
      };
    };

    expect(result.intended).toMatchObject({ imageAssets: 4, planetCovers: 4, storedMediaFiles: 24 });
    expect(result.media.assetIdDerivation).toContain("stableId");
    expect(result.media).toMatchObject({ mimeType: "image/webp", dimensions: { width: 1600, height: 1200 } });
    expect(result.media.sourceImages).toEqual([
      "kitchen-light.webp",
      "rainy-drive.webp",
      "starlight-drawing.webp",
      "osmanthus-recipe.webp",
    ]);
  });

  it("ships four readable original family-story illustrations", async () => {
    const files = ["kitchen-light.webp", "rainy-drive.webp", "starlight-drawing.webp", "osmanthus-recipe.webp"];

    await Promise.all(files.map(async (file) => {
      const path = resolve(workspaceRoot, "scripts/demo-media", file);
      await expect(stat(path)).resolves.toMatchObject({ size: expect.any(Number) });
      await expect(sharp(path).metadata()).resolves.toMatchObject({ format: "webp", width: 1600, height: 1200 });
    }));
  });
});
