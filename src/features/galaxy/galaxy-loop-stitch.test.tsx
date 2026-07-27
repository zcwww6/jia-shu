import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { planets } from "@/shared/mock/galaxy-data";
import type { MemoryExtractResponse } from "@/shared/types/galaxy";

import { GalaxyWorkspace } from "./galaxy-workspace";

const legacyExtract: MemoryExtractResponse = {
  memory: {
    id: "memory-stale",
    planetId: "mock-mom",
    title: "旧缓存记忆",
    occurredAt: "旧缓存时间",
    location: "旧缓存地点",
    people: ["旧缓存家人"],
    emotions: ["旧缓存情绪"],
    visibility: "family",
    summary: "不应在新会话中被使用的旧缓存。",
  },
  suggestion: {
    title: "旧缓存记忆",
    occurredAt: "旧缓存时间",
    location: "旧缓存地点",
    people: ["旧缓存家人"],
    emotions: ["旧缓存情绪"],
    summary: "不应在新会话中被使用的旧缓存。",
    uncertainFields: [],
  },
  sourceText: "旧缓存原文",
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

  it("不会用旧的抽取缓存显示或扫描共鸣", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    window.localStorage.setItem("jiashu-galaxy-extract", JSON.stringify(legacyExtract));

    render(<GalaxyWorkspace initialPlanets={planets} initialLinks={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "记忆星群" }));
    fireEvent.click(screen.getByRole("button", { name: "新家里的第一个除夕" }));

    expect(screen.queryByText("旧缓存地点")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "沿共鸣星轨前进" }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
