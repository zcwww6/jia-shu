import { describe, expect, it } from "vitest";

import {
  bookDrafts,
  galaxyZones,
  memoryStars,
  planets,
  resonanceTracks,
  storyNodes,
} from "./galaxy-data";

describe("galaxy mock data", () => {
  it("defines the eight v7.3 star zones in navigation order", () => {
    expect(galaxyZones.map((zone) => zone.label)).toEqual([
      "我的星系",
      "隐私星域",
      "纪念星域",
      "星球工坊",
      "记忆星群",
      "共鸣星轨",
      "主题星云",
      "家书工坊",
    ]);
  });

  it("contains a complete mock demo path from planet to book draft", () => {
    const mom = planets.find((planet) => planet.id === "mock-mom");
    const momStories = storyNodes.filter((node) => node.planetId === "mock-mom");
    const momMemory = memoryStars.find((memory) => memory.id === "memory-2018-mom");
    const resonance = resonanceTracks.find((track) =>
      track.sourceMemoryIds.includes("memory-2018-mom"),
    );
    const book = bookDrafts.find((draft) => draft.id === "book-2018-reunion");

    expect(mom?.name).toBe("妈妈的星球");
    expect(momStories.length).toBeGreaterThanOrEqual(3);
    expect(momMemory?.visibility).toBe("family");
    expect(resonance?.status).toBe("candidate");
    expect(book?.sourceMemoryIds).toContain("memory-2018-mom");
    expect(book?.sourceMemoryIds).toContain("memory-2018-me");
  });
});
