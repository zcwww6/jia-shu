import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const { getSharedBook } = vi.hoisted(() => ({ getSharedBook: vi.fn() }));

vi.mock("@/server/store/shared-books", () => ({
  getSharedBook,
}));

import SharedBookPage from "./page";

const storedBook = {
  token: "known-token",
  draft: {
    id: "book-draft-1",
    title: "我们家的第一个新房除夕",
    sourceRange: "binary_system" as const,
    themeTemplateKey: "family_reunion",
    sourceMemoryIds: ["memory-1", "memory-2"],
    intro: "这页家书只使用已确认的记忆星来源。",
    chapters: [],
  },
  body: "原始生成全文内容。",
  sections: [
    { title: "共同记住的一天", body: "AI 先整理出重合。", sourceMemoryIds: ["memory-1"] },
    { title: "来自妈妈的视角", body: "妈妈端出饺子。", sourceMemoryIds: ["memory-2"] },
  ],
  share: { showBody: true, showSourceTitles: true, showOriginalText: false },
  createdAt: "2026-07-01T00:00:00.000Z",
};

describe("/share/[token] 分享页", () => {
  beforeEach(() => {
    getSharedBook.mockReset();
  });

  it("渲染已发布家书的标题、章节与来源标题", async () => {
    getSharedBook.mockResolvedValue(storedBook);

    const element = await SharedBookPage({
      params: Promise.resolve({ token: "known-token" }),
    });
    render(element);

    expect(screen.getByText("我们家的第一个新房除夕")).toBeInTheDocument();
    expect(screen.getByLabelText("家书纪念册预览")).toBeInTheDocument();
    expect(screen.getByText("共同记住的一天")).toBeInTheDocument();
    expect(screen.getByText("来自妈妈的视角")).toBeInTheDocument();
    expect(screen.getByText("来源 · memory-1")).toBeInTheDocument();
    // 原始全文默认关闭，不应展示
    expect(screen.queryByText("原始生成全文内容。")).not.toBeInTheDocument();
  });

  it("开启原始全文开关后展示原始生成全文", async () => {
    getSharedBook.mockResolvedValue({
      ...storedBook,
      share: { showBody: true, showSourceTitles: false, showOriginalText: true },
    });

    const element = await SharedBookPage({
      params: Promise.resolve({ token: "known-token" }),
    });
    render(element);

    expect(screen.getByText("原始生成全文内容。")).toBeInTheDocument();
  });
});
