import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const motionPreference = vi.hoisted(() => ({ reduce: false }));

vi.mock("framer-motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("framer-motion")>();
  return {
    ...actual,
    useReducedMotion: () => motionPreference.reduce,
  };
});

import { FamilyBookReader } from "./family-book-reader";

describe("FamilyBookReader", () => {
  afterEach(() => {
    motionPreference.reduce = false;
  });

  it("shows one two-page spread at a time and turns to real image and voice memories", async () => {
    render(
      <FamilyBookReader
        body="写给未来的我们，愿每次回望都有一盏灯。"
        intro="这是属于我们的一本家书。"
        media={[
          {
            id: "image-1",
            kind: "image",
            title: "除夕餐桌",
            caption: "一家人围着热汤。",
            mimeType: "image/jpeg",
            originalName: "dinner.jpg",
            url: "/api/assets/image-1/content",
            width: 1600,
            height: 1200,
            durationMs: null,
          },
          {
            id: "audio-1",
            kind: "audio",
            title: "外婆的声音",
            caption: "一句留在厨房里的叮咛。",
            mimeType: "audio/mpeg",
            originalName: "grandma.mp3",
            url: "/api/assets/audio-1/content",
            width: null,
            height: null,
            durationMs: 21_000,
          },
        ]}
        sections={[{ title: "把灯留给回家的人", body: "雨夜里的车灯和厨房的灯，照见同一条回家路。", sourceMemoryIds: ["memory-1"] }]}
        sourceLabels={{ "memory-1": "雨夜送学" }}
        title="灯火一直在"
      />,
    );

    expect(screen.getByRole("heading", { name: "灯火一直在" })).toBeInTheDocument();
    const reader = screen.getByRole("article", { name: "家书纪念册预览" });
    expect(reader).toHaveAttribute("aria-roledescription", "可翻页家书");
    expect(reader).toHaveAttribute("tabindex", "0");
    expect(screen.getByTestId("visible-family-book-spread")).toHaveAttribute("data-spread-index", "0");
    expect(screen.getByText("第 1 / 3 页")).toHaveAttribute("aria-live", "polite");

    const previousPage = screen.getByRole("button", { name: "上一页" });
    const nextPage = screen.getByRole("button", { name: "下一页" });
    expect(previousPage).toHaveTextContent("上一页");
    expect(previousPage).toBeDisabled();
    expect(nextPage).toHaveTextContent("下一页");
    expect(nextPage).toBeEnabled();

    fireEvent.keyDown(reader, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByText("第 2 / 3 页")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("visible-family-book-spread")).toHaveAttribute("data-spread-index", "1"));

    fireEvent.keyDown(reader, { key: "ArrowLeft" });
    await waitFor(() => expect(screen.getByText("第 1 / 3 页")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("visible-family-book-spread")).toHaveAttribute("data-spread-index", "0"));

    fireEvent.click(nextPage);

    await waitFor(() => expect(screen.getByTestId("visible-family-book-spread")).toHaveAttribute("data-spread-index", "1"));
    const visibleSpread = screen.getByTestId("visible-family-book-spread");
    expect(within(visibleSpread).getByAltText("除夕餐桌：一家人围着热汤。")).toHaveAttribute("src", "/api/assets/image-1/content");
    expect(within(visibleSpread).getByLabelText("播放声音记忆：外婆的声音")).toHaveAttribute("src", "/api/assets/audio-1/content");
    expect(screen.getByRole("button", { name: "下载 PDF 纪念册" })).toBeEnabled();
    expect(within(visibleSpread).getByText("声音夹页")).toBeInTheDocument();
    expect(within(visibleSpread).getByText("来源 · 雨夜送学")).toBeInTheDocument();
    expect(within(visibleSpread).getAllByText("雨夜里的车灯和厨房的灯，照见同一条回家路。")).toHaveLength(1);
  });

  it("keeps page navigation available when motion is reduced", async () => {
    motionPreference.reduce = true;

    render(
      <FamilyBookReader
        body="写给未来的我们。"
        intro="一本安静的家书。"
        media={[]}
        sections={[{ title: "第一章", body: "第一页的故事。", sourceMemoryIds: [] }]}
        sourceLabels={{}}
        title="安静的灯"
      />,
    );

    const reader = screen.getByRole("article", { name: "家书纪念册预览" });
    fireEvent.keyDown(reader, { key: "ArrowRight" });

    await waitFor(() => expect(screen.getByTestId("visible-family-book-spread")).toHaveAttribute("data-spread-index", "1"));
    expect(screen.getByText("第 2 / 3 页")).toBeInTheDocument();
  });

  it("lets an administrator confirm each visible spread in order", async () => {
    const onConfirmSpread = vi.fn();

    render(
      <FamilyBookReader
        body="写给未来的我们。"
        intro="一本需要逐页确认的家书。"
        media={[]}
        onConfirmSpread={onConfirmSpread}
        reviewedSpreadIndexes={[]}
        sections={[{ title: "第一章", body: "第一页的故事。", sourceMemoryIds: [] }]}
        sourceLabels={{}}
        title="确认中的灯"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "确认第 1 页" }));
    expect(onConfirmSpread).toHaveBeenCalledWith(0);
    expect(screen.getByText("请依序确认第 1 / 3 页")).toBeInTheDocument();
  });

  it("keeps the visible spread in sync during rapid forward and backward turns", () => {
    render(
      <FamilyBookReader
        body="写给未来的我们。"
        intro="一本可以连续翻动的家书。"
        media={[]}
        sections={[{ title: "第一章", body: "第一页的故事。", sourceMemoryIds: [] }]}
        sourceLabels={{}}
        title="连续翻页"
      />,
    );

    const nextPage = screen.getByRole("button", { name: "下一页" });
    fireEvent.click(nextPage);
    fireEvent.click(nextPage);

    const finalSpread = screen.getByTestId("visible-family-book-spread");
    expect(finalSpread).toHaveAttribute("data-spread-index", "2");
    expect(within(finalSpread).getByText("愿灯火一直在")).toBeInTheDocument();
    expect(screen.getByText("第 3 / 3 页")).toHaveAttribute("aria-live", "polite");

    const previousPage = screen.getByRole("button", { name: "上一页" });
    fireEvent.click(previousPage);
    fireEvent.click(previousPage);

    const openingSpread = screen.getByTestId("visible-family-book-spread");
    expect(openingSpread).toHaveAttribute("data-spread-index", "0");
    expect(within(openingSpread).getByRole("heading", { name: "连续翻页" })).toBeInTheDocument();
    expect(screen.getByText("第 1 / 3 页")).toHaveAttribute("aria-live", "polite");
  });
});
