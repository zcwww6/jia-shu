import { describe, expect, it, vi } from "vitest";

import type { Planet } from "@/shared/types/galaxy";

import { getHomeData } from "./home.service";

const legacyMemorialMockCopy = {
  role: "纪念星域",
  theme: "柔紫纪念光",
  summary: "以克制语气保存来源、时间和家人寄语。",
};

const neutralOtherCopy = {
  role: "家人星球",
  theme: "中性星域",
  summary: "这颗星球还没有被写下的故事。",
};

function homePlanet(overrides: Record<string, unknown> = {}) {
  return {
    id: "planet-1",
    name: "妈妈的星球",
    type: "parent",
    lifeState: "active",
    visibility: "family",
    role: "家庭可见",
    theme: "暖橘星环",
    summary: "已经有主题描述。",
    positionX: 12,
    positionY: 34,
    relationshipsFrom: [],
    relationshipsTo: [],
    memories: [],
    ...overrides,
  };
}

describe("getHomeData", () => {
  it("throws UNAUTHENTICATED when there is no signed-in user id", async () => {
    await expect(getHomeData(undefined)).rejects.toThrow("UNAUTHENTICATED");
  });

  it("returns a true empty state without bootstrapping mock planets", async () => {
    const findHomePlanets = vi.fn().mockResolvedValue([]);

    const result = await getHomeData("user_1", { findHomePlanets });

    expect(findHomePlanets).toHaveBeenCalledWith("user_1");
    expect(result).toEqual({
      planets: [],
      archivedPlanets: [],
      relationships: [],
      pendingResonances: [],
      growingBooks: [],
      confirmedMemories: [],
    });
  });

  it("projects only confirmed active home memories as display-safe memory stars", async () => {
    const result = await getHomeData("user_1", {
      findHomePlanets: vi.fn().mockResolvedValue([
        homePlanet({
          id: "planet-mom",
          memories: [
            {
              id: "memory-mom", status: "confirmed", deletedAt: null, title: "除夕合照", summary: "全家团圆", occurredAtLabel: "2018 年除夕", locationLabel: "新房", people: ["妈妈", "我"], visibility: "family",
              sourceText: "不得泄露的原文", assets: [{ storageKey: "private-photo" }], aiJobs: [{ requestHash: "private-job" }],
              allowBook: false, resonanceSources: [], resonanceTargets: [], bookMemories: [],
            },
            {
              id: "memory-draft", status: "draft", deletedAt: null, title: "草稿", summary: "", occurredAtLabel: null, locationLabel: null, people: [], visibility: "private",
              sourceText: "草稿原文", allowBook: false, resonanceSources: [], resonanceTargets: [], bookMemories: [],
            },
            {
              id: "memory-review", status: "needs_confirmation", deletedAt: null, title: "待确认", summary: "", occurredAtLabel: null, locationLabel: null, people: [], visibility: "private",
              sourceText: "待确认原文", allowBook: false, resonanceSources: [], resonanceTargets: [], bookMemories: [],
            },
            {
              id: "memory-deleted", status: "confirmed", deletedAt: new Date(), title: "已删除", summary: "", occurredAtLabel: null, locationLabel: null, people: [], visibility: "private",
              sourceText: "删除原文", allowBook: false, resonanceSources: [], resonanceTargets: [], bookMemories: [],
            },
          ],
        }),
        homePlanet({
          id: "planet-dad",
          memories: [{
            id: "memory-dad", status: "confirmed", deletedAt: null, title: null, summary: null, occurredAtLabel: null, locationLabel: null, people: null, visibility: "private",
            sourceText: "不得泄露的爸爸原文", allowBook: false, resonanceSources: [], resonanceTargets: [], bookMemories: [],
          }],
        }),
      ]),
    });

    expect(result.confirmedMemories).toEqual([
      {
        id: "memory-mom", planetId: "planet-mom", title: "除夕合照", occurredAt: "2018 年除夕", location: "新房", people: ["妈妈", "我"], emotions: [], visibility: "family", summary: "全家团圆",
      },
      {
        id: "memory-dad", planetId: "planet-dad", title: "未命名记忆", occurredAt: "", location: "", people: [], emotions: [], visibility: "private", summary: "",
      },
    ]);
    expect(JSON.stringify(result.confirmedMemories)).not.toContain("不得泄露");
    expect(JSON.stringify(result.confirmedMemories)).not.toContain("private-photo");
    expect(JSON.stringify(result.confirmedMemories)).not.toContain("private-job");
  });

  it("returns archived family planets separately so the editor can restore them after a refresh", async () => {
    const result = await getHomeData("user_1", {
      findHomePlanets: vi.fn().mockResolvedValue([]),
      findArchivedHomePlanets: vi.fn().mockResolvedValue([
        homePlanet({
          id: "archived-mom",
          name: "妈妈的星球",
          version: 4,
          positionX: 55,
          positionY: 35,
        }),
      ]),
    });

    expect(result.archivedPlanets).toEqual([
      expect.objectContaining({
        id: "archived-mom",
        name: "妈妈的星球",
        version: 4,
        position: { x: 55, y: 35 },
      }),
    ]);
  });

  it("assigns distinct in-galaxy fallback anchors to persisted planets without positions", async () => {
    const result = await getHomeData("user_1", {
      findHomePlanets: vi.fn().mockResolvedValue([
        homePlanet({ id: "mother", positionX: 34, positionY: 38 }),
        homePlanet({ id: "father", positionX: 63, positionY: 42 }),
        homePlanet({ id: "child", positionX: 72, positionY: 68 }),
        homePlanet({ id: "grandmother", positionX: 78, positionY: 30 }),
        ...["grandfather", "grandma", "maternal-grandfather", "aunt", "uncle", "younger-aunt"].map((id) =>
          homePlanet({ id, positionX: null, positionY: null }),
        ),
      ]),
    });

    const positions = result.planets.map((planet) => planet.position);

    expect(positions).toHaveLength(10);
    expect(new Set(positions.map(({ x, y }) => `${x},${y}`)).size).toBe(10);
    expect(positions.every(({ x, y }) => x >= 12 && x <= 88 && y >= 12 && y <= 88)).toBe(true);
  });

  it("maps persisted values and aggregates confirmed memories, resonances, and active book links", async () => {
    const result = await getHomeData("user_1", {
      findHomePlanets: vi.fn().mockResolvedValue([
        homePlanet({
          memories: [
            {
              id: "memory-1",
              resonanceSources: [{
                id: "resonance-1",
                status: "confirmed",
                sourceMemory: { planetId: "planet-1" },
                targetMemory: { planetId: "planet-1" },
                score: 0.9,
              }],
              resonanceTargets: [{
                id: "resonance-2",
                status: "confirmed",
                sourceMemory: { planetId: "planet-1" },
                targetMemory: { planetId: "planet-1" },
                score: 0.8,
              }],
              bookMemories: [{ id: "book-memory-1" }],
            },
            {
              id: "memory-2",
              resonanceSources: [{
                id: "resonance-1",
                status: "confirmed",
                sourceMemory: { planetId: "planet-1" },
                targetMemory: { planetId: "planet-1" },
                score: 0.9,
              }],
              resonanceTargets: [],
              bookMemories: [{ id: "book-memory-2" }],
            },
          ],
        }),
      ]),
    });

    expect(result.planets).toEqual<Planet[]>([
      {
        id: "planet-1",
        name: "妈妈的星球",
        type: "parent",
        lifeState: "active",
        visibility: "family",
        role: "家庭可见",
        theme: "暖橘星环",
        summary: "已经有主题描述。",
        position: { x: 12, y: 34 },
        stats: { memoryStars: 2, resonanceTracks: 2, bookDrafts: 2 },
      },
    ]);
  });

  it("exposes the persisted version and cover reference needed by real planet controls", async () => {
    const result = await getHomeData("user_1", {
      findHomePlanets: vi.fn().mockResolvedValue([homePlanet({ version: 4, coverAssetId: "asset-cover-1" })]),
    });

    expect(result.planets[0]).toMatchObject({ version: 4, coverAssetId: "asset-cover-1" });
  });

  it("projects a resonance track only after it is confirmed, never while candidate or rejected", async () => {
    const result = await getHomeData("user_1", {
      findHomePlanets: vi.fn().mockResolvedValue([
        homePlanet({
          memories: [{
            id: "memory-1",
            resonanceSources: [
              { id: "resonance-candidate", status: "candidate" },
              { id: "resonance-rejected", status: "rejected" },
              {
                id: "resonance-confirmed",
                status: "confirmed",
                sourceMemory: { planetId: "planet-1" },
                targetMemory: { planetId: "planet-1" },
                score: 0.9,
              },
            ],
            resonanceTargets: [{
              id: "resonance-confirmed",
              status: "confirmed",
              sourceMemory: { planetId: "planet-1" },
              targetMemory: { planetId: "planet-1" },
              score: 0.9,
            }],
            bookMemories: [],
          }],
        }),
      ]),
    });

    expect(result.planets[0]?.stats.resonanceTracks).toBe(1);
  });

  it("projects each confirmed cross-planet resonance as one real galaxy link", async () => {
    const resonance = {
      sourceMemoryId: "memory-source",
      targetMemoryId: "memory-target",
      sourceMemory: { planetId: "planet-1" },
      targetMemory: { planetId: "planet-2" },
      score: 0.93,
      reason: "两段记忆共同记住了那次搬家。",
    };
    const result = await getHomeData("user_1", {
      findHomePlanets: vi.fn().mockResolvedValue([
        homePlanet({
          id: "planet-1",
          memories: [{
            id: "memory-source",
            resonanceSources: [
              { id: "resonance-candidate", status: "candidate", ...resonance },
              { id: "resonance-rejected", status: "rejected", ...resonance },
              { id: "resonance-confirmed", status: "confirmed", ...resonance },
              {
                id: "resonance-inactive-endpoint",
                status: "confirmed",
                ...resonance,
                targetMemory: { planetId: "planet-deleted" },
              },
            ],
            resonanceTargets: [],
            bookMemories: [],
          }],
        }),
        homePlanet({
          id: "planet-2",
          memories: [{
            id: "memory-target",
            resonanceSources: [],
            resonanceTargets: [{ id: "resonance-confirmed", status: "confirmed", ...resonance }],
            bookMemories: [],
          }],
        }),
      ]),
    });

    expect(result.relationships).toEqual([
      {
        id: "resonance-confirmed",
        sourcePlanetId: "planet-1",
        targetPlanetId: "planet-2",
        kind: "resonance",
        status: "confirmed",
        label: "两段记忆共同记住了那次搬家。",
        visibility: "family",
        strength: 0.93,
        rule: "sharedMemory",
      },
    ]);
    expect(result.planets.map((planet) => planet.stats.resonanceTracks)).toEqual([1, 1]);
  });

  it("keeps migrated memorial lifecycle with neutral non-mock copy", async () => {
    const result = await getHomeData("user_1", {
      findHomePlanets: vi.fn().mockResolvedValue([
        homePlanet({
          id: "planet-memorial",
          type: "other",
          lifeState: "memorial",
          role: null,
          theme: null,
          summary: null,
          positionX: null,
          positionY: null,
        }),
      ]),
    });

    expect(result.planets).toMatchObject([
      {
        id: "planet-memorial",
        type: "other",
        lifeState: "memorial",
        ...neutralOtherCopy,
        position: { x: 18, y: 26 },
      },
    ]);
    const memorial = result.planets[0];
    expect(memorial?.role).not.toBe(legacyMemorialMockCopy.role);
    expect(memorial?.theme).not.toBe(legacyMemorialMockCopy.theme);
    expect(memorial?.summary).not.toBe(legacyMemorialMockCopy.summary);
  });

  it("maps a legacy memorial type into the memorial lifecycle for compatible reads", async () => {
    const result = await getHomeData("user_1", {
      findHomePlanets: vi.fn().mockResolvedValue([
        homePlanet({
          id: "planet-legacy-memorial",
          type: "memorial",
          lifeState: "active",
          role: null,
          theme: null,
          summary: null,
        }),
      ]),
    });

    expect(result.planets).toMatchObject([
      {
        id: "planet-legacy-memorial",
        type: "memorial",
        lifeState: "memorial",
        ...neutralOtherCopy,
      },
    ]);
    const legacyMemorial = result.planets[0];
    expect(legacyMemorial?.role).not.toBe(legacyMemorialMockCopy.role);
    expect(legacyMemorial?.theme).not.toBe(legacyMemorialMockCopy.theme);
    expect(legacyMemorial?.summary).not.toBe(legacyMemorialMockCopy.summary);
  });

  it("uses neutral active-other copy rather than falling back to the self planet mock", async () => {
    const result = await getHomeData("user_1", {
      findHomePlanets: vi.fn().mockResolvedValue([
        homePlanet({
          id: "planet-other",
          type: "other",
          role: null,
          theme: null,
          summary: null,
          positionX: null,
          positionY: null,
        }),
      ]),
    });

    expect(result.planets).toMatchObject([
      {
        id: "planet-other",
        type: "other",
        lifeState: "active",
        ...neutralOtherCopy,
        position: { x: 18, y: 26 },
      },
    ]);
  });

  it("projects real relationships, pending resonances, and growing books without creating demo records", async () => {
    const result = await getHomeData("user_1", {
      findHomePlanets: vi.fn().mockResolvedValue([
        homePlanet({
          id: "planet-1",
          relationshipsFrom: [
            {
              id: "relationship-1",
              sourcePlanetId: "planet-1",
              targetPlanetId: "planet-2",
              relationshipType: "parent",
              label: "母女",
              visibility: "family",
            },
          ],
          memories: [
            {
              id: "memory-1",
              resonanceSources: [
                {
                  id: "resonance-candidate-1",
                  status: "candidate",
                  sourceMemoryId: "memory-1",
                  targetMemoryId: "memory-2",
                  score: 0.86,
                  reason: "两段记忆都提到同一场家庭旅行。",
                  version: 7,
                },
              ],
              resonanceTargets: [],
              bookMemories: [
                {
                  id: "book-memory-1",
                  book: {
                    id: "book-1",
                    title: "夏日家书",
                    status: "draft",
                  },
                },
              ],
            },
          ],
        }),
        homePlanet({
          id: "planet-2",
          relationshipsTo: [
            {
              id: "relationship-1",
              sourcePlanetId: "planet-1",
              targetPlanetId: "planet-2",
              relationshipType: "parent",
              label: "母女",
              visibility: "family",
            },
          ],
          memories: [
            {
              id: "memory-2",
              resonanceSources: [],
              resonanceTargets: [
                {
                  id: "resonance-candidate-1",
                  status: "candidate",
                  sourceMemoryId: "memory-1",
                  targetMemoryId: "memory-2",
                  score: 0.86,
                  reason: "两段记忆都提到同一场家庭旅行。",
                  version: 7,
                },
              ],
              bookMemories: [
                {
                  id: "book-memory-2",
                  book: {
                    id: "book-1",
                    title: "夏日家书",
                    status: "draft",
                  },
                },
              ],
            },
          ],
        }),
      ]),
    });

    expect(result.relationships).toEqual([
      {
        id: "relationship-1",
        sourcePlanetId: "planet-1",
        targetPlanetId: "planet-2",
        kind: "family",
        status: "confirmed",
        label: "母女",
        visibility: "family",
        strength: 1,
        rule: "relationship",
      },
    ]);
    expect(result.pendingResonances).toEqual([
      {
        id: "resonance-candidate-1",
        sourceMemoryId: "memory-1",
        targetMemoryId: "memory-2",
        score: 0.86,
        reason: "两段记忆都提到同一场家庭旅行。",
        version: 7,
      },
    ]);
    expect(result.growingBooks).toEqual([
      {
        id: "book-1",
        title: "夏日家书",
        status: "draft",
        memoryCount: 2,
      },
    ]);
  });

  it("projects a manually configured relationship as a custom star track", async () => {
    const result = await getHomeData("user_1", {
      findHomePlanets: vi.fn().mockResolvedValue([
        homePlanet({
          id: "planet-1",
          relationshipsFrom: [{
            id: "relationship-manual",
            sourcePlanetId: "planet-1",
            targetPlanetId: "planet-2",
            relationshipType: "other",
            label: "手动配置星轨",
            visibility: "family",
          }],
        }),
        homePlanet({ id: "planet-2" }),
      ]),
    });

    expect(result.relationships).toEqual([
      expect.objectContaining({
        id: "relationship-manual",
        kind: "custom",
        rule: "manual",
        label: "手动配置星轨",
      }),
    ]);
  });
});
