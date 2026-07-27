import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Planet } from "@/shared/types/galaxy";

import { GalaxyWorkspace } from "./galaxy-workspace";

const persistedPlanets: Planet[] = [
  {
    id: "planet-self", name: "我", type: "self", lifeState: "active", visibility: "private", role: "我",
    theme: "家书暖夜", summary: "", position: { x: 50, y: 50 }, stats: { memoryStars: 0, resonanceTracks: 0, bookDrafts: 0 }, version: 1,
  },
  {
    id: "planet-mom", name: "妈妈", type: "parent", lifeState: "active", visibility: "family", role: "母亲",
    theme: "家书暖夜", summary: "", position: { x: 62, y: 42 }, stats: { memoryStars: 0, resonanceTracks: 0, bookDrafts: 0 }, version: 1,
  },
];

const review = {
  id: "memory-1", planetId: "planet-mom", status: "needs_confirmation", version: 3,
  title: "除夕合照", summary: "全家团圆", tags: ["春节"], occurredAtLabel: "2018 年除夕",
  locationLabel: "新房", people: ["妈妈", "我"], visibility: "family", allowResonance: true,
  allowBook: true, uncertainFields: ["地点"],
};

describe("GalaxyWorkspace persisted text-memory flow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("binds the selected persisted planet, waits for review, and lights a star only after confirmation", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "memory-1", status: "draft", version: 1 }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-1", status: "queued" }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-1", status: "completed" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(review), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...review, status: "confirmed", version: 4 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<GalaxyWorkspace initialPlanets={persistedPlanets} initialLinks={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "进入妈妈漫游" }));
    fireEvent.click(screen.getByRole("button", { name: "点亮记忆" }));

    expect(screen.getByText("目标星球：妈妈")).toBeInTheDocument();
    expect(screen.queryByLabelText("这段记忆靠近哪颗星球")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "点亮为记忆星" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "确认点亮记忆星" })).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/memories", expect.objectContaining({
      body: expect.stringContaining("planet-mom"),
    }));
    expect(fetchMock).toHaveBeenCalledWith("/api/memories/memory-1/ai-jobs", expect.anything());
    expect(fetchMock).not.toHaveBeenCalledWith("/api/ai/extract", expect.anything());
    expect(screen.queryByRole("button", { name: "新点亮：除夕合照" })).not.toBeInTheDocument();
    expect(window.localStorage.getItem("jiashu-galaxy-extract")).toBeNull();
    expect(window.localStorage.getItem("jiashu-galaxy-lit-memories")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "确认点亮记忆星" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "除夕合照" })).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/memories/memory-1/confirm",
      expect.objectContaining({ headers: expect.objectContaining({ "If-Match-Version": "3" }) }),
    );
  });

  it("continues polling the same queued job on retry without another job POST", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "memory-1", status: "draft", version: 1 }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-1", status: "queued" }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "网络短暂中断" }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-1", status: "completed" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(review), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<GalaxyWorkspace initialPlanets={persistedPlanets} initialLinks={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "点亮记忆星" }));
    fireEvent.click(screen.getByRole("button", { name: "点亮为记忆星" }));
    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(screen.getByText("网络短暂中断")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重试 AI 整理" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(screen.getByRole("button", { name: "确认点亮记忆星" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/memories/memory-1/ai-jobs")).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/ai-jobs/job-1")).toEqual([
      ["/api/ai-jobs/job-1", { method: "GET" }],
      ["/api/ai-jobs/job-1", { method: "GET" }],
    ]);
  });

  it("continues polling the same processing job on retry without another job POST", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "memory-1", status: "draft", version: 1 }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-1", status: "processing" }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "网络短暂中断" }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-1", status: "completed" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(review), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<GalaxyWorkspace initialPlanets={persistedPlanets} initialLinks={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "点亮记忆星" }));
    fireEvent.click(screen.getByRole("button", { name: "点亮为记忆星" }));
    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(screen.getByText("网络短暂中断")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重试 AI 整理" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(screen.getByRole("button", { name: "确认点亮记忆星" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/memories/memory-1/ai-jobs")).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/ai-jobs/job-1")).toEqual([
      ["/api/ai-jobs/job-1", { method: "GET" }],
      ["/api/ai-jobs/job-1", { method: "GET" }],
    ]);
  });

  it("reloads the review for a completed job without starting another job", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "memory-1", status: "draft", version: 1 }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-1", status: "queued" }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-1", status: "completed" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "审阅暂不可用" }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(review), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<GalaxyWorkspace initialPlanets={persistedPlanets} initialLinks={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "点亮记忆星" }));
    fireEvent.click(screen.getByRole("button", { name: "点亮为记忆星" }));
    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(screen.getByText("审阅暂不可用")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重试 AI 整理" }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByRole("button", { name: "确认点亮记忆星" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/memories/memory-1/ai-jobs")).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/ai-jobs/job-1")).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/memories/memory-1")).toHaveLength(2);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/memories/memory-1", { method: "GET" });
  });

  it("does not create a new job when a draft has an unknown job state", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "memory-1", status: "draft", version: 1 }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "作业请求超时" }), { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<GalaxyWorkspace initialPlanets={persistedPlanets} initialLinks={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "点亮记忆星" }));
    fireEvent.click(screen.getByRole("button", { name: "点亮为记忆星" }));
    await waitFor(() => expect(screen.getByText("作业请求超时")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "重试 AI 整理" }));

    expect(screen.getByText("AI 作业状态未知，请刷新或重新打开这条草稿后再试")).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/memories/memory-1/ai-jobs")).toHaveLength(1);
  });

  it("starts a replacement job only after the recorded job has failed", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "memory-1", status: "draft", version: 1 }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-1", status: "queued" }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-1", status: "failed", error: "模型不可用" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-2", status: "queued" }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-2", status: "failed", error: "第二次失败" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<GalaxyWorkspace initialPlanets={persistedPlanets} initialLinks={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "点亮记忆星" }));
    fireEvent.click(screen.getByRole("button", { name: "点亮为记忆星" }));
    await waitFor(() => expect(screen.getByText("模型不可用")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "重试 AI 整理" }));

    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === "/api/memories/memory-1/ai-jobs")).toHaveLength(2));
    await waitFor(() => expect(screen.getByText("第二次失败")).toBeInTheDocument());
  });

  it("keeps the draft safe and offers retry when the AI job fails", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "memory-1", status: "draft", version: 1 }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-1", status: "queued" }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-1", status: "failed", error: "模型不可用" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<GalaxyWorkspace initialPlanets={persistedPlanets} initialLinks={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "点亮记忆星" }));
    fireEvent.click(screen.getByRole("button", { name: "点亮为记忆星" }));

    await waitFor(() => expect(screen.getByText("模型不可用")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "重试 AI 整理" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "新点亮：除夕合照" })).not.toBeInTheDocument();
  });

  it("stops bounded polling after twenty controlled queued responses", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "memory-1", status: "draft", version: 1 }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-1", status: "queued" }), { status: 202 }))
      .mockImplementation(() => Promise.resolve(
        new Response(JSON.stringify({ id: "job-1", status: "queued" }), { status: 200 }),
      ));
    vi.stubGlobal("fetch", fetchMock);

    render(<GalaxyWorkspace initialPlanets={persistedPlanets} initialLinks={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "点亮记忆星" }));
    fireEvent.click(screen.getByRole("button", { name: "点亮为记忆星" }));

    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(screen.getByText("AI 整理仍在进行中，请稍后重试。")).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/ai-jobs/job-1")).toHaveLength(20);
  });
});
