import { describe, expect, it, vi } from "vitest";

const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

const { ResonanceClientPage } = vi.hoisted(() => ({
  ResonanceClientPage: vi.fn(() => null),
}));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/features/demo-loop/resonance-client-page", () => ({ ResonanceClientPage }));

import ResonancePage from "./page";

describe("ResonancePage", () => {
  it("retires the legacy resonance client and redirects visitors to the galaxy workspace", () => {
    expect(() => ResonancePage()).toThrow("REDIRECT:/galaxy");
    expect(redirect).toHaveBeenCalledWith("/galaxy");
    expect(ResonanceClientPage).not.toHaveBeenCalled();
  });
});
