import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { galaxyZones } from "@/shared/mock/galaxy-data";

import { GalaxyWorkspace } from "./galaxy-workspace";

describe("GalaxyWorkspace", () => {
  it("renders server-provided planets when initialPlanets is passed", () => {
    render(
      <GalaxyWorkspace
        initialPlanets={[
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
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: "进入服务器星球漫游" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "进入妈妈的星球漫游" })).not.toBeInTheDocument();
  });

  it("renders a persisted memorial family member as a memorial planet instead of an unclassified node", () => {
    render(
      <GalaxyWorkspace
        initialPlanets={[
          {
            id: "server-memorial", name: "外公的星球", type: "other", lifeState: "memorial", version: 1,
            role: "外公", visibility: "private", theme: "柔紫纪念光", position: { x: 50, y: 40 },
            stats: { memoryStars: 0, resonanceTracks: 0, bookDrafts: 0 }, summary: "一颗被珍重保存的纪念星。",
          },
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: "进入外公的星球漫游" })).toHaveClass("memorial-planet");
    expect(screen.getByText("念")).toBeInTheDocument();
  });

  it("uses server-provided planets for the recommended route interaction", () => {
    render(
      <GalaxyWorkspace
        initialPlanets={[
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
            id: "server-parent",
            name: "母亲星球",
            type: "parent",
            role: "家庭可见",
            visibility: "family",
            theme: "暖橘星环",
            position: { x: 55, y: 35 },
            stats: { memoryStars: 0, resonanceTracks: 0, bookDrafts: 0 },
            summary: "服务端提供的父母星球。",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "开始靠近" }));

    expect(screen.getByRole("dialog", { name: "母亲星球漫游" })).toBeInTheDocument();
  });

  it("renders the v7.3 galaxy shell, zones, route guide, and view controls", () => {
    render(<GalaxyWorkspace />);

    expect(screen.getByTestId("galaxy-app")).toHaveClass("auto-cruise-active", "immersive-ui-active");
    expect(screen.getByRole("heading", { name: "我的星系" })).toBeInTheDocument();
    expect(screen.getByText("星系图层")).toBeInTheDocument();
    expect(screen.getAllByText("家庭星系操作台").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("新手推荐航线")).toBeInTheDocument();
    expect(screen.getByText("靠近妈妈的星球")).toBeInTheDocument();
    expect(screen.getByText("当前星域")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "放大视角" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "缩小视角" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重置视角" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "自动巡航" }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("拖拽漫游 / 滚轮缩放 / 双击靠近星球")).toBeInTheDocument();
    expect(screen.getAllByText("家书工坊").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: "星图菜单" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "星图编辑" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "沉浸模式" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "分享前确认" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "生成家书" })).not.toBeInTheDocument();
    for (const zone of galaxyZones) {
      expect(screen.getByRole("button", { name: zone.label })).toBeInTheDocument();
    }
  });

  it("opens and toggles an object action ring before entering a planet", async () => {
    render(<GalaxyWorkspace />);

    const momPlanet = screen.getByRole("button", { name: "进入妈妈的星球漫游" });
    fireEvent.click(momPlanet);

    expect(screen.getByTestId("galaxy-app")).toHaveClass("planet-focus-active");
    expect(screen.getByRole("group", { name: "妈妈的星球操作" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "妈妈的星球漫游" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "进入星球" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑主题" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "设置权限" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "生命周期" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "配置连接" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "隐藏星球" })).toBeInTheDocument();

    fireEvent.click(momPlanet);
    await waitFor(
      () => {
        expect(screen.getByTestId("galaxy-app")).not.toHaveClass("planet-focus-active");
        expect(screen.queryByRole("group", { name: "妈妈的星球操作" })).not.toBeInTheDocument();
      },
      { timeout: 1800 },
    );

    fireEvent.click(momPlanet);
    fireEvent.click(screen.getByRole("button", { name: "进入星球" }));
    expect(screen.getByRole("dialog", { name: "妈妈的星球漫游" })).toBeInTheDocument();
  });

  it("drives galaxy links from configurable star-map state", () => {
    render(<GalaxyWorkspace />);

    expect(screen.getByTestId("planet-link-link-me-mom")).toBeInTheDocument();
    expect(screen.getByTestId("planet-link-link-me-grandma-resonance")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "星图编辑" }));
    expect(screen.getByRole("dialog", { name: "星图编辑" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "共鸣线" }));
    expect(screen.queryByTestId("planet-link-link-me-grandma-resonance")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "共鸣线" }));
    expect(screen.getByTestId("planet-link-link-me-grandma-resonance")).toBeInTheDocument();
  });

  it("persists all selected planet settings from the server response and carries its version forward", async () => {
    const responses = [
      {
        id: "server-mom", name: "服务端改名后的妈妈星球", type: "parent", lifeState: "active",
        visibility: "family", role: "母亲", theme: "暖橘星环", summary: "服务端妈妈星球。",
        position: { x: 55, y: 35 }, version: 8, coverAssetId: null,
      },
      {
        id: "server-mom", name: "服务端改名后的妈妈星球", type: "parent", lifeState: "active",
        visibility: "family", role: "母亲", theme: "深空墨蓝", summary: "服务端妈妈星球。",
        position: { x: 55, y: 35 }, version: 9, coverAssetId: null,
      },
      {
        id: "server-mom", name: "服务端改名后的妈妈星球", type: "parent", lifeState: "active",
        visibility: "public", role: "母亲", theme: "深空墨蓝", summary: "服务端妈妈星球。",
        position: { x: 55, y: 35 }, version: 10, coverAssetId: null,
      },
      {
        id: "server-mom", name: "服务端改名后的妈妈星球", type: "parent", lifeState: "memorial",
        visibility: "public", role: "母亲", theme: "深空墨蓝", summary: "服务端妈妈星球。",
        position: { x: 55, y: 35 }, version: 11, coverAssetId: null,
      },
      {
        id: "server-mom", name: "服务端改名后的妈妈星球", type: "parent", lifeState: "active",
        visibility: "public", role: "母亲", theme: "深空墨蓝", summary: "服务端妈妈星球。",
        position: { x: 55, y: 35 }, version: 12, coverAssetId: null,
      },
    ];
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(responses.shift()), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <GalaxyWorkspace
        initialPlanets={[
          {
            id: "server-mom", name: "妈妈的星球", type: "parent", version: 7, role: "母亲",
            visibility: "family", theme: "暖橘星环", position: { x: 55, y: 35 },
            stats: { memoryStars: 0, resonanceTracks: 0, bookDrafts: 0 }, summary: "服务端妈妈星球。",
          },
          {
            id: "server-dad", name: "爸爸的星球", type: "parent", version: 3, role: "父亲",
            visibility: "family", theme: "暖橘星环", position: { x: 38, y: 46 },
            stats: { memoryStars: 0, resonanceTracks: 0, bookDrafts: 0 }, summary: "未被修改的星球。",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "进入妈妈的星球漫游" }));
    fireEvent.click(screen.getByRole("button", { name: "重命名星球" }));
    fireEvent.change(screen.getByRole("textbox", { name: "星球名称" }), { target: { value: "本地草稿名称" } });
    fireEvent.click(screen.getByRole("button", { name: "保存名称" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "进入服务端改名后的妈妈星球漫游" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "进入爸爸的星球漫游" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/planets/server-mom",
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({ "If-Match-Version": "7" }),
        body: JSON.stringify({ version: 7, name: "本地草稿名称" }),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "编辑主题" }));
    fireEvent.click(screen.getByRole("button", { name: /深空墨蓝/ }));
    fireEvent.click(screen.getByRole("button", { name: "保存星球主题" }));
    await waitFor(() => expect(screen.getByText(/当前星球主题：深空墨蓝/)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/planets/server-mom",
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({ "If-Match-Version": "8" }),
        body: JSON.stringify({ version: 8, theme: "深空墨蓝" }),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "我的星系" }));
    fireEvent.click(screen.getByRole("button", { name: "进入服务端改名后的妈妈星球漫游" }));
    fireEvent.click(screen.getByRole("button", { name: "设置权限" }));
    fireEvent.click(screen.getByRole("button", { name: "设为公开分享" }));
    await waitFor(() => expect(screen.getByText("当前可见范围：公开分享")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/planets/server-mom",
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({ "If-Match-Version": "9" }),
        body: JSON.stringify({ version: 9, visibility: "public" }),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "关闭面板" }));
    fireEvent.click(screen.getByRole("button", { name: "我的星系" }));
    fireEvent.click(screen.getByRole("button", { name: "进入服务端改名后的妈妈星球漫游" }));
    fireEvent.click(screen.getByRole("button", { name: "生命周期" }));
    fireEvent.click(screen.getByRole("button", { name: "设为纪念星" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "进入服务端改名后的妈妈星球漫游" })).toHaveClass("memorial-planet"));
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/planets/server-mom",
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({ "If-Match-Version": "10" }),
        body: JSON.stringify({ version: 10, lifeState: "memorial" }),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "设为在世星球" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "进入服务端改名后的妈妈星球漫游" })).not.toHaveClass("memorial-planet"));
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/planets/server-mom",
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({ "If-Match-Version": "11" }),
        body: JSON.stringify({ version: 11, lifeState: "active" }),
      }),
    );
  });

  it("keeps the original selected planet visible when a settings PATCH is rejected", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "版本已过期，请刷新后重试" }), { status: 409 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <GalaxyWorkspace
        initialPlanets={[
          {
            id: "server-mom", name: "妈妈的星球", type: "parent", version: 7, role: "母亲",
            visibility: "family", theme: "暖橘星环", position: { x: 55, y: 35 },
            stats: { memoryStars: 0, resonanceTracks: 0, bookDrafts: 0 }, summary: "服务端妈妈星球。",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "进入妈妈的星球漫游" }));
    fireEvent.click(screen.getByRole("button", { name: "重命名星球" }));
    fireEvent.change(screen.getByRole("textbox", { name: "星球名称" }), { target: { value: "不会保存的名称" } });
    fireEvent.click(screen.getByRole("button", { name: "保存名称" }));

    await waitFor(() => expect(screen.getByText("版本已过期，请刷新后重试")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "进入妈妈的星球漫游" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "进入不会保存的名称漫游" })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/planets/server-mom",
      expect.objectContaining({ method: "PATCH", headers: expect.objectContaining({ "If-Match-Version": "7" }) }),
    );
  });

  it("persists planet management and the first family connection from the legacy editor", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/planets" && init?.method === "POST") {
        return new Response(JSON.stringify({
          id: "server-new", name: "新家庭星球 1", type: "partner", lifeState: "active",
          visibility: "family", role: "待命名星球", theme: "新生星环",
          summary: "一颗刚加入星系的家庭星球，可继续编辑主题、权限和连接线。",
          position: { x: 24, y: 58 }, version: 1,
        }), { status: 201 });
      }
      if (url === "/api/planets/server-self/relationships" && init?.method === "POST") {
        return new Response(JSON.stringify({ id: "relationship-new" }), { status: 201 });
      }
      if (url === "/api/planets/server-mom" && init?.method === "DELETE") {
        return new Response(JSON.stringify({ id: "server-mom", version: 3, archived: true }), { status: 200 });
      }
      if (url === "/api/planets/server-mom/restore" && init?.method === "POST") {
        return new Response(JSON.stringify({ id: "server-mom", version: 4, archived: false }), { status: 200 });
      }
      if (url === "/api/planets/server-new" && init?.method === "DELETE") {
        return new Response(JSON.stringify({ id: "server-new", version: 2, archived: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ message: `unexpected request ${url}` }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <GalaxyWorkspace
        initialPlanets={[
          {
            id: "server-self", name: "我的星球", type: "self", version: 1, role: "私密核心",
            visibility: "private", theme: "极光家书", position: { x: 40, y: 40 },
            stats: { memoryStars: 0, resonanceTracks: 0, bookDrafts: 0 }, summary: "家庭管理员的核心星球。",
          },
          {
            id: "server-mom", name: "妈妈的星球", type: "parent", version: 2, role: "母亲",
            visibility: "family", theme: "暖橘星环", position: { x: 55, y: 35 },
            stats: { memoryStars: 0, resonanceTracks: 0, bookDrafts: 0 }, summary: "一颗真实保存的家人星球。",
          },
        ]}
        initialLinks={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "进入妈妈的星球漫游" }));
    fireEvent.click(screen.getByRole("button", { name: "隐藏星球" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/planets/server-mom",
        expect.objectContaining({ method: "DELETE" }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "星图编辑" }));
    fireEvent.click(screen.getByRole("button", { name: "恢复妈妈的星球" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/planets/server-mom/restore",
        expect.objectContaining({ method: "POST" }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "新增星球" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "进入新家庭星球 1漫游" })).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/planets/server-self/relationships",
        expect.objectContaining({ method: "POST" }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "移除新家庭星球 1" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/planets/server-new",
        expect.objectContaining({ method: "DELETE" }),
      );
    });
  });

  it("shows an archived family planet from the server read model and restores it through the database", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "archived-mom", version: 5, archived: false }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <GalaxyWorkspace
        initialPlanets={[
          {
            id: "server-self", name: "我的星球", type: "self", version: 1, role: "私密核心",
            visibility: "private", theme: "极光家书", position: { x: 40, y: 40 },
            stats: { memoryStars: 0, resonanceTracks: 0, bookDrafts: 0 }, summary: "家庭管理员的核心星球。",
          },
        ]}
        initialArchivedPlanets={[
          {
            id: "archived-mom", name: "妈妈的星球", type: "parent", version: 4, role: "母亲",
            visibility: "family", theme: "暖橘星环", position: { x: 55, y: 35 },
            stats: { memoryStars: 0, resonanceTracks: 0, bookDrafts: 0 }, summary: "一颗可以恢复的家人星球。",
          },
        ]}
        initialLinks={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "星图编辑" }));
    fireEvent.click(screen.getByRole("button", { name: "恢复妈妈的星球" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/planets/archived-mom/restore",
        expect.objectContaining({ method: "POST" }),
      );
      expect(screen.getByRole("button", { name: "进入妈妈的星球漫游" })).toBeInTheDocument();
    });
  });

  it("routes planet object actions into theme, privacy, lifecycle, and book flows", () => {
    render(<GalaxyWorkspace />);

    fireEvent.click(screen.getByRole("button", { name: "进入妈妈的星球漫游" }));
    fireEvent.click(screen.getByRole("button", { name: "设置权限" }));
    expect(screen.getByRole("heading", { name: "家庭可见星域" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "关闭面板" }));
    fireEvent.click(screen.getByRole("button", { name: "我的星系" }));
    fireEvent.click(screen.getByRole("button", { name: "进入妈妈的星球漫游" }));
    fireEvent.click(screen.getByRole("button", { name: "生命周期" }));
    expect(screen.getByRole("heading", { name: "生命周期轨道" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "关闭面板" }));
    fireEvent.click(screen.getByRole("button", { name: "我的星系" }));
    fireEvent.click(screen.getByRole("button", { name: "进入妈妈的星球漫游" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑主题" }));
    expect(screen.getByTestId("galaxy-app")).toHaveClass("scene-customize");

    fireEvent.click(screen.getByRole("button", { name: "我的星系" }));
    fireEvent.click(screen.getByRole("button", { name: "进入妈妈的星球漫游" }));
    fireEvent.click(screen.getByRole("button", { name: "一键生成家书" }));
    expect(screen.getByRole("dialog", { name: "家书光束" })).toBeInTheDocument();
    expect(screen.getByText("记忆星正在收束成一页家书")).toBeInTheDocument();
  });

  it("opens a story scene from a planet surface memory node", () => {
    render(<GalaxyWorkspace />);

    fireEvent.click(screen.getByRole("button", { name: "开始靠近" }));
    fireEvent.click(screen.getByRole("button", { name: "打开故事场景：2018 新家除夕" }));

    expect(screen.getByRole("dialog", { name: "新家除夕故事场景" })).toBeInTheDocument();
    expect(screen.getByText("漂浮照片碎片")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "补充一句话" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "邀请家人" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "加入家书" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "设权限" })).toBeInTheDocument();
  });

  it("switches internal screens without leaving the galaxy workspace", () => {
    render(<GalaxyWorkspace />);

    fireEvent.click(screen.getByRole("button", { name: "隐私星域" }));

    expect(screen.getByText("每颗星球都有自己的光照范围")).toBeInTheDocument();
    expect(screen.getAllByText("私密核心").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("公开分享轨道").length).toBeGreaterThanOrEqual(1);
  });

  it("renders each v7.3 chapter as a distinct interactive scene", () => {
    render(<GalaxyWorkspace />);

    expect(screen.getByTestId("galaxy-app")).toHaveClass("scene-galaxy");

    fireEvent.click(screen.getByRole("button", { name: "隐私星域" }));
    expect(screen.getByTestId("galaxy-app")).toHaveClass("scene-scope");

    fireEvent.click(screen.getByRole("button", { name: "纪念星域" }));
    expect(screen.getByTestId("galaxy-app")).toHaveClass("scene-memorial");
    expect(screen.getByText("已过世的家人，不会从星系里消失")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "家族传承星云" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "星球工坊" }));
    expect(screen.getByTestId("galaxy-app")).toHaveClass("scene-customize");
    expect(screen.getAllByText("星球工坊").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("家书暖夜")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "应用到当前星域" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "记忆星群" }));
    expect(screen.getByTestId("galaxy-app")).toHaveClass("scene-roam");
    expect(screen.getByText("记忆不是表单，是一颗颗被点亮的星")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新家里的第一个除夕" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "共鸣星轨" }));
    expect(screen.getByTestId("galaxy-app")).toHaveClass("scene-resonance");
    expect(screen.getByText("两颗星球之间，不是合并，而是共鸣")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2018 除夕共鸣星轨" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "主题星云" }));
    expect(screen.getByTestId("galaxy-app")).toHaveClass("scene-themes");
    expect(screen.getByText("选择一种主题，就像进入一片新的星云")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "旅行星云" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "旅行星云" }));
    expect(screen.getByTestId("galaxy-app")).toHaveClass("scene-bookmaker", "nebula-travel");

    fireEvent.click(screen.getByRole("button", { name: "家书工坊" }));
    expect(screen.getByTestId("galaxy-app")).toHaveClass("scene-bookmaker");
    expect(screen.getByText("把星系里的光，整理成一页可以分享的家书")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "生成家书草稿" })).toBeInTheDocument();
  });

  it("lets users complete the demo path from memory to resonance to book share", () => {
    render(<GalaxyWorkspace />);

    fireEvent.click(screen.getByRole("button", { name: "记忆星群" }));
    fireEvent.click(screen.getByRole("button", { name: "新家里的第一个除夕" }));
    expect(screen.getByText("AI 已整理为记忆星：")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "沿共鸣星轨前进" }));
    expect(screen.getByText("两颗星球之间，不是合并，而是共鸣")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "2018 除夕共鸣星轨" }));
    fireEvent.click(screen.getByRole("button", { name: "把这条星轨写成家书" }));
    expect(screen.getByText("把星系里的光，整理成一页可以分享的家书")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "生成家书草稿" }));
    expect(screen.getByText("家书草稿已生成")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "家书工坊" }));
    fireEvent.click(screen.getByRole("button", { name: "分享前确认" }));
    expect(screen.getByRole("dialog", { name: "分享前确认" })).toBeInTheDocument();
  });

  it("opens the planet roaming overlay from the recommended route", () => {
    render(<GalaxyWorkspace />);

    fireEvent.click(screen.getByRole("button", { name: "开始靠近" }));

    expect(screen.getByRole("dialog", { name: "妈妈的星球漫游" })).toBeInTheDocument();
    expect(screen.getAllByText("星球漫游").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("时间轨迹")).toBeInTheDocument();
  });

  it("keeps planet roaming actions inside the immersive galaxy workflow", () => {
    render(<GalaxyWorkspace />);

    fireEvent.click(screen.getByRole("button", { name: "开始靠近" }));
    fireEvent.click(screen.getByRole("button", { name: "星球漫游点亮记忆星" }));

    expect(screen.queryByRole("dialog", { name: "妈妈的星球漫游" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "点亮记忆星" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "关闭面板" }));
    fireEvent.click(screen.getByRole("button", { name: "开始靠近" }));
    fireEvent.click(screen.getByRole("button", { name: "星球漫游写成家书" }));

    expect(screen.queryByRole("dialog", { name: "妈妈的星球漫游" })).not.toBeInTheDocument();
    expect(screen.getByText("把星系里的光，整理成一页可以分享的家书")).toBeInTheDocument();
  });

  it("auto cruise is the default galaxy mode without entering a planet route", () => {
    render(<GalaxyWorkspace />);

    expect(screen.getByTestId("galaxy-app")).toHaveClass("auto-cruise-active", "immersive-ui-active");
    expect(screen.getByTestId("galaxy-app")).not.toHaveClass("planet-roaming-active");
    expect(screen.getByText("自动巡航中 · 星球正在沿轨道漫游")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "妈妈的星球漫游" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "退出沉浸" }));
    expect(screen.getByTestId("galaxy-app")).not.toHaveClass("auto-cruise-active");
  });

  it("supports elder mode and share confirmation", () => {
    render(<GalaxyWorkspace />);

    fireEvent.click(screen.getByRole("button", { name: "长辈大字模式" }));
    expect(screen.getByTestId("galaxy-app")).toHaveClass("elder");

    fireEvent.click(screen.getByRole("button", { name: "家书工坊" }));
    fireEvent.click(screen.getByRole("button", { name: "分享前确认" }));

    expect(screen.getByRole("dialog", { name: "分享前确认" })).toBeInTheDocument();
    expect(screen.getByText("不会公开整颗星球")).toBeInTheDocument();
  });

  it("keeps secondary prototype controls interactive with visible feedback", () => {
    render(<GalaxyWorkspace />);

    fireEvent.click(screen.getByRole("button", { name: "退出沉浸" }));
    fireEvent.click(screen.getAllByRole("button", { name: "自动巡航" })[0]);
    expect(screen.getByText("自动巡航中 · 星球正在沿轨道漫游")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "退出沉浸" }));
    expect(screen.queryByText("自动巡航中 · 星球正在沿轨道漫游")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "星球工坊" }));
    fireEvent.click(screen.getByRole("button", { name: "应用到当前星域" }));
    expect(screen.getByText("星球主题已应用")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "点亮记忆星" }));
    fireEvent.click(screen.getByRole("button", { name: "改用语音" }));
    expect(screen.getByText("语音入口已准备")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "家书工坊" }));
    fireEvent.click(screen.getByRole("button", { name: "分享前确认" }));
    fireEvent.click(screen.getByRole("button", { name: "确认分享" }));
    expect(screen.getByText("分享范围已确认")).toBeInTheDocument();
  });
});
