import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { planetLinks, planets } from "@/shared/mock/galaxy-data";

import { GalaxyWorkspace } from "./galaxy-workspace";

const lockMessage = "请先确认一条共鸣星轨，再进入家书工坊。";

function renderUnconfirmedGalaxy() {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  window.localStorage.setItem("jiashu-galaxy-book", JSON.stringify({
    draft: {
      id: "cached-book",
      title: "本地缓存的 Mock 家书",
      intro: "不应在本会话展示。",
      sourceMemoryIds: ["cached-memory"],
      sourceRange: "binary_system",
      themeTemplateKey: "family_reunion",
      chapters: [],
    },
    body: "不应展示的本地 Mock 内容。",
    sections: [],
  }));
  render(
    <GalaxyWorkspace
      initialPlanets={planets}
      initialLinks={planetLinks}
      initialPendingResonances={[
        {
          id: "pending-resonance",
          sourceMemoryId: "memory-2018-mom",
          targetMemoryId: "memory-2018-me",
          score: 0.91,
          reason: "服务器待确认候选不能直接解锁家书。",
          version: 1,
        },
      ]}
    />,
  );
  return fetchMock;
}

function expectLockedWithoutBookContent(fetchMock: ReturnType<typeof vi.fn>) {
  expect(screen.getByText(lockMessage)).toBeInTheDocument();
  expect(screen.getByTestId("galaxy-app")).not.toHaveClass("scene-bookmaker");
  expect(screen.queryByRole("dialog", { name: "家书光束" })).not.toBeInTheDocument();
  expect(screen.queryByText("本地缓存的 Mock 家书")).not.toBeInTheDocument();
  expect(screen.queryByText("我们家的第一个新房除夕")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "生成家书草稿" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "分享前确认" })).not.toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("GalaxyWorkspace book entry guard", () => {
  it("locks the sidebar workshop entry when a server-pending resonance has not been confirmed this session", () => {
    const fetchMock = renderUnconfirmedGalaxy();

    fireEvent.click(screen.getByRole("button", { name: "家书工坊" }));

    expectLockedWithoutBookContent(fetchMock);
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });

  it("locks the recommended route book entry before confirmation", () => {
    const fetchMock = renderUnconfirmedGalaxy();

    fireEvent.click(screen.getByRole("button", { name: /写成一页家书/ }));

    expectLockedWithoutBookContent(fetchMock);
  });

  it("locks the selected planet action ring before confirmation", () => {
    const fetchMock = renderUnconfirmedGalaxy();

    fireEvent.click(screen.getByRole("button", { name: "进入妈妈的星球漫游" }));
    fireEvent.click(screen.getByRole("button", { name: "进入家书工坊" }));

    expectLockedWithoutBookContent(fetchMock);
  });

  it("locks the planet roaming book entry before confirmation", () => {
    const fetchMock = renderUnconfirmedGalaxy();

    fireEvent.click(screen.getByRole("button", { name: "开始靠近" }));
    fireEvent.click(screen.getByRole("button", { name: "星球漫游写成家书" }));

    expect(screen.getByRole("dialog", { name: "妈妈的星球漫游" })).toBeInTheDocument();
    expectLockedWithoutBookContent(fetchMock);
  });

  it("opens the real-source generation UI only after a versioned confirmation succeeds", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/resonances/resonance-1/confirm" && init?.method === "POST") {
        return new Response(JSON.stringify({
          id: "resonance-1",
          sourceMemoryId: "memory-1",
          targetMemoryId: "memory-2",
          score: 0.91,
          reason: "两条真实记忆指向同一次团圆。",
          version: 2,
          status: "confirmed",
        }), { status: 200 });
      }
      if (url === "/api/resonances/scan" && init?.method === "POST") {
        return new Response(JSON.stringify({
          candidates: [
            {
              id: "resonance-2",
              sourceMemoryId: "memory-1",
              targetMemoryId: "memory-2",
              score: 0.92,
              reason: "另一条待处理候选不应抹去本会话已确认的星轨。",
              version: 1,
              status: "candidate",
            },
          ],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ message: `unexpected request ${url}` }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <GalaxyWorkspace
        initialPlanets={planets}
        initialLinks={planetLinks}
        initialConfirmedMemories={[
          {
            id: "memory-1", planetId: "mock-mom", title: "妈妈的真实除夕", occurredAt: "2018 年除夕",
            location: "新房", people: ["妈妈", "我"], emotions: [], visibility: "family", summary: "真实来源一。", allowBook: true,
          },
          {
            id: "memory-2", planetId: "mock-me", title: "我的真实除夕", occurredAt: "2018 年除夕",
            location: "新房", people: ["妈妈", "我"], emotions: [], visibility: "private", summary: "真实来源二。", allowBook: true,
          },
        ]}
        initialPendingResonances={[
          {
            id: "resonance-1", sourceMemoryId: "memory-1", targetMemoryId: "memory-2", score: 0.91,
            reason: "两条真实记忆指向同一次团圆。", version: 1,
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "共鸣星轨" }));
    fireEvent.click(screen.getByRole("button", { name: "共鸣候选：妈妈的真实除夕 ↔ 我的真实除夕" }));
    fireEvent.click(screen.getByRole("button", { name: "确认这条星轨" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "进入家书工坊" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "记忆星群" }));
    fireEvent.click(screen.getByRole("button", { name: "妈妈的真实除夕" }));
    fireEvent.click(screen.getByRole("button", { name: "沿共鸣星轨前进" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "共鸣候选：妈妈的真实除夕 ↔ 我的真实除夕" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "家书工坊" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/resonances/resonance-1/confirm",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "If-Match-Version": "1" }),
        body: JSON.stringify({ status: "confirmed", version: 1 }),
      }),
    );
    expect(screen.getByTestId("galaxy-app")).toHaveClass("scene-bookmaker");
    expect(screen.getByText("家书工坊 · 家庭书架")).toBeInTheDocument();
    expect(screen.queryByText("我们家的第一个新房除夕")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "生成这本家书" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "分享前确认" })).not.toBeInTheDocument();
  });
});
