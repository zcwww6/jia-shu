import { describe, expect, it, vi } from "vitest";

const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock("next/navigation", () => ({
  redirect,
}));

import NewMemoryPage from "./page";

describe("NewMemoryPage", () => {
  it("redirects the retired memory mock entry to /galaxy", () => {
    expect(() => NewMemoryPage()).toThrow("REDIRECT:/galaxy");
    expect(redirect).toHaveBeenCalledWith("/galaxy");
  });
});
