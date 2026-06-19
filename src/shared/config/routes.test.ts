import { describe, expect, it } from "vitest";

import { appRoutes } from "./routes";

describe("app route registry", () => {
  it("keeps the first-stage routes explicit and stable", () => {
    expect(appRoutes.map((route) => route.href)).toEqual([
      "/galaxy",
      "/planet/mock-mom",
      "/memory/new",
      "/resonance",
      "/themes",
      "/books/new",
    ]);
  });
});
