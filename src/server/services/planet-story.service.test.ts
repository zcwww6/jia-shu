import { describe, expect, it, vi } from "vitest";

import {
  getPlanetStory,
  type PlanetStoryRecord,
  type PlanetStoryServiceDeps,
} from "./planet-story.service";

function planetStoryRecord(overrides: Partial<PlanetStoryRecord> = {}): PlanetStoryRecord {
  return {
    id: "planet-empty",
    name: "小树的星球",
    type: "child",
    lifeState: "active",
    visibility: "private",
    role: "女儿",
    theme: "晨光星环",
    summary: "一颗刚刚被点亮的家人星球。",
    positionX: 42,
    positionY: 58,
    memories: [],
    ...overrides,
  };
}

function depsFor(record: PlanetStoryRecord | null): PlanetStoryServiceDeps {
  return {
    findPlanetStory: vi.fn().mockResolvedValue(record),
  };
}

describe("getPlanetStory", () => {
  it("returns an empty real story for an owned planet instead of a mock fallback", async () => {
    const deps = depsFor(planetStoryRecord());

    const story = await getPlanetStory("user-1", "planet-empty", deps);

    expect(deps.findPlanetStory).toHaveBeenCalledWith("user-1", "planet-empty");
    expect(story.memories).toEqual([]);
    expect(story.planet).toMatchObject({
      id: "planet-empty",
      name: "小树的星球",
      stats: { memoryStars: 0, resonanceTracks: 0, bookDrafts: 0 },
    });
  });

  it("does not expose another administrator's planet", async () => {
    const deps = depsFor(null);

    await expect(getPlanetStory("user-2", "planet-1", deps)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("keeps confirmed and draft memories distinct in the real story projection", async () => {
    const deps = depsFor(planetStoryRecord({
      memories: [
        {
          id: "memory-confirmed",
          title: "第一次自己上学",
          summary: "她背着书包走进校门。",
          sourceText: "她背着书包走进校门。",
          occurredAtLabel: "2024 年秋天",
          status: "confirmed",
          createdAt: new Date("2024-09-01T00:00:00.000Z"),
          resonanceSources: [],
          resonanceTargets: [],
          bookMemories: [],
        },
        {
          id: "memory-draft",
          title: null,
          summary: null,
          sourceText: "她今天学会了骑自行车。",
          occurredAtLabel: null,
          status: "draft",
          createdAt: new Date("2024-10-01T00:00:00.000Z"),
          resonanceSources: [],
          resonanceTargets: [],
          bookMemories: [],
        },
      ],
    }));

    const story = await getPlanetStory("user-1", "planet-empty", deps);

    expect(story.memories).toEqual([
      expect.objectContaining({ id: "memory-confirmed", status: "confirmed" }),
      expect.objectContaining({ id: "memory-draft", status: "draft" }),
    ]);
    expect(story.planet.stats).toEqual({ memoryStars: 1, resonanceTracks: 0, bookDrafts: 0 });
  });

  it("projects only confirmed resonances into the real story scene", async () => {
    const endpoints = {
      sourceMemoryId: "memory-source",
      targetMemoryId: "memory-target",
      sourceMemory: { planetId: "planet-empty" },
      targetMemory: { planetId: "planet-other" },
      score: 0.91,
      reason: "两段记忆都记录了外婆的年夜饭。",
    };
    const deps = depsFor(planetStoryRecord({
      memories: [{
        id: "memory-source",
        title: "外婆的年夜饭",
        summary: "厨房里飘着熟悉的香气。",
        sourceText: "外婆又做了一桌年夜饭。",
        occurredAtLabel: "2018 年除夕",
        status: "confirmed",
        createdAt: new Date("2018-02-15T00:00:00.000Z"),
        resonanceSources: [
          { id: "resonance-candidate", status: "candidate", ...endpoints },
          { id: "resonance-rejected", status: "rejected", ...endpoints },
          { id: "resonance-confirmed", status: "confirmed", ...endpoints },
        ],
        resonanceTargets: [],
        bookMemories: [],
      }],
    }));

    const story = await getPlanetStory("user-1", "planet-empty", deps);

    expect(story.confirmedResonances).toEqual([
      {
        id: "resonance-confirmed",
        sourceMemoryId: "memory-source",
        targetMemoryId: "memory-target",
        sourcePlanetId: "planet-empty",
        targetPlanetId: "planet-other",
        score: 0.91,
        reason: "两段记忆都记录了外婆的年夜饭。",
      },
    ]);
    expect(story.planet.stats.resonanceTracks).toBe(1);
  });

  it("keeps an AI-completed memory waiting for confirmation visible without lighting it as confirmed", async () => {
    const deps = depsFor(planetStoryRecord({
      memories: [
        {
          id: "memory-needs-confirmation",
          title: "等待确认的骑行记忆",
          summary: "AI 已整理出这段骑行片段。",
          sourceText: "今天第一次骑完了整条小路。",
          occurredAtLabel: "今天",
          status: "needs_confirmation",
          createdAt: new Date("2026-07-19T00:00:00.000Z"),
          resonanceSources: [{ id: "resonance-should-not-count" }],
          resonanceTargets: [],
          bookMemories: [{ id: "book-memory-should-not-count" }],
        },
      ],
    }));

    const story = await getPlanetStory("user-1", "planet-empty", deps);

    expect(story.memories).toEqual([
      expect.objectContaining({ id: "memory-needs-confirmation", status: "needs_confirmation" }),
    ]);
    expect(story.planet.stats).toEqual({ memoryStars: 0, resonanceTracks: 0, bookDrafts: 0 });
  });
});
