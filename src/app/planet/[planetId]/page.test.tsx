import { describe, expect, it, vi } from "vitest";

const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect }));

import PlanetPage from "./page";

describe("PlanetPage", () => {
  it("redirects a retired direct planet URL to the data-backed galaxy workspace", () => {
    expect(() => PlanetPage()).toThrow("REDIRECT:/galaxy");
    expect(redirect).toHaveBeenCalledWith("/galaxy");
  });
});
