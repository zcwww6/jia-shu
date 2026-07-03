import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { authConfig } from "./auth.config";

describe("authConfig.callbacks.authorized", () => {
  const authorized = authConfig.callbacks?.authorized;

  it("allows /sign-in without authentication", async () => {
    const result = await authorized?.({
      auth: null,
      request: new NextRequest("http://localhost/sign-in"),
    });

    expect(result).toBe(true);
  });

  it("allows /share routes without authentication", async () => {
    const result = await authorized?.({
      auth: null,
      request: new NextRequest("http://localhost/share/token-123"),
    });

    expect(result).toBe(true);
  });

  it("denies protected routes without authentication", async () => {
    const result = await authorized?.({
      auth: null,
      request: new NextRequest("http://localhost/galaxy"),
    });

    expect(result).toBe(false);
  });

  it("allows protected routes with authentication", async () => {
    const result = await authorized?.({
      auth: { user: { id: "user-1", email: "user@example.com" } } as never,
      request: new NextRequest("http://localhost/settings/privacy"),
    });

    expect(result).toBe(true);
  });
});
