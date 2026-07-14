import { afterEach, describe, expect, it, vi } from "vitest";

import { readGalaxyExtractResult, readLitMemories } from "./storage";

describe("galaxy demo storage", () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("falls back to an empty list when persisted lit memories are not an array", () => {
    window.localStorage.setItem("jiashu-galaxy-lit-memories", JSON.stringify({ legacy: true }));

    expect(readLitMemories()).toEqual([]);
  });

  it("falls back to null when localStorage access throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage access is blocked", "SecurityError");
    });

    expect(readGalaxyExtractResult()).toBeNull();
  });
});
