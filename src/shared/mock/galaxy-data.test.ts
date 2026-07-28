import { describe, expect, it } from "vitest";

import {
  galaxyZones,
  memoryStars,
  planets,
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

  it("routes the legacy resonance and book zones into the guarded galaxy workspace", () => {
    expect(galaxyZones.find((zone) => zone.key === "privacy")?.href).toBe("/galaxy");
    expect(galaxyZones.find((zone) => zone.key === "resonance")?.href).toBe("/galaxy");
    expect(galaxyZones.find((zone) => zone.key === "books")?.href).toBe("/galaxy");
  });

  it("keeps the visual planet, story, and memory fixtures connected", () => {
    const mom = planets.find((planet) => planet.id === "mock-mom");
    const momStories = storyNodes.filter((node) => node.planetId === "mock-mom");
    const momMemory = memoryStars.find((memory) => memory.id === "memory-2018-mom");

    expect(mom?.name).toBe("妈妈的星球");
    expect(momStories.length).toBeGreaterThanOrEqual(3);
    expect(momMemory?.visibility).toBe("family");
  });

  it("keeps the inheritance and growth demo fixtures referentially complete", () => {
    const memoryIds = new Set(memoryStars.map((memory) => memory.id));
    const planetIds = new Set(planets.map((planet) => planet.id));
    const expectedMemoryIds = [
      "memory-1998-mom",
      "memory-2008-grandma",
      "memory-2008-mom-kitchen",
      "memory-2022-child",
      "memory-2022-me-child",
    ];
    const expectedMemoryPlanetIds = {
      "memory-1998-mom": "mock-mom",
      "memory-2008-grandma": "mock-grandma",
      "memory-2008-mom-kitchen": "mock-mom",
      "memory-2022-child": "mock-child",
      "memory-2022-me-child": "mock-me",
    };

    expect(expectedMemoryIds.every((memoryId) => memoryIds.has(memoryId))).toBe(true);
    expect(memoryIds.size).toBe(memoryStars.length);
    expect(memoryStars.every((memory) => planetIds.has(memory.planetId))).toBe(true);
    expect(
      Object.fromEntries(
        expectedMemoryIds.map((memoryId) => [
          memoryId,
          memoryStars.find((memory) => memory.id === memoryId)?.planetId,
        ]),
      ),
    ).toEqual(expectedMemoryPlanetIds);

  });
});
