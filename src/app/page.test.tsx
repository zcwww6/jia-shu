import { describe, expect, it, vi } from "vitest";

const { auth } = vi.hoisted(() => ({
  auth: vi.fn(),
}));

const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock("@/auth", () => ({
  auth,
}));

vi.mock("next/navigation", () => ({
  redirect,
}));

import Home from "./page";

describe("Home", () => {
  it("redirects signed-in users to /galaxy", async () => {
    auth.mockResolvedValue({
      user: { id: "user-1", email: "user@example.com" },
    });

    await expect(Home()).rejects.toThrow("REDIRECT:/galaxy");
    expect(redirect).toHaveBeenCalledWith("/galaxy");
  });

  it("redirects signed-out users to /sign-in", async () => {
    auth.mockResolvedValue(null);

    await expect(Home()).rejects.toThrow("REDIRECT:/sign-in");
    expect(redirect).toHaveBeenCalledWith("/sign-in");
  });
});
