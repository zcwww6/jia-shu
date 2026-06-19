import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PlanetExplorer } from "./planet-explorer";

describe("PlanetExplorer", () => {
  it("renders the selected planet profile and story nodes", () => {
    render(<PlanetExplorer planetId="mock-mom" />);

    expect(screen.getByRole("heading", { name: "妈妈的星球" })).toBeInTheDocument();
    expect(screen.getByText("新家除夕")).toBeInTheDocument();
    expect(screen.getByText("点亮记忆星")).toBeInTheDocument();
    expect(screen.getByText("写成家书")).toBeInTheDocument();
  });
});
