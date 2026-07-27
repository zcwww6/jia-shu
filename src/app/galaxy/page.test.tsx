import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { auth } = vi.hoisted(() => ({
  auth: vi.fn(),
}));

const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

const { getHomeData } = vi.hoisted(() => ({
  getHomeData: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth,
}));

vi.mock("next/navigation", () => ({
  redirect,
}));

vi.mock("@/server/services/home.service", () => ({
  getHomeData,
}));

import GalaxyPage from "./page";

describe("GalaxyPage", () => {
  it("redirects unauthenticated visitors to /sign-in", async () => {
    auth.mockResolvedValue(null);

    await expect(GalaxyPage()).rejects.toThrow("REDIRECT:/sign-in");
    expect(redirect).toHaveBeenCalledWith("/sign-in");
    expect(getHomeData).not.toHaveBeenCalled();
  });

  it("renders the galaxy workspace for authenticated visitors", async () => {
    auth.mockResolvedValue({
      user: { id: "user-1", email: "user@example.com" },
    });
    getHomeData.mockResolvedValue({
      planets: [
        {
          id: "server-self",
          name: "服务器星球",
          type: "self",
          role: "私密核心",
          visibility: "private",
          theme: "极光家书",
          position: { x: 40, y: 40 },
          stats: { memoryStars: 0, resonanceTracks: 0, bookDrafts: 0 },
          summary: "来自服务端的初始化星球。",
        },
        {
          id: "server-mom",
          name: "妈妈的星球",
          type: "parent",
          role: "母亲",
          visibility: "family",
          theme: "暖橘星环",
          position: { x: 55, y: 35 },
          stats: { memoryStars: 0, resonanceTracks: 0, bookDrafts: 0 },
          summary: "来自服务端的家庭星球。",
        },
      ],
      relationships: [
        {
          id: "server-link",
          sourcePlanetId: "server-self",
          targetPlanetId: "server-mom",
          kind: "custom",
          status: "confirmed",
          label: "手动配置星轨",
          visibility: "family",
          strength: 1,
          rule: "manual",
        },
      ],
      confirmedMemories: [
        {
          id: "server-memory-1",
          planetId: "server-mom",
          title: "服务端确认的除夕",
          occurredAt: "2018 年除夕",
          location: "新房",
          people: ["妈妈", "我"],
          emotions: [],
          visibility: "family",
          summary: "只包含安全展示字段。",
        },
      ],
    });

    render(await GalaxyPage());

    expect(getHomeData).toHaveBeenCalledWith("user-1");
    expect(screen.getByRole("button", { name: "进入服务器星球漫游" })).toBeInTheDocument();
    expect(screen.getByTestId("planet-link-server-link")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新点亮：服务端确认的除夕" })).toBeInTheDocument();
  });
});
