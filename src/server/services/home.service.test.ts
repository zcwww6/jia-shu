import { describe, expect, it, vi } from "vitest";

import type { Planet } from "@/shared/types/galaxy";

import { getHomeData } from "./home.service";

describe("getHomeData", () => {
  it("throws UNAUTHENTICATED when there is no signed-in user id", async () => {
    await expect(getHomeData(undefined)).rejects.toThrow("UNAUTHENTICATED");
  });

  it("ensures the personal galaxy exists and returns mapped planets for the signed-in user", async () => {
    const ensurePersonalGalaxy = vi.fn().mockResolvedValue(undefined);
    const findHomePlanets = vi.fn().mockResolvedValue([
      {
        id: "planet_self",
        name: "我的星球",
        type: "self",
        visibility: "private",
        role: null,
        theme: null,
        summary: null,
        positionX: null,
        positionY: null,
      },
      {
        id: "planet_parent",
        name: "妈妈的星球",
        type: "parent",
        visibility: "family",
        role: "家庭可见",
        theme: "暖橘星环",
        summary: "已经有主题描述。",
        positionX: 12,
        positionY: 34,
      },
    ]);

    const result = await getHomeData("user_1", {
      ensurePersonalGalaxy,
      findHomePlanets,
    });

    expect(ensurePersonalGalaxy).toHaveBeenCalledWith("user_1");
    expect(findHomePlanets).toHaveBeenCalledWith("user_1");
    expect(result.planets).toEqual<Planet[]>([
      {
        id: "planet_self",
        name: "我的星球",
        type: "self",
        visibility: "private",
        role: "私密核心",
        theme: "极光家书",
        summary: "你自己的记忆核心，分享和共鸣前都需要再次确认。",
        position: { x: 48, y: 52 },
        stats: { memoryStars: 0, resonanceTracks: 0, bookDrafts: 0 },
      },
      {
        id: "planet_parent",
        name: "妈妈的星球",
        type: "parent",
        visibility: "family",
        role: "家庭可见",
        theme: "暖橘星环",
        summary: "已经有主题描述。",
        position: { x: 12, y: 34 },
        stats: { memoryStars: 0, resonanceTracks: 0, bookDrafts: 0 },
      },
    ]);
  });
});
