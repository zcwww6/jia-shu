import { describe, expect, it } from "vitest";

import { appRoutes } from "./routes";

describe("app route registry", () => {
  it("routes resonance and book navigation entries into the guarded galaxy workspace", () => {
    expect(appRoutes.map((route) => route.href)).toEqual([
      "/galaxy",
      "/planet/mock-mom",
      "/memory/new",
      "/galaxy",
      "/themes",
      "/galaxy",
    ]);
  });
});
