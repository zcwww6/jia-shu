import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("isolated Docker verifier", () => {
  it("keeps Auth.js callbacks on the localhost host used to start sign-in", async () => {
    const script = await readFile(resolve(process.cwd(), "scripts/verify-immersive-mvp.ps1"), "utf8");

    expect(script).toContain('$env:AUTH_URL = "http://localhost:$Port"');
  });
});
