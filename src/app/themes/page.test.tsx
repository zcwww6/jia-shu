import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import ThemesPage from "./page";

describe("ThemesPage", () => {
  it("returns the workshop CTA to the guarded galaxy workspace", () => {
    render(<ThemesPage />);

    expect(screen.getByRole("link", { name: "进入家书工坊" })).toHaveAttribute("href", "/galaxy");
  });
});
