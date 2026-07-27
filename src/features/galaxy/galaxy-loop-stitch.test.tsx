import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { planets } from "@/shared/mock/galaxy-data";
import type { MemoryExtractResponse, ResonanceScanResponse } from "@/shared/types/galaxy";

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

const currentSessionReview = {
  id: "memory-current",
  planetId: "mock-me",
  status: "needs_confirmation",
  version: 3,
  title: "本次会话记忆",
  summary: "已确认的当前会话记忆。",
  tags: ["当前会话"],
  occurredAtLabel: "今天",
  locationLabel: "家中",
  people: ["我"],
  visibility: "family",
  allowResonance: true,
  allowBook: true,
  uncertainFields: [],
};

const successfulResonance: ResonanceScanResponse = {
  candidate: {
    id: "resonance-current",
    title: "本次会话共鸣",
    sourceMemoryIds: ["memory-current"],
    score: 0.92,
    status: "candidate",
    reason: "当前会话已确认记忆形成的共鸣。",
  },
  comparedMemories: [
    {
      id: "memory-current",
      planetId: "mock-me",
      title: "本次会话记忆",
      occurredAt: "今天",
      location: "家中",
      people: ["我"],
      emotions: [],
      visibility: "family",
      summary: "已确认的当前会话记忆。",
    },
  ],
  breakdown: { time: 1, people: 1, location: 1, semantic: 1 },
  requiresConfirmation: true,
};

async function confirmCurrentSessionMemory(scanResponse: Response) {
  vi.useFakeTimers();
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ id: "memory-current", status: "draft", version: 1 }), { status: 201 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-current", status: "queued" }), { status: 202 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-current", status: "completed" }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify(currentSessionReview), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ...currentSessionReview, status: "confirmed", version: 4 }), { status: 200 }))
    .mockResolvedValueOnce(scanResponse);
  vi.stubGlobal("fetch", fetchMock);

  render(<GalaxyWorkspace initialPlanets={planets} initialLinks={[]} />);
  fireEvent.click(screen.getByRole("button", { name: "点亮记忆星" }));
  fireEvent.click(screen.getByRole("button", { name: "点亮为记忆星" }));
  await act(async () => {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(250);
  });
  fireEvent.click(screen.getByRole("button", { name: "确认点亮记忆星" }));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(screen.getByRole("button", { name: "沿共鸣星轨前进" })).toBeInTheDocument();
  return fetchMock;
}

describe("GalaxyWorkspace 星系内闭环缝合", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
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
    expect(screen.getByRole("complementary", { name: "星图详情" })).toBeInTheDocument();
    expect(screen.queryByText("两颗星球之间，不是合并，而是共鸣")).not.toBeInTheDocument();
  });

  it("keeps the confirmed-memory panel open when resonance scanning fails", async () => {
    const fetchMock = await confirmCurrentSessionMemory(
      new Response(JSON.stringify({ message: "共鸣服务暂不可用" }), { status: 503 }),
    );

    fireEvent.click(screen.getByRole("button", { name: "沿共鸣星轨前进" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenLastCalledWith("/api/intersections/scan", expect.anything());
    expect(screen.getByText("共鸣扫描失败，请稍后重试")).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "星图详情" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "共鸣星轨" })).not.toBeInTheDocument();
  });

  it("enters the resonance scene and shows the result after a confirmed-memory scan succeeds", async () => {
    const fetchMock = await confirmCurrentSessionMemory(new Response(JSON.stringify(successfulResonance), { status: 200 }));

    fireEvent.click(screen.getByRole("button", { name: "沿共鸣星轨前进" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByRole("complementary", { name: "星图详情" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "共鸣星轨" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/intersections/scan", expect.anything());
    expect(window.localStorage.getItem("jiashu-galaxy-resonance")).toContain("本次会话共鸣");
    expect(screen.getByRole("button", { name: "本次会话共鸣" })).toBeInTheDocument();
  });
});
