import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";

import { authConfig, protectedRouteMatchers, protectedRoutePrefixes } from "./auth.config";

describe("authConfig.callbacks.authorized", () => {
  const authorized = authConfig.callbacks?.authorized;

  it("uses JWT sessions so the Edge middleware and primary auth share one cookie format", () => {
    expect(authConfig.session).toEqual({ strategy: "jwt" });
  });

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

  it("keeps middleware matchers in sync with protected route prefixes", () => {
    expect(protectedRouteMatchers).toEqual(protectedRoutePrefixes.map((prefix) => `${prefix}/:path*`));

    const middlewareSource = fs.readFileSync(path.resolve(process.cwd(), "middleware.ts"), "utf8");
    const matcherEntries = [...middlewareSource.matchAll(/"([^"]+\/:path\*)"/g)].map((match) => match[1]);

    expect(matcherEntries).toEqual(protectedRouteMatchers);
  });
});
