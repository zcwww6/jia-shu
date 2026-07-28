import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const sourceRoot = join(process.cwd(), "src");

const retiredPaths = [
  "app/api/ai/extract/route.ts",
  "app/api/ai/extract/route.test.ts",
  "app/api/intersections/scan/route.ts",
  "app/api/intersections/scan/route.test.ts",
  "app/api/books/generate/route.ts",
  "app/api/books/generate/route.test.ts",
  "app/api/books/publish/route.ts",
  "app/api/books/publish/publish.test.ts",
  "shared/legacy-ai-entry.ts",
  "features/demo-loop/memory-new-client-page.tsx",
  "features/demo-loop/resonance-client-page.tsx",
  "features/demo-loop/privacy-client-page.tsx",
  "features/demo-loop/storage.ts",
  "features/demo-loop/storage.test.ts",
  "features/demo-loop/demo-loop-shell.tsx",
  "shared/mock/demo-session.ts",
];

const retiredRuntimeReferences = [
  "/api/ai/extract",
  "/api/intersections/scan",
  "/api/books/generate",
  "/api/books/publish",
  "legacy-ai-entry",
  "demo-loop-shell",
  "memory-new-client-page",
  "resonance-client-page",
  "privacy-client-page",
  "demo-session",
  "jiashu-demo-",
  "export const resonanceTracks",
  "export const bookDrafts",
];

function productionSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) return productionSourceFiles(entryPath);
    if (!/\.[cm]?[jt]sx?$/.test(entry.name) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) {
      return [];
    }
    return [entryPath];
  });
}

describe("legacy demo surface retirement", () => {
  it("leaves no retired routes, clients, storage, or precise deprecated runtime markers in production source", () => {
    const remainingPaths = retiredPaths.filter((path) => existsSync(join(sourceRoot, path)));
    const remainingReferences = productionSourceFiles(sourceRoot).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return retiredRuntimeReferences
        .filter((reference) => source.includes(reference))
        .map((reference) => `${relative(sourceRoot, file)} -> ${reference}`);
    });

    expect({ remainingPaths, remainingReferences }).toEqual({
      remainingPaths: [],
      remainingReferences: [],
    });
  });
});
