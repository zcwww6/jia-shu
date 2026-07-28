import { describe, expect, it } from "vitest";

import { appRoutes } from "./routes";

describe("app route registry", () => {
  it("routes every old-product navigation entry into the guarded galaxy workspace", () => {
    expect(appRoutes.map((route) => route.href)).toEqual([
      "/galaxy",
      "/galaxy",
      "/galaxy",
      "/galaxy",
      "/galaxy",
      "/galaxy",
    ]);
  });
});
