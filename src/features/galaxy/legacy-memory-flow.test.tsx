import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Planet } from "@/shared/types/galaxy";

import { GalaxyWorkspace, shouldStartNewMemoryExtraction } from "./galaxy-workspace";

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

  it("continues polling a queued job on retry and only starts a new job after failure", () => {
    expect(shouldStartNewMemoryExtraction({ id: "job-1", status: "queued" })).toBe(false);
    expect(shouldStartNewMemoryExtraction({ id: "job-1", status: "processing" })).toBe(false);
    expect(shouldStartNewMemoryExtraction({ id: "job-1", status: "failed" })).toBe(true);
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
});
