import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Planet } from "@/shared/types/galaxy";

import { PlanetThemeStudio } from "./planet-theme-studio";

const selectedPlanet: Planet = {
  id: "mother",
  name: "妈妈的星球",
  type: "parent",
  role: "妈妈",
  visibility: "family",
  theme: "家书暖夜",
  position: { x: 48, y: 52 },
  stats: { memoryStars: 12, resonanceTracks: 2, bookDrafts: 1 },
  summary: "一颗被日常光亮包围的家人星球。",
};

function renderStudio() {
  return render(
    <PlanetThemeStudio
      coverSaving={false}
      onPreviewZone={vi.fn()}
      onSaveCover={vi.fn()}
      onSaveTheme={vi.fn()}
      onSelectCover={vi.fn()}
      onSelectMaterial={vi.fn()}
      onSelectPlanet={vi.fn()}
      onSelectTheme={vi.fn()}
      onSelectZone={vi.fn()}
      planets={[selectedPlanet]}
      previewCoverUrl={null}
      selectedCoverFile={null}
      selectedMaterial="柔光釉面"
      selectedPlanet={selectedPlanet}
      selectedTheme="家书暖夜"
      selectedZone="galaxy"
    />,
  );
}

describe("PlanetThemeStudio", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses an explicit photo button to open the accessible cover upload input", () => {
    const inputClick = vi.spyOn(HTMLInputElement.prototype, "click");
    renderStudio();

    const uploadInput = screen.getByLabelText("上传星球封面");
    expect(uploadInput).toHaveAttribute("accept", "image/jpeg,image/png,image/webp,image/avif");
    expect(uploadInput).toHaveAttribute("tabindex", "-1");

    fireEvent.click(screen.getByRole("button", { name: "给星球贴一张照片" }));

    expect(inputClick).toHaveBeenCalledTimes(1);
  });
});
