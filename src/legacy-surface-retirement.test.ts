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
  "demo-session",
  "localStorage",
  "export const resonanceTracks",
  "export const bookDrafts",
];

const retiredEntryPages = [
  "app/memory/new/page.tsx",
  "app/resonance/page.tsx",
  "app/books/new/page.tsx",
  "app/settings/privacy/page.tsx",
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
  it("leaves no retired routes, clients, storage, or business mock runtime references in production source", () => {
    const remainingPaths = retiredPaths.filter((path) => existsSync(join(sourceRoot, path)));
    const remainingReferences = productionSourceFiles(sourceRoot).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return retiredRuntimeReferences
        .filter((reference) => source.includes(reference))
        .map((reference) => `${relative(sourceRoot, file)} -> ${reference}`);
    });
    const redirectPageViolations = retiredEntryPages.flatMap((page) => {
      const source = readFileSync(join(sourceRoot, page), "utf8");
      return !source.includes('redirect("/galaxy")') || source.includes("features/demo-loop")
        ? [page]
        : [];
    });

    expect({ remainingPaths, remainingReferences, redirectPageViolations }).toEqual({
      remainingPaths: [],
      remainingReferences: [],
      redirectPageViolations: [],
    });
  });
});
