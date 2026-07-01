import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("在星系内点亮记忆时调用 /api/ai/extract 并渲染真实抽取结果", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => extractResponse,
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<GalaxyWorkspace />);

    fireEvent.click(screen.getByRole("button", { name: "点亮记忆星" }));
    fireEvent.click(screen.getByRole("button", { name: "点亮为记忆星" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/ai/extract",
        expect.objectContaining({ method: "POST" }),
      );
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "缝合测试记忆星" })).toBeInTheDocument();
    });

    // 点亮的记忆写入 localStorage，供刷新后回显。
    expect(window.localStorage.getItem("jiashu-galaxy-extract")).toContain("memory-live-1");
    expect(window.localStorage.getItem("jiashu-galaxy-lit-memories")).toContain("memory-live-1");
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
