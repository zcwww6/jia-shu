import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GalaxyWorkspace } from "./galaxy-workspace";

describe("GalaxyWorkspace", () => {
  it("renders the v7.3 galaxy controls and route guide", () => {
    render(<GalaxyWorkspace />);

    expect(screen.getByRole("heading", { name: "我的星系" })).toBeInTheDocument();
    expect(screen.getByText("新手推荐航线")).toBeInTheDocument();
    expect(screen.getByText("靠近妈妈的星球")).toBeInTheDocument();
    expect(screen.getAllByText("家书工坊").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole("link").length).toBeGreaterThanOrEqual(8);
  });
});
