import { describe, expect, it, vi } from "vitest";

const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect }));

import ResonancePage from "./page";

describe("ResonancePage", () => {
  it("retires the legacy resonance client and redirects visitors to the galaxy workspace", () => {
    expect(() => ResonancePage()).toThrow("REDIRECT:/galaxy");
    expect(redirect).toHaveBeenCalledWith("/galaxy");
  });
});
