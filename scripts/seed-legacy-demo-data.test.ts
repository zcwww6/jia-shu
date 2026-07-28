import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("legacy family demo data seed", () => {
  it("keeps a complete, non-destructive family-story seed contract", async () => {
    const script = await readFile(resolve(process.cwd(), "scripts/seed-legacy-demo-data.ts"), "utf8");

    expect(script).toContain("--dry-run");
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
    expect(script).not.toContain("DELETE FROM");
    expect(script).not.toContain("UPDATE \"User\"");
  });
});
