import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { planets } from "@/shared/mock/galaxy-data";
import { GalaxyWorkspace } from "./galaxy-workspace";

const persistedResonancePlanets = [
  {
    id: "planet-self", name: "我的星球", type: "self" as const, role: "家庭管理员",
    visibility: "private" as const, theme: "暖夜", position: { x: 35, y: 50 },
    stats: { memoryStars: 1, resonanceTracks: 0, bookDrafts: 0 }, summary: "我的家庭记忆。",
  },
  {
    id: "planet-mom", name: "妈妈的星球", type: "parent" as const, role: "妈妈",
    visibility: "family" as const, theme: "暖橘", position: { x: 65, y: 50 },
    stats: { memoryStars: 1, resonanceTracks: 0, bookDrafts: 0 }, summary: "妈妈的家庭记忆。",
  },
];

const confirmedResonanceMemories = [
  {
    id: "memory-self-eve", planetId: "planet-self", title: "我的除夕", occurredAt: "2018 年除夕", location: "新家",
    people: ["妈妈", "我"], emotions: [], visibility: "private" as const, summary: "我记得妈妈端出最后一盘饺子。",
  },
  {
    id: "memory-mom-eve", planetId: "planet-mom", title: "妈妈的除夕", occurredAt: "2018 年除夕", location: "新家",
    people: ["妈妈", "我"], emotions: [], visibility: "family" as const, summary: "妈妈记得一家人围坐在桌前。",
  },
];

const pendingResonance = {
  id: "resonance-eve",
  sourceMemoryId: "memory-self-eve",
  targetMemoryId: "memory-mom-eve",
  score: 0.91,
  reason: "两段已确认记忆都指向新家的除夕团圆。",
  status: "candidate" as const,
  version: 3,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

function renderPersistedResonanceGalaxy(options: { pending?: boolean } = {}) {
  return render(
    <GalaxyWorkspace
      initialPlanets={persistedResonancePlanets}
      initialLinks={[]}
      initialConfirmedMemories={confirmedResonanceMemories}
      initialPendingResonances={options.pending === false ? [] : [pendingResonance]}
    />,
  );
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

  it("mounts confirmed server memories immediately without reading localStorage business content", () => {
    window.localStorage.setItem("jiashu-galaxy-lit-memories", JSON.stringify([{
      id: "memory-old", planetId: "planet-self", title: "旧本地星", occurredAt: "", location: "", people: [], emotions: [], visibility: "family", summary: "",
    }]));

    render(
      <GalaxyWorkspace
        initialPlanets={planets}
        initialLinks={[]}
        initialConfirmedMemories={[{
          id: "memory-confirmed", planetId: "planet-self", title: "服务端确认记忆", occurredAt: "2018", location: "家", people: ["我"], emotions: [], visibility: "private", summary: "已确认",
        }]}
      />,
    );

    expect(screen.getByRole("button", { name: "新点亮：服务端确认记忆" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "旧本地星" })).not.toBeInTheDocument();
  });

  it("shows the clicked confirmed server memory's own safe details without falling back to a mock memory", () => {
    render(
      <GalaxyWorkspace
        initialPlanets={planets}
        initialLinks={[]}
        initialConfirmedMemories={[{
          id: "memory-server-eve", planetId: "planet-self", title: "服务端确认的除夕", occurredAt: "2024 年除夕", location: "新家", people: ["妈妈", "我"], emotions: [], visibility: "family", summary: "一家人在新家吃年夜饭。",
        }]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "新点亮：服务端确认的除夕" }));

    expect(screen.getByRole("heading", { name: "服务端确认的除夕" })).toBeInTheDocument();
    expect(screen.getByText("一家人在新家吃年夜饭。")).toBeInTheDocument();
    expect(screen.getByText("时间：2024 年除夕。地点：新家。人物：妈妈、我。情绪：暂无。")).toBeInTheDocument();
    expect(screen.queryByText("那年第一次在新房里过年。妈妈忙了一整天，最后在客厅拍了一张合照。")).not.toBeInTheDocument();
  });

  it("scans a real confirmed memory through the persisted endpoint and only displays safe projected sources", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [pendingResonance] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    renderPersistedResonanceGalaxy({ pending: false });

    fireEvent.click(screen.getByRole("button", { name: "新点亮：我的除夕" }));
    fireEvent.click(screen.getByRole("button", { name: "沿共鸣星轨前进" }));

    await expect(screen.findByRole("button", { name: "共鸣候选：我的除夕 ↔ 妈妈的除夕" })).resolves.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/resonances/scan",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ memoryId: "memory-self-eve" }),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "共鸣候选：我的除夕 ↔ 妈妈的除夕" }));
    expect(screen.getByText("我记得妈妈端出最后一盘饺子。")).toBeInTheDocument();
    expect(screen.getByText("妈妈记得一家人围坐在桌前。")).toBeInTheDocument();
    expect(screen.queryByText("看着孩子们围坐在桌前，觉得一天的劳累都值了。")).not.toBeInTheDocument();
  });

  it("keeps the confirmed-memory panel open with a real error when resonance scanning fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "共鸣服务暂不可用" }), { status: 503 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderPersistedResonanceGalaxy({ pending: false });

    fireEvent.click(screen.getByRole("button", { name: "新点亮：我的除夕" }));
    fireEvent.click(screen.getByRole("button", { name: "沿共鸣星轨前进" }));

    await expect(screen.findByText("共鸣服务暂不可用")).resolves.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/resonances/scan", expect.anything());
    expect(screen.getByRole("complementary", { name: "星图详情" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /共鸣候选：/ })).not.toBeInTheDocument();
  });

  it("keeps the current confirmed-memory panel open when the real scan returns no candidates", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ candidates: [] }), { status: 200 }),
    ));
    renderPersistedResonanceGalaxy({ pending: false });

    fireEvent.click(screen.getByRole("button", { name: "新点亮：我的除夕" }));
    fireEvent.click(screen.getByRole("button", { name: "沿共鸣星轨前进" }));

    await expect(screen.findByText("暂未找到可确认的共鸣星轨。"))
      .resolves.toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "星图详情" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /共鸣候选：/ })).not.toBeInTheDocument();
  });

  it("ignores a stale resonance scan after the user changes zones", async () => {
    const pendingResponse = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValue(pendingResponse.promise);
    vi.stubGlobal("fetch", fetchMock);
    renderPersistedResonanceGalaxy({ pending: false });

    fireEvent.click(screen.getByRole("button", { name: "新点亮：我的除夕" }));
    fireEvent.click(screen.getByRole("button", { name: "沿共鸣星轨前进" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "隐私星域" }));
    const privacyPanel = screen.getByRole("complementary", { name: "星图详情" });
    expect(within(privacyPanel).getByRole("heading", { name: "隐私星域" })).toBeInTheDocument();

    await act(async () => {
      pendingResponse.resolve(new Response(JSON.stringify({ candidates: [pendingResonance] }), { status: 200 }));
      await pendingResponse.promise;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("button", { name: "隐私星域" })).toHaveClass("active");
    expect(within(screen.getByRole("complementary", { name: "星图详情" }))
      .getByRole("heading", { name: "隐私星域" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /共鸣候选：/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "共鸣星轨" }));
    expect(screen.queryByRole("button", { name: /共鸣候选：/ })).not.toBeInTheDocument();
  });

  it("aborts the current resonance scan when its confirmed-memory panel closes without showing an abort error", async () => {
    let scanSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      scanSignal = init?.signal ?? undefined;
      scanSignal?.addEventListener("abort", () => {
        reject(new DOMException("共鸣扫描已取消", "AbortError"));
      });
    }));
    vi.stubGlobal("fetch", fetchMock);
    renderPersistedResonanceGalaxy({ pending: false });

    fireEvent.click(screen.getByRole("button", { name: "新点亮：我的除夕" }));
    fireEvent.click(screen.getByRole("button", { name: "沿共鸣星轨前进" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "关闭面板" }));
    expect(scanSignal?.aborted).toBe(true);
    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole("button", { name: "新点亮：我的除夕" }));
    expect(screen.queryByText("共鸣扫描已取消")).not.toBeInTheDocument();
  });

  it("aborts the current resonance scan when the workspace unmounts", async () => {
    let scanSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>(() => {
      scanSignal = init?.signal ?? undefined;
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { unmount } = renderPersistedResonanceGalaxy({ pending: false });

    fireEvent.click(screen.getByRole("button", { name: "新点亮：我的除夕" }));
    fireEvent.click(screen.getByRole("button", { name: "沿共鸣星轨前进" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    unmount();

    expect(scanSignal?.aborted).toBe(true);
  });

  it("rehydrates a persisted pending candidate after refresh using only safe memory projections", () => {
    renderPersistedResonanceGalaxy();

    fireEvent.click(screen.getByRole("button", { name: "共鸣星轨" }));

    expect(screen.getByRole("button", { name: "共鸣候选：我的除夕 ↔ 妈妈的除夕" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "共鸣候选：我的除夕 ↔ 妈妈的除夕" }));
    expect(screen.getByRole("heading", { name: "共鸣候选" })).toBeInTheDocument();
    expect(screen.getByText("我的除夕")).toBeInTheDocument();
    expect(screen.getByText("妈妈的除夕")).toBeInTheDocument();
  });

  it("confirms a candidate through the versioned API before drawing the real resonance link", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...pendingResonance,
      status: "confirmed",
      confirmedAt: "2026-07-28T00:00:00.000Z",
      rejectedAt: null,
      version: 4,
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    renderPersistedResonanceGalaxy();

    fireEvent.click(screen.getByRole("button", { name: "共鸣星轨" }));
    fireEvent.click(screen.getByRole("button", { name: "共鸣候选：我的除夕 ↔ 妈妈的除夕" }));
    fireEvent.click(screen.getByRole("button", { name: "确认这条星轨" }));

    await expect(screen.findByText("已确认这条星轨，可进入家书工坊。"))
      .resolves.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/resonances/resonance-eve/confirm",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "If-Match-Version": "3" }),
        body: JSON.stringify({ status: "confirmed", version: 3 }),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "我的星系" }));
    expect(document.querySelector('[data-link-id="resonance-eve"]')).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "进入我的星球漫游" }));
    fireEvent.click(screen.getByRole("button", { name: "进入星球" }));
    expect(screen.getByLabelText("星球 我的星球 共鸣星轨 1 条")).toBeInTheDocument();
  });

  it("rejects a pending candidate through the versioned API without drawing a resonance link", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...pendingResonance,
      status: "rejected",
      confirmedAt: null,
      rejectedAt: "2026-07-28T00:00:00.000Z",
      version: 4,
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    renderPersistedResonanceGalaxy();

    fireEvent.click(screen.getByRole("button", { name: "共鸣星轨" }));
    fireEvent.click(screen.getByRole("button", { name: "共鸣候选：我的除夕 ↔ 妈妈的除夕" }));
    fireEvent.click(screen.getByRole("button", { name: "暂不确认 / 拒绝" }));

    await expect(screen.findByText("已拒绝这条共鸣候选。"))
      .resolves.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/resonances/resonance-eve/confirm",
      expect.objectContaining({
        body: JSON.stringify({ status: "rejected", version: 3 }),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "我的星系" }));
    expect(document.querySelector('[data-link-id="resonance-eve"]')).not.toBeInTheDocument();
  });
});
