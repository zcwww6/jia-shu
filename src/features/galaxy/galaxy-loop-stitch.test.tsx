import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GalaxyWorkspace } from "./galaxy-workspace";

describe("GalaxyWorkspace 星系内闭环缝合", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("没有持久化星球时拒绝快速记录且不发起请求", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<GalaxyWorkspace />);

    fireEvent.click(screen.getByRole("button", { name: "点亮记忆星" }));

    await expect(screen.findByText("请先选择一颗已保存的星球，再记录这段记忆")).resolves.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("不会从 localStorage 回显旧的记忆星业务内容", () => {
    window.localStorage.setItem("jiashu-galaxy-lit-memories", JSON.stringify([{
      id: "memory-old", planetId: "planet-self", title: "旧本地星", occurredAt: "", location: "", people: [], emotions: [], visibility: "family", summary: "",
    }]));
    render(<GalaxyWorkspace initialPlanets={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "记忆星群" }));

    expect(screen.queryByRole("button", { name: "旧本地星" })).not.toBeInTheDocument();
  });
});
