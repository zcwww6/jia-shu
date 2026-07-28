import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { planetLinks, planets } from "@/shared/mock/galaxy-data";

import { GalaxyWorkspace } from "./galaxy-workspace";

const savedBook = {
  id: "saved-book-1",
  title: "服务器已保存家书",
  status: "ready" as const,
  memoryCount: 2,
};

const secondSavedBook = {
  id: "saved-book-2",
  title: "另一封服务器家书",
  status: "ready" as const,
  memoryCount: 1,
};

const savedBookDetail = {
  id: savedBook.id,
  title: savedBook.title,
  body: "这是从服务器读取的真实正文。",
  sections: [{ title: "团圆", body: "真实章节。", sourceMemoryIds: ["memory-a", "memory-b"] }],
  sourceLabels: { "memory-a": "妈妈的真实除夕", "memory-b": "我的真实除夕" },
  status: "ready" as const,
  version: 4,
  visibility: "family" as const,
};

const secondSavedBookDetail = {
  id: secondSavedBook.id,
  title: secondSavedBook.title,
  body: "这是第二封服务器家书正文。",
  sections: [{ title: "另一段团圆", body: "第二封真实章节。", sourceMemoryIds: ["memory-b"] }],
  sourceLabels: { "memory-b": "我的真实除夕" },
  status: "ready" as const,
  version: 3,
  visibility: "family" as const,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

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
    window.localStorage.setItem("jiashu-demo-book", JSON.stringify({
      title: "不应恢复的已退役家书",
      body: "已退役缓存内容不应出现。",
    }));
    window.localStorage.setItem("jiashu-demo-share", JSON.stringify({
      showBody: false,
      showSourceTitles: false,
      showOriginalText: true,
    }));

    render(
      <GalaxyWorkspace
        initialPlanets={planets}
        initialLinks={planetLinks}
        initialGrowingBooks={[savedBook]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "家书工坊" }));
    fireEvent.click(screen.getByRole("button", { name: `打开已保存家书：${savedBook.title}` }));

    await waitFor(() => expect(screen.getByText(savedBookDetail.body)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(`/api/books/${savedBook.id}`, { method: "GET" });
    expect(screen.getByText("妈妈的真实除夕")).toBeInTheDocument();
    expect(screen.queryByText("不应恢复的本地 Mock 家书")).not.toBeInTheDocument();
    expect(screen.queryByText("不应恢复的已退役家书")).not.toBeInTheDocument();
  });

  it("keeps B open when A detail resolves after the user has selected B", async () => {
    const aDetail = deferred<Response>();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === `/api/books/${savedBook.id}` && init?.method === "GET") return aDetail.promise;
      if (url === `/api/books/${secondSavedBook.id}` && init?.method === "GET") {
        return Promise.resolve(new Response(JSON.stringify(secondSavedBookDetail), { status: 200 }));
      }
      if (url === `/api/books/${secondSavedBook.id}/shares`) {
        return Promise.resolve(new Response(JSON.stringify({ shares: [{ token: "b-share", url: "/share/b-share" }] }), { status: 200 }));
      }
      if (url === `/api/books/${savedBook.id}/shares`) {
        return Promise.resolve(new Response(JSON.stringify({ shares: [{ token: "a-share", url: "/share/a-share" }] }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ message: `unexpected ${url}` }), { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<GalaxyWorkspace initialPlanets={planets} initialLinks={planetLinks} initialGrowingBooks={[savedBook, secondSavedBook]} />);

    fireEvent.click(screen.getByRole("button", { name: "家书工坊" }));
    fireEvent.click(screen.getByRole("button", { name: `打开已保存家书：${savedBook.title}` }));
    fireEvent.click(screen.getByRole("button", { name: `打开已保存家书：${secondSavedBook.title}` }));
    await waitFor(() => expect(screen.getByText(secondSavedBookDetail.body)).toBeInTheDocument());

    await act(async () => {
      aDetail.resolve(new Response(JSON.stringify(savedBookDetail), { status: 200 }));
      await Promise.resolve();
    });

    expect(screen.getByLabelText("家书标题")).toHaveValue(secondSavedBook.title);
    expect(screen.getByLabelText("家书正文")).toHaveValue(secondSavedBookDetail.body);
    expect(screen.getByText("/share/b-share")).toBeInTheDocument();
    expect(screen.queryByText("/share/a-share")).not.toBeInTheDocument();
  });

  it("keeps B shares when A share listing resolves after B is selected", async () => {
    const aShares = deferred<Response>();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === `/api/books/${savedBook.id}` && init?.method === "GET") {
        return Promise.resolve(new Response(JSON.stringify(savedBookDetail), { status: 200 }));
      }
      if (url === `/api/books/${savedBook.id}/shares`) return aShares.promise;
      if (url === `/api/books/${secondSavedBook.id}` && init?.method === "GET") {
        return Promise.resolve(new Response(JSON.stringify(secondSavedBookDetail), { status: 200 }));
      }
      if (url === `/api/books/${secondSavedBook.id}/shares`) {
        return Promise.resolve(new Response(JSON.stringify({ shares: [{ token: "b-share", url: "/share/b-share" }] }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ message: `unexpected ${url}` }), { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<GalaxyWorkspace initialPlanets={planets} initialLinks={planetLinks} initialGrowingBooks={[savedBook, secondSavedBook]} />);

    fireEvent.click(screen.getByRole("button", { name: "家书工坊" }));
    fireEvent.click(screen.getByRole("button", { name: `打开已保存家书：${savedBook.title}` }));
    await waitFor(() => expect(screen.getByText(savedBookDetail.body)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: `打开已保存家书：${secondSavedBook.title}` }));
    await waitFor(() => expect(screen.getByText(secondSavedBookDetail.body)).toBeInTheDocument());

    await act(async () => {
      aShares.resolve(new Response(JSON.stringify({ shares: [{ token: "a-share", url: "/share/a-share" }] }), { status: 200 }));
      await Promise.resolve();
    });

    expect(screen.getByText("/share/b-share")).toBeInTheDocument();
    expect(screen.queryByText("/share/a-share")).not.toBeInTheDocument();
  });

  it("does not apply late A save, create-share, or revoke-share responses to B", async () => {
    const aSave = deferred<Response>();
    const aShareCreate = deferred<Response>();
    const aShareRevoke = deferred<Response>();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === `/api/books/${savedBook.id}` && init?.method === "GET") {
        return Promise.resolve(new Response(JSON.stringify(savedBookDetail), { status: 200 }));
      }
      if (url === `/api/books/${savedBook.id}` && init?.method === "PATCH") return aSave.promise;
      if (url === `/api/books/${savedBook.id}/shares` && init?.method === "GET") {
        return Promise.resolve(new Response(JSON.stringify({ shares: [{ token: "a-share", url: "/share/a-share" }] }), { status: 200 }));
      }
      if (url === `/api/books/${savedBook.id}/shares` && init?.method === "POST") return aShareCreate.promise;
      if (url === `/api/books/${savedBook.id}/shares/a-share/revoke`) return aShareRevoke.promise;
      if (url === `/api/books/${secondSavedBook.id}` && init?.method === "GET") {
        return Promise.resolve(new Response(JSON.stringify(secondSavedBookDetail), { status: 200 }));
      }
      if (url === `/api/books/${secondSavedBook.id}/shares`) {
        return Promise.resolve(new Response(JSON.stringify({ shares: [{ token: "b-share", url: "/share/b-share" }] }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ message: `unexpected ${url}` }), { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<GalaxyWorkspace initialPlanets={planets} initialLinks={planetLinks} initialGrowingBooks={[savedBook, secondSavedBook]} />);

    fireEvent.click(screen.getByRole("button", { name: "家书工坊" }));
    fireEvent.click(screen.getByRole("button", { name: `打开已保存家书：${savedBook.title}` }));
    await waitFor(() => expect(screen.getByText(savedBookDetail.body)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("家书标题"), { target: { value: "A 的迟到保存" } });
    fireEvent.click(screen.getByRole("button", { name: "保存家书修改" }));
    fireEvent.click(screen.getByRole("button", { name: "创建分享链接" }));
    fireEvent.click(screen.getByRole("button", { name: `打开已保存家书：${secondSavedBook.title}` }));
    await waitFor(() => expect(screen.getByText(secondSavedBookDetail.body)).toBeInTheDocument());

    await act(async () => {
      aSave.resolve(new Response(JSON.stringify({ id: savedBook.id, title: "A 的迟到保存", body: "A 的迟到正文", version: 5 }), { status: 200 }));
      aShareCreate.resolve(new Response(JSON.stringify({ token: "a-new-share", url: "/share/a-new-share" }), { status: 201 }));
      await Promise.resolve();
    });

    expect(screen.getByLabelText("家书标题")).toHaveValue(secondSavedBook.title);
    expect(screen.getByLabelText("家书正文")).toHaveValue(secondSavedBookDetail.body);
    expect(screen.getByText("/share/b-share")).toBeInTheDocument();
    expect(screen.queryByText("/share/a-new-share")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: `打开已保存家书：${savedBook.title}` }));
    await waitFor(() => expect(screen.getByText(savedBookDetail.body)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "撤回分享：a-share" }));
    fireEvent.click(screen.getByRole("button", { name: `打开已保存家书：${secondSavedBook.title}` }));
    await waitFor(() => expect(screen.getByText(secondSavedBookDetail.body)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "创建分享链接" })).toBeEnabled();

    await act(async () => {
      aShareRevoke.resolve(new Response(JSON.stringify({ token: "a-share", revoked: true }), { status: 200 }));
      await Promise.resolve();
    });

    expect(screen.getByText("/share/b-share")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建分享链接" })).toBeEnabled();
  });

  it("posts every session-confirmed resonance source and lets the server enforce authorization", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === `/api/resonances/${confirmedResonance.id}/confirm`) {
        return new Response(JSON.stringify({ ...confirmedResonance, status: "confirmed" }), { status: 200 });
      }
      if (url === "/api/books" && init?.method === "POST") {
        return new Response(JSON.stringify({ message: "来源授权已失效" }), { status: 422 });
      }
      return new Response(JSON.stringify({ message: `unexpected ${url}` }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <GalaxyWorkspace
        initialPlanets={planets}
        initialLinks={planetLinks}
        initialConfirmedMemories={confirmedMemories}
        initialPendingResonances={[confirmedResonance]}
        initialGrowingBooks={[]}
      />,
    );

    await enterConfirmedBookWorkshop();
    expect(screen.getByRole("button", { name: "生成这本家书" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "生成这本家书" }));

    await waitFor(() => expect(screen.getByText("来源授权已失效")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/books", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        sourceMemoryIds: ["memory-a", "memory-b"],
        sourceRange: "binary_system",
        themeTemplateKey: "family_reunion",
        visibility: "family",
      }),
    }));
    expect(screen.queryByText(generatedBook.body)).not.toBeInTheDocument();
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

  it("reuses the generation idempotency key after a processing response and eventually renders the server book", async () => {
    let generationAttempts = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === `/api/resonances/${confirmedResonance.id}/confirm`) {
        return new Response(JSON.stringify({ ...confirmedResonance, status: "confirmed" }), { status: 200 });
      }
      if (url === "/api/books" && init?.method === "POST") {
        generationAttempts += 1;
        if (generationAttempts === 1) {
          return new Response(JSON.stringify({
            code: "IDEMPOTENCY_PROCESSING",
            message: "请求仍在处理中，请稍后重试。",
          }), { status: 202 });
        }
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
    await waitFor(() => expect(screen.getByText("请求仍在处理中，请稍后重试。")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "生成这本家书" }));

    await waitFor(() => expect(screen.getByText(generatedBook.body)).toBeInTheDocument());
    const generationCalls = fetchMock.mock.calls.filter(([url, init]) => (
      url === "/api/books" && (init as RequestInit | undefined)?.method === "POST"
    ));
    const firstHeaders = (generationCalls[0]?.[1] as RequestInit).headers as Record<string, string>;
    const secondHeaders = (generationCalls[1]?.[1] as RequestInit).headers as Record<string, string>;
    expect(secondHeaders["Idempotency-Key"]).toBe(firstHeaders["Idempotency-Key"]);
  });

  it("rotates expired generation, share, and revoke idempotency keys before their retries", async () => {
    let generationAttempts = 0;
    let createAttempts = 0;
    let revokeAttempts = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === `/api/resonances/${confirmedResonance.id}/confirm`) {
        return new Response(JSON.stringify({ ...confirmedResonance, status: "confirmed" }), { status: 200 });
      }
      if (url === "/api/books" && init?.method === "POST") {
        generationAttempts += 1;
        if (generationAttempts === 1) {
          return new Response(JSON.stringify({
            code: "IDEMPOTENCY_EXPIRED",
            message: "生成请求已过期",
          }), { status: 409 });
        }
        return new Response(JSON.stringify(generatedBook), { status: 201 });
      }
      if (url === `/api/books/${generatedBook.id}` && init?.method === "GET") {
        return new Response(JSON.stringify({ ...generatedBook, version: 1, visibility: "family" }), { status: 200 });
      }
      if (url === `/api/books/${generatedBook.id}/shares` && init?.method === "GET") {
        return new Response(JSON.stringify({
          shares: [{ token: "existing-share", url: "/share/existing-share" }],
        }), { status: 200 });
      }
      if (url === `/api/books/${generatedBook.id}/shares` && init?.method === "POST") {
        createAttempts += 1;
        if (createAttempts === 1) {
          return new Response(JSON.stringify({
            code: "IDEMPOTENCY_EXPIRED",
            message: "创建分享请求已过期",
          }), { status: 409 });
        }
        return new Response(JSON.stringify({ token: "new-share", url: "/share/new-share" }), { status: 201 });
      }
      if (url === `/api/books/${generatedBook.id}/shares/existing-share/revoke` && init?.method === "POST") {
        revokeAttempts += 1;
        if (revokeAttempts === 1) {
          return new Response(JSON.stringify({
            code: "IDEMPOTENCY_EXPIRED",
            message: "撤回分享请求已过期",
          }), { status: 409 });
        }
        return new Response(JSON.stringify({ token: "existing-share", revoked: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ message: `unexpected ${url}` }), { status: 500 });
    });
    renderConfirmedGalaxy(fetchMock);

    await enterConfirmedBookWorkshop();
    fireEvent.click(screen.getByRole("button", { name: "生成这本家书" }));
    await waitFor(() => expect(screen.getByText("生成请求已过期，请刷新后重试。")).toBeInTheDocument());
    expect(screen.queryByText(generatedBook.body)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "生成这本家书" }));
    await waitFor(() => expect(screen.getByText(generatedBook.body)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "创建分享链接" }));
    await waitFor(() => expect(screen.getByText("创建分享请求已过期，请刷新后重试。")).toBeInTheDocument());
    expect(screen.queryByText("/share/new-share")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "创建分享链接" }));
    await waitFor(() => expect(screen.getByText("/share/new-share")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "撤回分享：existing-share" }));
    await waitFor(() => expect(screen.getByText("撤回分享请求已过期，请刷新后重试。")).toBeInTheDocument());
    expect(screen.getByText("/share/existing-share")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "撤回分享：existing-share" }));
    await waitFor(() => expect(screen.queryByText("/share/existing-share")).not.toBeInTheDocument());

    const postCalls = fetchMock.mock.calls.filter(([, init]) => (
      (init as RequestInit | undefined)?.method === "POST"
    ));
    const callsFor = (url: string) => postCalls.filter(([calledUrl]) => calledUrl === url);
    const headerKey = (call: unknown[]) => ((call[1] as RequestInit).headers as Record<string, string>)["Idempotency-Key"];
    const generationCalls = callsFor("/api/books");
    const shareCalls = callsFor(`/api/books/${generatedBook.id}/shares`);
    const revokeCalls = callsFor(`/api/books/${generatedBook.id}/shares/existing-share/revoke`);
    expect(headerKey(generationCalls[0]!)).not.toBe(headerKey(generationCalls[1]!));
    expect(headerKey(shareCalls[0]!)).not.toBe(headerKey(shareCalls[1]!));
    expect(headerKey(revokeCalls[0]!)).not.toBe(headerKey(revokeCalls[1]!));
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
