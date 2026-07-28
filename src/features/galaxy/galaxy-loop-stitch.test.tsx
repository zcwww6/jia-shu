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

  it("没有持久化星球时显示真实空星系而不是示例家庭", () => {
    render(<GalaxyWorkspace initialPlanets={[]} initialLinks={[]} />);

    expect(screen.getByText("先创建第一颗家人星球")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "进入妈妈的星球漫游" })).not.toBeInTheDocument();
    expect(screen.queryByText("新家里的第一个除夕")).not.toBeInTheDocument();
  });

  it("空账户的推荐航线从创建真实家人星球开始", () => {
    render(<GalaxyWorkspace initialPlanets={[]} initialLinks={[]} />);

    expect(screen.getByText("创建第一颗家人星球")).toBeInTheDocument();
    expect(screen.queryByText("靠近妈妈的星球")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "开始创建" }));

    expect(screen.getByRole("dialog", { name: "星图编辑" })).toBeInTheDocument();
  });

  it("在纪念与记忆章节只投影当前账户已保存的内容", () => {
    render(
      <GalaxyWorkspace
        initialPlanets={[{
          id: "planet-mom-only", name: "妈妈星球", type: "parent", role: "妈妈",
          visibility: "family", theme: "暖橘", position: { x: 56, y: 48 },
          stats: { memoryStars: 0, resonanceTracks: 0, bookDrafts: 0 }, summary: "真实的家庭星球。",
        }]}
        initialLinks={[]}
        initialConfirmedMemories={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "纪念星域" }));
    expect(screen.getByText("当前还没有纪念星")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "外婆的纪念星" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "记忆星群" }));
    expect(screen.getByText("当前还没有已确认的记忆星")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "新家里的第一个除夕" })).not.toBeInTheDocument();
  });

  it("从全局记录入口会选择第一个已保存星球而不是填入演示文案", () => {
    render(
      <GalaxyWorkspace
        initialPlanets={[{
          id: "planet-mom-only", name: "妈妈星球", type: "parent", role: "妈妈",
          visibility: "family", theme: "暖橘", position: { x: 56, y: 48 },
          stats: { memoryStars: 0, resonanceTracks: 0, bookDrafts: 0 }, summary: "真实的家庭星球。",
        }]}
        initialLinks={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "点亮记忆星" }));

    expect(screen.getByLabelText("当前记忆目标")).toHaveTextContent("目标星球：妈妈星球");
    expect(screen.getByLabelText("记忆内容")).toHaveValue("");
  });

  it("生命周期只展示这颗星球已确认的真实记忆", () => {
    render(
      <GalaxyWorkspace
        initialPlanets={[{
          id: "planet-mom-only", name: "妈妈星球", type: "parent", role: "妈妈",
          visibility: "family", theme: "暖橘", position: { x: 56, y: 48 },
          stats: { memoryStars: 0, resonanceTracks: 0, bookDrafts: 0 }, summary: "真实的家庭星球。",
        }]}
        initialLinks={[]}
        initialConfirmedMemories={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "进入妈妈星球漫游" }));
    fireEvent.click(screen.getByRole("button", { name: "生命周期" }));

    expect(screen.getByText("当前还没有已确认的阶段记忆")).toBeInTheDocument();
    expect(screen.queryByText("退休旅行")).not.toBeInTheDocument();
  });

  it("在星球漫游中只从已确认的服务端记忆打开故事场景", () => {
    render(
      <GalaxyWorkspace
        initialPlanets={[{
          id: "planet-mom-real", name: "妈妈星球", type: "parent", role: "妈妈",
          visibility: "family", theme: "暖橘", position: { x: 56, y: 48 },
          stats: { memoryStars: 1, resonanceTracks: 0, bookDrafts: 0 }, summary: "真实的家庭记忆。",
        }]}
        initialLinks={[]}
        initialConfirmedMemories={[{
          id: "memory-travel-real", planetId: "planet-mom-real", title: "旅行归来", occurredAt: "2024",
          location: "昆明", people: ["妈妈"], emotions: [], visibility: "family", summary: "妈妈讲述了旅行归来后的团圆晚饭。",
        }]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "进入妈妈星球漫游" }));
    fireEvent.click(screen.getByRole("button", { name: "进入星球" }));
    fireEvent.click(screen.getByRole("button", { name: "打开故事场景：2024 旅行归来" }));

    const storyDialog = screen.getByRole("dialog", { name: "旅行归来故事场景" });
    expect(storyDialog).toBeInTheDocument();
    expect(within(storyDialog).getByText("妈妈讲述了旅行归来后的团圆晚饭。")).toBeInTheDocument();
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

  it("ignores a stale resonance scan when another confirmed memory reopens the same panel", async () => {
    const pendingResponse = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValue(pendingResponse.promise);
    vi.stubGlobal("fetch", fetchMock);
    renderPersistedResonanceGalaxy({ pending: false });

    fireEvent.click(screen.getByRole("button", { name: "新点亮：我的除夕" }));
    fireEvent.click(screen.getByRole("button", { name: "沿共鸣星轨前进" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "新点亮：妈妈的除夕" }));
    expect(screen.getByRole("heading", { name: "妈妈的除夕" })).toBeInTheDocument();

    await act(async () => {
      pendingResponse.resolve(new Response(JSON.stringify({ candidates: [pendingResonance] }), { status: 200 }));
      await pendingResponse.promise;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("heading", { name: "妈妈的除夕" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "星图详情" })).toBeInTheDocument();

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
