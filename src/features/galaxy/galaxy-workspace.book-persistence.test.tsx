import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { planetLinks, planets } from "@/shared/mock/galaxy-data";

import { GalaxyWorkspace } from "./galaxy-workspace";

const savedBook = {
  id: "saved-book-1",
  title: "服务器已保存家书",
  status: "ready" as const,
  memoryCount: 2,
};

const savedBookDetail = {
  id: savedBook.id,
  title: savedBook.title,
  body: "这是从服务器读取的真实正文。",
  sections: [{ title: "团圆", body: "真实章节。", sourceMemoryIds: ["memory-a", "memory-b"] }],
  status: "ready" as const,
  version: 4,
  visibility: "family" as const,
};

const confirmedMemories = [
  {
    id: "memory-a", planetId: "mock-mom", title: "妈妈的真实除夕", occurredAt: "2018 年除夕",
    location: "新房", people: ["妈妈", "我"], emotions: [], visibility: "family" as const, summary: "真实来源一。",
  },
  {
    id: "memory-b", planetId: "mock-me", title: "我的真实除夕", occurredAt: "2018 年除夕",
    location: "新房", people: ["妈妈", "我"], emotions: [], visibility: "private" as const, summary: "真实来源二。",
  },
];

const confirmedResonance = {
  id: "resonance-1",
  sourceMemoryId: "memory-a",
  targetMemoryId: "memory-b",
  score: 0.91,
  reason: "两条真实记忆指向同一次团圆。",
  version: 1,
};

const generatedBook = {
  id: "generated-book-1",
  title: "真实生成的除夕家书",
  status: "ready" as const,
  draft: {
    id: "generated-book-1",
    title: "真实生成的除夕家书",
    sourceMemoryIds: ["memory-a", "memory-b"],
    sourceRange: "binary_system" as const,
    themeTemplateKey: "family_reunion",
    sourceLabels: { "memory-a": "妈妈的真实除夕", "memory-b": "我的真实除夕" },
  },
  body: "服务端 AI 生成的真实家书正文。",
  sections: [{ title: "团圆", body: "服务端生成的真实章节。", sourceMemoryIds: ["memory-a", "memory-b"] }],
};

function renderConfirmedGalaxy(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  render(
    <GalaxyWorkspace
      initialPlanets={planets}
      initialLinks={planetLinks}
      initialConfirmedMemories={confirmedMemories}
      initialPendingResonances={[confirmedResonance]}
      initialGrowingBooks={[]}
      initialEligibleBookSources={confirmedMemories.map(({ id, title }) => ({ id, title }))}
    />,
  );
}

async function enterConfirmedBookWorkshop() {
  fireEvent.click(screen.getByRole("button", { name: "共鸣星轨" }));
  fireEvent.click(screen.getByRole("button", { name: "共鸣候选：妈妈的真实除夕 ↔ 我的真实除夕" }));
  fireEvent.click(screen.getByRole("button", { name: "确认这条星轨" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "进入家书工坊" })).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "家书工坊" }));
}

async function openSavedBook() {
  fireEvent.click(screen.getByRole("button", { name: "家书工坊" }));
  fireEvent.click(screen.getByRole("button", { name: `打开已保存家书：${savedBook.title}` }));
  await waitFor(() => expect(screen.getByText(savedBookDetail.body)).toBeInTheDocument());
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("GalaxyWorkspace persisted book flow", () => {
  it("opens a refreshed server book summary through GET without requiring a session resonance", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === `/api/books/${savedBook.id}`) {
        return new Response(JSON.stringify(savedBookDetail), { status: 200 });
      }
      if (url === `/api/books/${savedBook.id}/shares`) {
        return new Response(JSON.stringify({ shares: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ message: `unexpected ${url}` }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);
    window.localStorage.setItem("jiashu-galaxy-book", JSON.stringify({
      title: "不应恢复的本地 Mock 家书",
      body: "本地 Mock 内容不应出现。",
    }));

    render(
      <GalaxyWorkspace
        initialPlanets={planets}
        initialLinks={planetLinks}
        initialGrowingBooks={[savedBook]}
        initialEligibleBookSources={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "家书工坊" }));
    fireEvent.click(screen.getByRole("button", { name: `打开已保存家书：${savedBook.title}` }));

    await waitFor(() => expect(screen.getByText(savedBookDetail.body)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(`/api/books/${savedBook.id}`, { method: "GET" });
    expect(screen.queryByText("不应恢复的本地 Mock 家书")).not.toBeInTheDocument();
  });

  it("generates from only the server-approved sources of a confirmed resonance and renders the real response", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === `/api/resonances/${confirmedResonance.id}/confirm`) {
        return new Response(JSON.stringify({ ...confirmedResonance, status: "confirmed" }), { status: 200 });
      }
      if (url === "/api/books" && init?.method === "POST") {
        return new Response(JSON.stringify(generatedBook), { status: 201 });
      }
      if (url === `/api/books/${generatedBook.id}`) {
        return new Response(JSON.stringify({ ...generatedBook, version: 1, visibility: "family" }), { status: 200 });
      }
      if (url === `/api/books/${generatedBook.id}/shares`) {
        return new Response(JSON.stringify({ shares: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ message: `unexpected ${url}` }), { status: 500 });
    });
    renderConfirmedGalaxy(fetchMock);

    await enterConfirmedBookWorkshop();
    fireEvent.click(screen.getByRole("button", { name: "生成这本家书" }));

    await waitFor(() => expect(screen.getByText(generatedBook.body)).toBeInTheDocument());
    expect(screen.getByText("妈妈的真实除夕")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/books", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        sourceMemoryIds: ["memory-a", "memory-b"],
        sourceRange: "binary_system",
        themeTemplateKey: "family_reunion",
        visibility: "family",
      }),
    }));
  });

  it("retries an interrupted AI generation with the same idempotency key and no mock result", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === `/api/resonances/${confirmedResonance.id}/confirm`) {
        return new Response(JSON.stringify({ ...confirmedResonance, status: "confirmed" }), { status: 200 });
      }
      if (url === "/api/books" && init?.method === "POST") {
        return new Response(JSON.stringify({ message: "AI 服务暂不可用" }), { status: 503 });
      }
      return new Response(JSON.stringify({ message: `unexpected ${url}` }), { status: 500 });
    });
    renderConfirmedGalaxy(fetchMock);

    await enterConfirmedBookWorkshop();
    fireEvent.click(screen.getByRole("button", { name: "生成这本家书" }));
    await waitFor(() => expect(screen.getByText("AI 服务暂不可用")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "生成这本家书" }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url, init]) => (
      url === "/api/books" && (init as RequestInit | undefined)?.method === "POST"
    ))).toHaveLength(2));

    const generationCalls = fetchMock.mock.calls.filter(([url, init]) => (
      url === "/api/books" && (init as RequestInit | undefined)?.method === "POST"
    ));
    const firstHeaders = (generationCalls[0]?.[1] as RequestInit).headers as Record<string, string>;
    const secondHeaders = (generationCalls[1]?.[1] as RequestInit).headers as Record<string, string>;
    expect(secondHeaders["Idempotency-Key"]).toBe(firstHeaders["Idempotency-Key"]);
    expect(screen.queryByText(generatedBook.body)).not.toBeInTheDocument();
  });

  it("keeps the user's edit when the server reports a version conflict", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === `/api/books/${savedBook.id}` && init?.method === "GET") {
        return new Response(JSON.stringify(savedBookDetail), { status: 200 });
      }
      if (url === `/api/books/${savedBook.id}/shares`) {
        return new Response(JSON.stringify({ shares: [] }), { status: 200 });
      }
      if (url === `/api/books/${savedBook.id}` && init?.method === "PATCH") {
        return new Response(JSON.stringify({ message: "服务器已有更新" }), { status: 409 });
      }
      return new Response(JSON.stringify({ message: `unexpected ${url}` }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <GalaxyWorkspace
        initialPlanets={planets}
        initialLinks={planetLinks}
        initialGrowingBooks={[savedBook]}
        initialEligibleBookSources={[]}
      />,
    );

    await openSavedBook();
    fireEvent.change(screen.getByLabelText("家书标题"), { target: { value: "我仍想保存的标题" } });
    fireEvent.click(screen.getByRole("button", { name: "保存家书修改" }));

    await waitFor(() => expect(screen.getByText(/刷新后重试/)).toBeInTheDocument());
    expect(screen.getByLabelText("家书标题")).toHaveValue("我仍想保存的标题");
    expect(fetchMock).toHaveBeenCalledWith(`/api/books/${savedBook.id}`, expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ version: 4, title: "我仍想保存的标题", body: savedBookDetail.body }),
    }));
  });

  it("lists, creates, revokes, and recreates shares only for the active real book", async () => {
    let createdShareCount = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === `/api/books/${savedBook.id}` && init?.method === "GET") {
        return new Response(JSON.stringify(savedBookDetail), { status: 200 });
      }
      if (url === `/api/books/${savedBook.id}/shares` && init?.method === "GET") {
        return new Response(JSON.stringify({ shares: [{ token: "active-share", url: "/share/active-share", createdAt: "2026-07-28T00:00:00.000Z" }] }), { status: 200 });
      }
      if (url === `/api/books/${savedBook.id}/shares` && init?.method === "POST") {
        createdShareCount += 1;
        const token = createdShareCount === 1 ? "new-share" : "renewed-share";
        return new Response(JSON.stringify({ token, url: `/share/${token}` }), { status: 201 });
      }
      if (url === `/api/books/${savedBook.id}/shares/active-share/revoke` && init?.method === "POST") {
        return new Response(JSON.stringify({ token: "active-share", revoked: true }), { status: 200 });
      }
      if (url === `/api/books/${savedBook.id}/shares/new-share/revoke` && init?.method === "POST") {
        return new Response(JSON.stringify({ token: "new-share", revoked: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ message: `unexpected ${url}` }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <GalaxyWorkspace
        initialPlanets={planets}
        initialLinks={planetLinks}
        initialGrowingBooks={[savedBook]}
        initialEligibleBookSources={[]}
      />,
    );

    await openSavedBook();
    expect(screen.getByLabelText("分享原始文本")).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "创建分享链接" }));
    await waitFor(() => expect(screen.getByText("/share/new-share")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "撤回分享：active-share" }));

    await waitFor(() => expect(screen.queryByText("/share/active-share")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "撤回分享：new-share" }));
    await waitFor(() => expect(screen.queryByText("/share/new-share")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "创建分享链接" }));
    await waitFor(() => expect(screen.getByText("/share/renewed-share")).toBeInTheDocument());

    const shareCreates = fetchMock.mock.calls.filter(([url, init]) => (
      url === `/api/books/${savedBook.id}/shares` && (init as RequestInit | undefined)?.method === "POST"
    ));
    const firstShareKey = ((shareCreates[0]?.[1] as RequestInit).headers as Record<string, string>)["Idempotency-Key"];
    const secondShareKey = ((shareCreates[1]?.[1] as RequestInit).headers as Record<string, string>)["Idempotency-Key"];
    expect(secondShareKey).not.toBe(firstShareKey);
    expect(fetchMock).toHaveBeenCalledWith(`/api/books/${savedBook.id}/shares`, expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ showBody: true, showSourceTitles: true, showOriginalText: false }),
    }));
    expect(fetchMock).toHaveBeenCalledWith(`/api/books/${savedBook.id}/shares/active-share/revoke`, expect.objectContaining({ method: "POST" }));
  });
});
