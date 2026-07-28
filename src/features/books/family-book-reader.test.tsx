import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FamilyBookReader } from "./family-book-reader";

describe("FamilyBookReader", () => {
  it("weaves real image and voice memories through a two-page keepsake preview", () => {
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
    expect(screen.getByLabelText("家书纪念册预览")).toBeInTheDocument();
    expect(screen.getByAltText("除夕餐桌：一家人围着热汤。")).toHaveAttribute("src", "/api/assets/image-1/content");
    expect(screen.getByLabelText("播放声音记忆：外婆的声音")).toHaveAttribute("src", "/api/assets/audio-1/content");
    expect(screen.getByRole("button", { name: "下载 PDF 纪念册" })).toBeEnabled();
    expect(screen.getByText("声音夹页")).toBeInTheDocument();
    expect(screen.getByText("来源 · 雨夜送学")).toBeInTheDocument();
    expect(screen.getAllByText("雨夜里的车灯和厨房的灯，照见同一条回家路。")).toHaveLength(1);
  });
});
