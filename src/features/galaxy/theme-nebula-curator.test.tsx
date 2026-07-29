import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ThemeNebulaCurator } from "./theme-nebula-curator";

const availableMemories = [
  { id: "memory-1", title: "雨夜送学", summary: "父亲把雨衣披在孩子肩上，车灯照亮了回家的路。" },
  { id: "memory-2", title: "厨房的灯", summary: "晚归的人推开门时，饭菜还温着。" },
];

function renderCurator(overrides: Partial<React.ComponentProps<typeof ThemeNebulaCurator>> = {}) {
  const onSelectTheme = vi.fn();
  const onSourceIdsChange = vi.fn();
  const onUploadDocument = vi.fn();
  const onStartBinding = vi.fn();

  const view = render(
    <ThemeNebulaCurator
      availableMemories={availableMemories}
      onSelectTheme={onSelectTheme}
      onSourceIdsChange={onSourceIdsChange}
      onStartBinding={onStartBinding}
      onUploadDocument={onUploadDocument}
      selectedMemoryIds={[]}
      selectedTheme="亲子成长"
      {...overrides}
    />,
  );

  return { ...view, onSelectTheme, onSourceIdsChange, onStartBinding, onUploadDocument };
}

describe("ThemeNebulaCurator", () => {
  it("renders four distinct family-story curator themes without an automatic workshop jump", () => {
    renderCurator();

    expect(screen.getByRole("button", { name: "亲子成长" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "父母人生" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "纪念星册" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "旅行星云" })).toBeInTheDocument();
    expect(screen.getAllByText("把每一次长大，留成未来也能认出的光。")).toHaveLength(2);
    expect(screen.getByText("智能编排建议")).toBeVisible();
    expect(screen.queryByText("进入家书工坊")).not.toBeInTheDocument();
  });

  it("selects a theme and keeps the selected memories under administrator control", () => {
    const initial = renderCurator();

    fireEvent.click(screen.getByRole("button", { name: "父母人生" }));

    expect(initial.onSelectTheme).toHaveBeenLastCalledWith("父母人生");

    initial.unmount();
    const selected = renderCurator({ selectedTheme: "父母人生" });

    expect(screen.getAllByText("年轻时的 TA、成家、工作、没说出口的话。")).toHaveLength(2);

    fireEvent.click(screen.getByRole("checkbox", { name: "装订来源：雨夜送学" }));

    expect(selected.onSourceIdsChange).toHaveBeenLastCalledWith(["memory-1"]);
  });

  it("only enables binding after a confirmed memory source is selected", () => {
    const { onStartBinding, onUploadDocument } = renderCurator({
      selectedMemoryIds: ["memory-1"],
      selectedTheme: "父母人生",
    });

    const bindButton = screen.getByRole("button", { name: "开始装订父母人生家书" });
    expect(bindButton).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: "装订来源：雨夜送学" })).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "上传一份家庭文档" }));
    fireEvent.click(bindButton);

    expect(onUploadDocument).toHaveBeenCalledTimes(1);
    expect(onStartBinding).toHaveBeenCalledTimes(1);
  });

  it("keeps binding unavailable when no approved source is chosen", () => {
    renderCurator({ selectedTheme: "纪念星册" });

    expect(screen.getByRole("button", { name: "开始装订纪念星册家书" })).toBeDisabled();
  });
});
