import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MemoryExtractResponse } from "@/shared/types/galaxy";

import { GalaxyWorkspace } from "./galaxy-workspace";

const extractResponse: MemoryExtractResponse = {
  memory: {
    id: "memory-live-1",
    planetId: "mock-mom",
    title: "缝合测试记忆星",
    occurredAt: "2018 年除夕",
    location: "新房客厅",
    people: ["妈妈", "我"],
    emotions: ["安心", "团圆"],
    visibility: "family",
    summary: "在星系内点亮的一颗真实记忆星。",
  },
  suggestion: {
    title: "缝合测试记忆星",
    occurredAt: "2018 年除夕",
    location: "新房客厅",
    people: ["妈妈", "我"],
    emotions: ["安心", "团圆"],
    summary: "在星系内点亮的一颗真实记忆星。",
    uncertainFields: [],
  },
  sourceText: "在星系内写下的一句话。",
  status: "confirmed",
};

describe("GalaxyWorkspace 星系内闭环缝合", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("星系通用入口不再使用旧抽取路由或本地业务写入", () => {
    render(<GalaxyWorkspace />);

    fireEvent.click(screen.getByRole("button", { name: "点亮记忆星" }));

    expect(screen.getByText("目标星球：我的星球")).toBeInTheDocument();
    expect(window.localStorage.getItem("jiashu-galaxy-extract")).toBeNull();
    expect(window.localStorage.getItem("jiashu-galaxy-lit-memories")).toBeNull();
  });

  it("刷新后（localStorage 预置）已点亮的记忆仍然回显在记忆星群", () => {
    window.localStorage.setItem("jiashu-galaxy-extract", JSON.stringify(extractResponse));
    window.localStorage.setItem(
      "jiashu-galaxy-lit-memories",
      JSON.stringify([extractResponse.memory]),
    );

    render(<GalaxyWorkspace />);

    fireEvent.click(screen.getByRole("button", { name: "记忆星群" }));

    expect(screen.getByRole("button", { name: "缝合测试记忆星" })).toBeInTheDocument();
  });
});
