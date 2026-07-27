import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RouteGuide } from "./route-guide";

describe("RouteGuide", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends resonance and book steps through the guarded galaxy workspace", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(<RouteGuide />);

    expect(screen.getByRole("link", { name: /沿共鸣星轨前进/ })).toHaveAttribute("href", "/galaxy");
    expect(screen.getByRole("link", { name: /写成一页家书/ })).toHaveAttribute("href", "/galaxy");
    expect(screen.getByRole("link", { name: "共鸣星轨" })).toHaveAttribute("href", "/galaxy");
    expect(screen.getByRole("link", { name: "家书工坊" })).toHaveAttribute("href", "/galaxy");
    expect(consoleError.mock.calls.flat().join(" ")).not.toContain("same key");
  });
});
