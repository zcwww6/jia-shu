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
  const defaultTextSource = "2018 年除夕，妈妈和我在新房拍下了一张合照。";

  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  async function startQueuedMemoryPolling() {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "memory-1", status: "draft", version: 1 }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-1", status: "queued" }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    const rendered = render(<GalaxyWorkspace initialPlanets={persistedPlanets} initialLinks={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "点亮记忆星" }));
    submitTextMemory();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    return { fetchMock, ...rendered };
  }

  function submitTextMemory(content = defaultTextSource) {
    fireEvent.change(screen.getByLabelText("记忆内容"), { target: { value: content } });
    fireEvent.click(screen.getByRole("button", { name: "点亮为记忆星" }));
  }

  it("continues from the server's succeeded AI job state into review and confirmation", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "memory-1", status: "draft", version: 1 }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-1", status: "queued" }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-1", status: "succeeded" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(review), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...review, status: "confirmed", version: 4 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<GalaxyWorkspace initialPlanets={persistedPlanets} initialLinks={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "进入妈妈漫游" }));
    fireEvent.click(screen.getByRole("button", { name: "点亮记忆" }));

    expect(screen.getByText("目标星球：妈妈")).toBeInTheDocument();
    expect(screen.queryByLabelText("这段记忆靠近哪颗星球")).not.toBeInTheDocument();
    submitTextMemory();

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

    await waitFor(() => expect(screen.getByTestId("galaxy-app")).toHaveClass("scene-themes"));
    await waitFor(() => expect(screen.getByText("已加入当前主题的装订清单")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/memories/memory-1/confirm",
      expect.objectContaining({ headers: expect.objectContaining({ "If-Match-Version": "3" }) }),
    );
    expect(screen.getByRole("checkbox", { name: "装订来源：除夕合照" })).toBeChecked();
  });

  it("uploads one voice source before creating its real AI memory draft", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "asset-voice-1", planetId: "planet-mom", kind: "audio", visibility: "family",
        mimeType: "audio/mp4", sizeBytes: 5, originalName: "family-story.m4a", status: "stored",
        createdAt: "2026-07-28T00:00:00.000Z",
      }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "memory-voice-1", status: "draft", version: 1 }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-voice-1", status: "failed", error: "模型暂不可用" }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<GalaxyWorkspace initialPlanets={persistedPlanets} initialLinks={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "进入妈妈漫游" }));
    fireEvent.click(screen.getByRole("button", { name: "点亮记忆" }));
    fireEvent.change(screen.getByLabelText("选择记忆来源"), { target: { value: "audio" } });
    const file = new File(["voice"], "family-story.m4a", { type: "audio/mp4" });
    fireEvent.change(screen.getByLabelText("上传语音"), { target: { files: [file] } });

    fireEvent.click(screen.getByRole("button", { name: "发送给 AI 整理" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const uploadRequest = fetchMock.mock.calls[0][1] as RequestInit;
    expect(fetchMock.mock.calls[0][0]).toBe("/api/assets");
    expect((uploadRequest.body as FormData).get("file")).toBe(file);
    expect((uploadRequest.body as FormData).get("kind")).toBe("audio");
    expect((uploadRequest.body as FormData).get("visibility")).toBe("private");
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/memories", expect.objectContaining({
      body: JSON.stringify({
        planetId: "planet-mom",
        sourceText: "",
        assetIds: ["asset-voice-1"],
        visibility: "family",
        allowResonance: true,
        allowBook: true,
      }),
    }));
    expect(screen.queryByRole("button", { name: "新点亮：语音整理结果" })).not.toBeInTheDocument();
    expect(window.localStorage.getItem("jiashu-galaxy-lit-memories")).toBeNull();
  });

  it("limits the document picker to formats supported by intelligent document sorting", () => {
    render(<GalaxyWorkspace initialPlanets={persistedPlanets} initialLinks={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "进入妈妈漫游" }));
    fireEvent.click(screen.getByRole("button", { name: "点亮记忆" }));
    fireEvent.change(screen.getByLabelText("选择记忆来源"), { target: { value: "document" } });

    expect(screen.getByLabelText("上传文件")).toHaveAttribute("accept", ".pdf,.docx,.txt,.md");
  });

  it("keeps a selected document available for a safe upload retry before one real draft is created", async () => {
    const initialDraftKey = "11111111-1111-4111-8111-111111111111";
    const uploadKey = "22222222-2222-4222-8222-222222222222";
    const reopenedDraftKey = "33333333-3333-4333-8333-333333333333";
    const incorrectlyFreshUploadKey = "44444444-4444-4444-8444-444444444444";
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce(initialDraftKey)
      .mockReturnValueOnce(uploadKey)
      .mockReturnValueOnce(reopenedDraftKey)
      .mockReturnValueOnce(incorrectlyFreshUploadKey);
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("文件上传响应在提交后丢失"))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "asset-document-1", planetId: "planet-mom", kind: "document", visibility: "family",
        mimeType: "application/pdf", sizeBytes: 7, originalName: "mom-diary.pdf", status: "stored",
        createdAt: "2026-07-28T00:00:00.000Z",
      }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "memory-document-1", status: "draft", version: 1 }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-document-1", status: "failed", error: "模型暂不可用" }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<GalaxyWorkspace initialPlanets={persistedPlanets} initialLinks={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "进入妈妈漫游" }));
    fireEvent.click(screen.getByRole("button", { name: "点亮记忆" }));
    fireEvent.change(screen.getByLabelText("选择记忆来源"), { target: { value: "document" } });
    const file = new File(["diary"], "mom-diary.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("上传文件"), { target: { files: [file] } });

    fireEvent.click(screen.getByRole("button", { name: "发送给 AI 整理" }));
    await waitFor(() => expect(screen.getByText("文件上传响应在提交后丢失")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "关闭面板" }));
    fireEvent.click(screen.getByRole("button", { name: "进入妈妈漫游" }));
    fireEvent.click(screen.getByRole("button", { name: "点亮记忆" }));
    fireEvent.click(screen.getByRole("button", { name: "发送给 AI 整理" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const uploads = fetchMock.mock.calls.filter(([url]) => url === "/api/assets");
    expect(uploads).toHaveLength(2);
    expect(((uploads[1][1] as RequestInit).body as FormData).get("file")).toBe(file);
    const uploadKeys = uploads.map(([, request]) => (
      (request as RequestInit).headers as Record<string, string> | undefined
    )?.["Idempotency-Key"]);
    expect(uploadKeys).toEqual([uploadKey, uploadKey]);
    expect(uploadKeys[0]).toBe(uploadKeys[1]);
    const drafts = fetchMock.mock.calls.filter(([url]) => url === "/api/memories");
    expect(drafts).toHaveLength(1);
    expect(JSON.parse((fetchMock.mock.calls[2][1] as RequestInit).body as string)).toMatchObject({
      planetId: "planet-mom",
      sourceText: "",
      assetIds: ["asset-document-1"],
    });
  });

  it("aborts an in-flight asset upload when the recorder closes without creating a draft or AI job", async () => {
    let resolveUpload: (response: Response) => void = () => {};
    const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>((resolve) => {
      resolveUpload = resolve;
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<GalaxyWorkspace initialPlanets={persistedPlanets} initialLinks={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "进入妈妈漫游" }));
    fireEvent.click(screen.getByRole("button", { name: "点亮记忆" }));
    fireEvent.change(screen.getByLabelText("选择记忆来源"), { target: { value: "document" } });
    fireEvent.change(screen.getByLabelText("上传文件"), {
      target: { files: [new File(["diary"], "mom-diary.pdf", { type: "application/pdf" })] },
    });

    fireEvent.click(screen.getByRole("button", { name: "发送给 AI 整理" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const uploadRequest = fetchMock.mock.calls[0][1] as RequestInit;
    const signal = uploadRequest.signal as AbortSignal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "关闭面板" }));
    expect(signal.aborted).toBe(true);
    await act(async () => {
      resolveUpload(new Response(JSON.stringify({
        id: "asset-document-1", planetId: "planet-mom", kind: "document", visibility: "private",
        mimeType: "application/pdf", sizeBytes: 5, originalName: "mom-diary.pdf", status: "stored",
        createdAt: "2026-07-28T00:00:00.000Z",
      }), { status: 201 }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/memories")).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/ai-jobs"))).toHaveLength(0);
  });

  it("reuses the uploaded image asset and draft key when the draft response is transport-unknown", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "asset-image-1", planetId: "planet-mom", kind: "image", visibility: "family",
        mimeType: "image/jpeg", sizeBytes: 5, originalName: "spring.jpg", status: "stored",
        createdAt: "2026-07-28T00:00:00.000Z",
      }), { status: 201 }))
      .mockRejectedValueOnce(new TypeError("图片草稿响应在提交后丢失"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "memory-image-1", status: "draft", version: 1 }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-image-1", status: "failed", error: "模型暂不可用" }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<GalaxyWorkspace initialPlanets={persistedPlanets} initialLinks={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "进入妈妈漫游" }));
    fireEvent.click(screen.getByRole("button", { name: "点亮记忆" }));
    fireEvent.change(screen.getByLabelText("选择记忆来源"), { target: { value: "image" } });
    fireEvent.change(screen.getByLabelText("上传图片"), {
      target: { files: [new File(["image"], "spring.jpg", { type: "image/jpeg" })] },
    });

    fireEvent.click(screen.getByRole("button", { name: "发送给 AI 整理" }));
    await waitFor(() => expect(screen.getByText("图片草稿响应在提交后丢失")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "重试 AI 整理" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/assets")).toHaveLength(1);
    const drafts = fetchMock.mock.calls.filter(([url]) => url === "/api/memories");
    expect(drafts).toHaveLength(2);
    expect(JSON.parse((drafts[0][1] as RequestInit).body as string).assetIds).toEqual(["asset-image-1"]);
    expect(JSON.parse((drafts[1][1] as RequestInit).body as string).assetIds).toEqual(["asset-image-1"]);
    expect(((drafts[0][1] as RequestInit).headers as Record<string, string>)["Idempotency-Key"])
      .toBe(((drafts[1][1] as RequestInit).headers as Record<string, string>)["Idempotency-Key"]);
  });

  it("authorizes a newly confirmed allowBook memory for a same-session resonance book", async () => {
    const existingMemory = {
      id: "memory-2", planetId: "planet-self", title: "另一颗已授权记忆星", occurredAt: "2018 年除夕",
      location: "新房", people: ["我"], emotions: [], visibility: "family" as const, summary: "已有真实来源。",
    };
    const candidate = {
      id: "resonance-1", sourceMemoryId: "memory-1", targetMemoryId: "memory-2", score: 0.91,
      reason: "两条真实记忆指向同一次团圆。", version: 1, status: "candidate",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "memory-1", status: "draft", version: 1 }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-1", status: "queued" }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-1", status: "completed" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(review), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...review, status: "confirmed", version: 4 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [candidate] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...candidate, status: "confirmed", version: 2 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <GalaxyWorkspace
        initialPlanets={persistedPlanets}
        initialLinks={[]}
        initialConfirmedMemories={[existingMemory]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "进入妈妈漫游" }));
    fireEvent.click(screen.getByRole("button", { name: "点亮记忆" }));
    submitTextMemory();
    await waitFor(() => expect(screen.getByRole("button", { name: "确认点亮记忆星" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "确认点亮记忆星" }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/memories",
      expect.objectContaining({
        body: expect.stringContaining('"allowBook":true'),
      }),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "沿共鸣星轨前进" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "沿共鸣星轨前进" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "共鸣候选：除夕合照 ↔ 另一颗已授权记忆星" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "共鸣候选：除夕合照 ↔ 另一颗已授权记忆星" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "确认这条星轨" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "确认这条星轨" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "进入家书工坊" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "进入家书工坊" }));

    expect(screen.getByRole("button", { name: "生成这本家书" })).toBeInTheDocument();
    expect(screen.getByText("2 段已确认共鸣记忆")).toBeInTheDocument();
  });

  it("replays a transport-lost draft POST with the same idempotency key instead of creating a new logical draft", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("响应在提交后丢失"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "memory-1", status: "draft", version: 1 }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-1", status: "failed", error: "模型不可用" }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<GalaxyWorkspace initialPlanets={persistedPlanets} initialLinks={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "点亮记忆星" }));
    submitTextMemory();
    await waitFor(() => expect(screen.getByText("响应在提交后丢失")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "重试 AI 整理" }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === "/api/memories")).toHaveLength(2));

    const draftRequests = fetchMock.mock.calls.filter(([url]) => url === "/api/memories");
    const firstDraftKey = ((draftRequests[0][1] as RequestInit).headers as Record<string, string>)["Idempotency-Key"];
    const replayDraftKey = ((draftRequests[1][1] as RequestInit).headers as Record<string, string>)["Idempotency-Key"];
    expect(replayDraftKey).toBe(firstDraftKey);
  });

  it("replays a transport-lost AI job POST with the same idempotency key", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "memory-1", status: "draft", version: 1 }), { status: 201 }))
      .mockRejectedValueOnce(new TypeError("AI 作业响应在提交后丢失"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-1", status: "failed", error: "模型不可用" }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<GalaxyWorkspace initialPlanets={persistedPlanets} initialLinks={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "点亮记忆星" }));
    submitTextMemory();
    await waitFor(() => expect(screen.getByText("AI 作业响应在提交后丢失")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "重试 AI 整理" }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === "/api/memories/memory-1/ai-jobs")).toHaveLength(2));

    const jobRequests = fetchMock.mock.calls.filter(([url]) => url === "/api/memories/memory-1/ai-jobs");
    const firstJobKey = ((jobRequests[0][1] as RequestInit).headers as Record<string, string>)["Idempotency-Key"];
    const replayJobKey = ((jobRequests[1][1] as RequestInit).headers as Record<string, string>)["Idempotency-Key"];
    expect(replayJobKey).toBe(firstJobKey);
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
    submitTextMemory();
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
      ["/api/ai-jobs/job-1", expect.objectContaining({ method: "GET", signal: expect.any(AbortSignal) })],
      ["/api/ai-jobs/job-1", expect.objectContaining({ method: "GET", signal: expect.any(AbortSignal) })],
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
    submitTextMemory();
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
      ["/api/ai-jobs/job-1", expect.objectContaining({ method: "GET", signal: expect.any(AbortSignal) })],
      ["/api/ai-jobs/job-1", expect.objectContaining({ method: "GET", signal: expect.any(AbortSignal) })],
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
    submitTextMemory();
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

  it("replays the same job request when the job POST response is transport-unknown", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "memory-1", status: "draft", version: 1 }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "作业请求超时" }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-1", status: "failed", error: "模型不可用" }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<GalaxyWorkspace initialPlanets={persistedPlanets} initialLinks={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "点亮记忆星" }));
    submitTextMemory();
    await waitFor(() => expect(screen.getByText("作业请求超时")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "重试 AI 整理" }));

    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === "/api/memories/memory-1/ai-jobs")).toHaveLength(2));
  });

  it("cancels queued polling when the memory panel closes before the next polling interval", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "memory-1", status: "draft", version: 1 }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-1", status: "queued" }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<GalaxyWorkspace initialPlanets={persistedPlanets} initialLinks={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "点亮记忆星" }));
    submitTextMemory();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole("button", { name: "关闭面板" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/ai-jobs/job-1")).toHaveLength(0);
  });

  it("retains a queued draft after closing so the same reopened recorder continues without another draft POST", async () => {
    const { fetchMock } = await startQueuedMemoryPolling();
    fetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({ id: "job-1", status: "failed", error: "模型不可用" }),
      { status: 200 },
    ));

    fireEvent.click(screen.getByRole("button", { name: "关闭面板" }));
    fireEvent.click(screen.getByRole("button", { name: "点亮记忆星" }));

    const primaryAction = screen.getByRole("button", { name: "继续整理" });
    expect(primaryAction).toBeEnabled();
    expect(screen.queryByText(/AbortError/)).not.toBeInTheDocument();

    fireEvent.click(primaryAction);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/memories")).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/memories/memory-1/ai-jobs")).toHaveLength(1);
    expect(screen.getByText("模型不可用")).toBeInTheDocument();
  });

  it("cancels queued polling and closes quick record when mobile star-zone selection changes", async () => {
    const { fetchMock } = await startQueuedMemoryPolling();

    fireEvent.change(screen.getByLabelText("星域"), { target: { value: "memories" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(screen.getByTestId("galaxy-app")).toHaveClass("scene-roam");
    expect(screen.queryByRole("heading", { name: "点亮记忆星" })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/ai-jobs/job-1")).toHaveLength(0);
  });

  it("retains a queued draft after switching zones so the same reopened recorder continues without another draft POST", async () => {
    const { fetchMock } = await startQueuedMemoryPolling();
    fetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({ id: "job-1", status: "failed", error: "模型不可用" }),
      { status: 200 },
    ));

    fireEvent.change(screen.getByLabelText("星域"), { target: { value: "memories" } });
    expect(screen.queryByRole("button", { name: "点亮记忆星" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("星域"), { target: { value: "galaxy" } });
    fireEvent.click(screen.getByRole("button", { name: "点亮记忆星" }));

    const primaryAction = screen.getByRole("button", { name: "继续整理" });
    expect(primaryAction).toBeEnabled();
    expect(screen.queryByText(/AbortError/)).not.toBeInTheDocument();

    fireEvent.click(primaryAction);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/memories")).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/memories/memory-1/ai-jobs")).toHaveLength(1);
    expect(screen.getByText("模型不可用")).toBeInTheDocument();
  });

  it("cancels queued polling and closes quick record when focusPlanet changes the active zone", async () => {
    const { container, fetchMock } = await startQueuedMemoryPolling();
    const interactiveSpace = container.querySelector(".interactive-space");
    if (!interactiveSpace) throw new Error("interactive galaxy space is missing");

    fireEvent.doubleClick(interactiveSpace);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(screen.getByTestId("galaxy-app")).toHaveClass("scene-galaxy");
    expect(screen.queryByRole("heading", { name: "点亮记忆星" })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/ai-jobs/job-1")).toHaveLength(0);
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
    submitTextMemory();
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
    submitTextMemory();

    await waitFor(() => expect(screen.getByText("模型不可用")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "重试 AI 整理" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "新点亮：除夕合照" })).not.toBeInTheDocument();
  });

  it("continues the existing failed draft from the primary action without creating another draft", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "memory-1", status: "draft", version: 1 }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-1", status: "queued" }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-1", status: "failed", error: "模型不可用" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-2", status: "queued" }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<GalaxyWorkspace initialPlanets={persistedPlanets} initialLinks={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "点亮记忆星" }));
    submitTextMemory();
    await waitFor(() => expect(screen.getByText("模型不可用")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "重试整理" }));

    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === "/api/memories/memory-1/ai-jobs")).toHaveLength(2));
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/memories")).toHaveLength(1);
  });

  it("creates a new idempotent draft when the memory text changes", async () => {
    const changedContent = "2019 年夏天，妈妈在阳台种下了第一盆薄荷。";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "memory-1", status: "draft", version: 1 }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-1", status: "queued" }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-1", status: "failed", error: "模型不可用" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "memory-2", status: "draft", version: 1 }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-2", status: "queued" }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<GalaxyWorkspace initialPlanets={persistedPlanets} initialLinks={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "点亮记忆星" }));
    submitTextMemory();
    await waitFor(() => expect(screen.getByText("模型不可用")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("记忆内容"), { target: { value: changedContent } });
    fireEvent.click(screen.getByRole("button", { name: "点亮为记忆星" }));

    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === "/api/memories")).toHaveLength(2));
    const draftRequests = fetchMock.mock.calls.filter(([url]) => url === "/api/memories");
    const firstRequest = draftRequests[0][1] as RequestInit;
    const secondRequest = draftRequests[1][1] as RequestInit;
    const firstKey = (firstRequest.headers as Record<string, string>)["Idempotency-Key"];
    const secondKey = (secondRequest.headers as Record<string, string>)["Idempotency-Key"];

    expect(secondKey).not.toBe(firstKey);
    expect(JSON.parse(secondRequest.body as string)).toMatchObject({
      planetId: "planet-self",
      sourceText: changedContent,
    });
  });

  it("creates a new idempotent draft when a cancelled recorder reopens for another planet", async () => {
    const { fetchMock } = await startQueuedMemoryPolling();
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "memory-2", status: "draft", version: 1 }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-2", status: "queued" }), { status: 202 }));

    fireEvent.click(screen.getByRole("button", { name: "关闭面板" }));
    fireEvent.click(screen.getByRole("button", { name: "进入妈妈漫游" }));
    fireEvent.click(screen.getByRole("button", { name: "点亮记忆" }));

    expect(screen.getByText("目标星球：妈妈")).toBeInTheDocument();
    submitTextMemory();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const draftRequests = fetchMock.mock.calls.filter(([url]) => url === "/api/memories");
    expect(draftRequests).toHaveLength(2);
    const firstRequest = draftRequests[0][1] as RequestInit;
    const secondRequest = draftRequests[1][1] as RequestInit;
    const firstKey = (firstRequest.headers as Record<string, string>)["Idempotency-Key"];
    const secondKey = (secondRequest.headers as Record<string, string>)["Idempotency-Key"];

    expect(secondKey).not.toBe(firstKey);
    expect(JSON.parse(secondRequest.body as string)).toMatchObject({ planetId: "planet-mom" });
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
    submitTextMemory();

    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(screen.getByText("AI 整理仍在进行中，请稍后重试。")).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/ai-jobs/job-1")).toHaveLength(20);
  });
});
