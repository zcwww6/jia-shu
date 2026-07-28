import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { galaxyZones, planetLinks, planets } from "@/shared/mock/galaxy-data";

import { GalaxyWorkspace } from "./galaxy-workspace";

const renderDemoGalaxy = () => render(<GalaxyWorkspace initialPlanets={planets} initialLinks={planetLinks} />);

describe("GalaxyWorkspace", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("explains that memory consent and public sharing are real per-record flows, not local switches", () => {
    renderDemoGalaxy();

    fireEvent.click(screen.getByRole("button", { name: "进入我的星球漫游" }));
    fireEvent.click(screen.getByRole("button", { name: "设置权限" }));

    expect(screen.getByText(/AI 整理与进入共鸣的授权都在记忆确认步骤逐条完成/)).toBeInTheDocument();
    expect(screen.queryByText("允许 AI 整理")).not.toBeInTheDocument();
    expect(screen.queryByText("允许进入共鸣候选")).not.toBeInTheDocument();
    expect(screen.queryByText("公开原始素材")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "设为公开可见" })).toBeInTheDocument();
  });

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

  it("uses the memorial presentation for a persisted memorial planet in roaming mode", () => {
    render(
      <GalaxyWorkspace
        initialPlanets={[
          {
            id: "server-memorial", name: "外公的星球", type: "parent", lifeState: "memorial", version: 1,
            role: "外公", visibility: "private", theme: "柔紫纪念光", position: { x: 50, y: 40 },
            stats: { memoryStars: 0, resonanceTracks: 0, bookDrafts: 0 }, summary: "一颗被珍重保存的纪念星。",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "进入外公的星球漫游" }));
    fireEvent.click(screen.getByRole("button", { name: "进入星球" }));

    expect(screen.getByRole("dialog", { name: "外公的星球漫游" }).querySelector(".inner-planet-body")).toHaveClass("memorial");
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
    renderDemoGalaxy();

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
    renderDemoGalaxy();

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
    renderDemoGalaxy();

    expect(screen.getByTestId("planet-link-link-me-mom")).toBeInTheDocument();
    expect(screen.getByTestId("planet-link-link-me-grandma-resonance")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "星图编辑" }));
    expect(screen.getByRole("dialog", { name: "星图编辑" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "共鸣线" }));
    expect(screen.queryByTestId("planet-link-link-me-grandma-resonance")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "共鸣线" }));
    expect(screen.getByTestId("planet-link-link-me-grandma-resonance")).toBeInTheDocument();
  });

  it("keeps star-map display filters session-only and does not offer fake relationship edits", () => {
    renderDemoGalaxy();

    fireEvent.click(screen.getByRole("button", { name: "星图编辑" }));

    expect(screen.getByText("显示筛选仅影响本次浏览，不会改写已保存的家庭关系。"))
      .toBeInTheDocument();
    expect(screen.getByText("母女家庭轨道").closest("button")).toBeNull();
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
    fireEvent.click(screen.getByRole("button", { name: "设为公开可见" }));
    await waitFor(() => expect(screen.getByText("当前可见范围：公开可见（不创建链接）")).toBeInTheDocument());
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

  it("uploads a private cover and saves its returned asset ID with a versioned planet PATCH", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/assets" && init?.method === "POST") {
        return new Response(JSON.stringify({
          id: "asset-cover-1",
          planetId: "server-mom",
          kind: "planet_cover",
          visibility: "private",
          mimeType: "image/jpeg",
          sizeBytes: 11,
          originalName: "mom-cover.jpg",
          status: "stored",
          createdAt: "2026-07-28T00:00:00.000Z",
        }), { status: 201 });
      }

      if (url === "/api/planets/server-mom" && init?.method === "PATCH") {
        return new Response(JSON.stringify({
          id: "server-mom", name: "妈妈的星球", type: "parent", lifeState: "active",
          visibility: "family", role: "母亲", theme: "暖橘星环", summary: "服务端妈妈星球。",
          position: { x: 55, y: 35 }, version: 8, coverAssetId: "asset-cover-1",
        }), { status: 200 });
      }

      return new Response(JSON.stringify({ message: `unexpected request ${url}` }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <GalaxyWorkspace
        initialPlanets={[{
          id: "server-mom", name: "妈妈的星球", type: "parent", version: 7, role: "母亲",
          visibility: "family", theme: "暖橘星环", position: { x: 55, y: 35 },
          stats: { memoryStars: 0, resonanceTracks: 0, bookDrafts: 0 }, summary: "服务端妈妈星球。",
        }]}
        initialLinks={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "进入妈妈的星球漫游" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑主题" }));
    const cover = new File(["cover-image"], "mom-cover.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("上传星球封面"), { target: { files: [cover] } });
    fireEvent.click(screen.getByRole("button", { name: "保存星球封面" }));

    await waitFor(() => expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/assets",
      expect.objectContaining({ method: "POST" }),
    ));
    const uploadInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((uploadInit.body as FormData).get("planetId")).toBe("server-mom");
    expect((uploadInit.body as FormData).get("kind")).toBe("planet_cover");
    expect((uploadInit.body as FormData).get("visibility")).toBe("private");
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/planets/server-mom",
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({ "If-Match-Version": "7" }),
        body: JSON.stringify({ version: 7, coverAssetId: "asset-cover-1" }),
      }),
    );
    expect(screen.getByText("星球封面已保存")).toBeInTheDocument();
  });

  it("previews an unsaved photo and theme on the selected planet before saving either one", () => {
    const createObjectURL = vi.fn(() => "blob:planet-cover-preview");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    render(
      <GalaxyWorkspace
        initialPlanets={[{
          id: "server-mom", name: "妈妈的星球", type: "parent", version: 7, role: "母亲",
          visibility: "family", theme: "暖橘星环", position: { x: 55, y: 35 },
          stats: { memoryStars: 0, resonanceTracks: 0, bookDrafts: 0 }, summary: "服务端妈妈星球。",
        }]}
        initialLinks={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "进入妈妈的星球漫游" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑主题" }));
    fireEvent.click(screen.getByRole("button", { name: /深空墨蓝/ }));
    fireEvent.change(screen.getByLabelText("上传星球封面"), {
      target: { files: [new File(["cover-image"], "night-sky.jpg", { type: "image/jpeg" })] },
    });

    expect(screen.getByTestId("workshop-planet-preview")).toHaveAttribute("data-theme", "深空墨蓝");
    expect(screen.getByTestId("workshop-planet-preview")).toHaveStyle({ "--planet-cover": 'url("blob:planet-cover-preview")' });
    expect(screen.getByText("预览未保存")).toBeInTheDocument();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
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

  it("routes planet object actions into theme, privacy, lifecycle, and the guarded book flow", () => {
    renderDemoGalaxy();

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
    fireEvent.click(screen.getByRole("button", { name: "进入家书工坊" }));
    expect(screen.getByText("请先确认一条共鸣星轨，再进入家书工坊。")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "家书光束" })).not.toBeInTheDocument();
  });

  it("opens a story scene from a confirmed memory and does not offer a fictional family invitation", () => {
    render(
      <GalaxyWorkspace
        initialPlanets={planets}
        initialLinks={planetLinks}
        initialConfirmedMemories={[{
          id: "memory-mom-eve", planetId: "mock-mom", title: "新家除夕", occurredAt: "2018",
          location: "新家", people: ["妈妈", "我"], emotions: [], visibility: "family", summary: "全家在新家一起过除夕。",
        }]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "开始靠近" }));
    fireEvent.click(screen.getByRole("button", { name: "打开故事场景：2018 新家除夕" }));

    expect(screen.getByRole("dialog", { name: "新家除夕故事场景" })).toBeInTheDocument();
    expect(screen.getByText("记忆光粒")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "补充一句话" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "加入家书" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "设权限" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "邀请家人" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "设权限" }));

    expect(screen.getByRole("heading", { name: "家庭可见星域" })).toBeInTheDocument();
  });

  it("switches internal screens without leaving the galaxy workspace", () => {
    renderDemoGalaxy();

    fireEvent.click(screen.getByRole("button", { name: "隐私星域" }));

    expect(screen.getByText("每颗星球都有自己的光照范围")).toBeInTheDocument();
    expect(screen.getAllByText("私密核心").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("公开分享轨道").length).toBeGreaterThanOrEqual(1);
  });

  it("renders each v7.3 chapter while keeping the book chapter guarded", () => {
    renderDemoGalaxy();

    expect(screen.getByTestId("galaxy-app")).toHaveClass("scene-galaxy");

    fireEvent.click(screen.getByRole("button", { name: "隐私星域" }));
    expect(screen.getByTestId("galaxy-app")).toHaveClass("scene-scope");

    fireEvent.click(screen.getByRole("button", { name: "纪念星域" }));
    expect(screen.getByTestId("galaxy-app")).toHaveClass("scene-memorial");
    expect(screen.getByText("已过世的家人，不会从星系里消失")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "外婆的纪念星" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "星球工坊" }));
    expect(screen.getByTestId("galaxy-app")).toHaveClass("scene-customize");
    expect(screen.getAllByText("星球工坊").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("家书暖夜")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "应用到当前星域" })).not.toBeInTheDocument();
    expect(screen.getByText("主题会在选择星球后写入数据库。")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "记忆星群" }));
    expect(screen.getByTestId("galaxy-app")).toHaveClass("scene-roam");
    expect(screen.getByText("记忆不是表单，是一颗颗被点亮的星")).toBeInTheDocument();
    expect(screen.getByText("当前还没有已确认的记忆星")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "共鸣星轨" }));
    expect(screen.getByTestId("galaxy-app")).toHaveClass("scene-resonance");
    expect(screen.getByText("暂无待确认的共鸣候选。请从一颗已确认的记忆星发起扫描。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "2018 除夕共鸣星轨" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "主题星云" }));
    expect(screen.getByTestId("galaxy-app")).toHaveClass("scene-themes");
    expect(screen.getByText("选择一种主题，就像进入一片新的星云")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "旅行星云" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "旅行星云" }));
    expect(screen.getByTestId("galaxy-app")).not.toHaveClass("scene-bookmaker");
    expect(screen.getByText("请先确认一条共鸣星轨，再进入家书工坊。")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "家书工坊" }));
    expect(screen.getByTestId("galaxy-app")).not.toHaveClass("scene-bookmaker");
    expect(screen.queryByRole("button", { name: "生成家书草稿" })).not.toBeInTheDocument();
  });

  it("does not let a static resonance scene enter the book workflow", () => {
    renderDemoGalaxy();

    fireEvent.click(screen.getByRole("button", { name: "共鸣星轨" }));
    fireEvent.click(screen.getByRole("button", { name: "家书工坊" }));

    expect(screen.getByText("请先确认一条共鸣星轨，再进入家书工坊。")).toBeInTheDocument();
    expect(screen.getByTestId("galaxy-app")).not.toHaveClass("scene-bookmaker");
    expect(screen.queryByText("我们家的第一个新房除夕")).not.toBeInTheDocument();
  });

  it("opens the planet roaming overlay from the recommended route", () => {
    renderDemoGalaxy();

    fireEvent.click(screen.getByRole("button", { name: "开始靠近" }));

    expect(screen.getByRole("dialog", { name: "妈妈的星球漫游" })).toBeInTheDocument();
    expect(screen.getAllByText("星球漫游").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("时间轨迹")).toBeInTheDocument();
  });

  it("keeps planet roaming actions inside the immersive galaxy workflow", () => {
    renderDemoGalaxy();

    fireEvent.click(screen.getByRole("button", { name: "开始靠近" }));
    fireEvent.click(screen.getByRole("button", { name: "星球漫游点亮记忆星" }));

    expect(screen.queryByRole("dialog", { name: "妈妈的星球漫游" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "点亮记忆星" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "关闭面板" }));
    fireEvent.click(screen.getByRole("button", { name: "开始靠近" }));
    fireEvent.click(screen.getByRole("button", { name: "星球漫游写成家书" }));

    expect(screen.getByRole("dialog", { name: "妈妈的星球漫游" })).toBeInTheDocument();
    expect(screen.getByText("请先确认一条共鸣星轨，再进入家书工坊。")).toBeInTheDocument();
  });

  it("auto cruise is the default galaxy mode without entering a planet route", () => {
    renderDemoGalaxy();

    expect(screen.getByTestId("galaxy-app")).toHaveClass("auto-cruise-active", "immersive-ui-active");
    expect(screen.getByTestId("galaxy-app")).not.toHaveClass("planet-roaming-active");
    expect(screen.getByText("自动巡航中 · 星球正在沿轨道漫游")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "妈妈的星球漫游" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "退出沉浸" }));
    expect(screen.getByTestId("galaxy-app")).not.toHaveClass("auto-cruise-active");
  });

  it("supports elder mode without exposing share confirmation before resonance confirmation", () => {
    renderDemoGalaxy();

    fireEvent.click(screen.getByRole("button", { name: "长辈大字模式" }));
    expect(screen.getByTestId("galaxy-app")).toHaveClass("elder");

    fireEvent.click(screen.getByRole("button", { name: "家书工坊" }));
    expect(screen.getByText("请先确认一条共鸣星轨，再进入家书工坊。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "分享前确认" })).not.toBeInTheDocument();
  });

  it("keeps secondary browsing controls interactive without pretending they are saved", () => {
    renderDemoGalaxy();

    fireEvent.click(screen.getByRole("button", { name: "退出沉浸" }));
    fireEvent.click(screen.getAllByRole("button", { name: "自动巡航" })[0]);
    expect(screen.getByText("自动巡航中 · 星球正在沿轨道漫游")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "退出沉浸" }));
    expect(screen.queryByText("自动巡航中 · 星球正在沿轨道漫游")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "星球工坊" }));
    expect(screen.queryByRole("button", { name: "应用到当前星域" })).not.toBeInTheDocument();
    expect(screen.getByText("主题会在选择星球后写入数据库。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "预览该星域" }));
    expect(screen.getByTestId("galaxy-app")).toHaveClass("scene-galaxy");

    fireEvent.click(screen.getByRole("button", { name: "点亮记忆星" }));
    fireEvent.change(screen.getByLabelText("选择记忆来源"), { target: { value: "audio" } });
    const voice = new File(["voice"], "family-story.m4a", { type: "audio/mp4" });
    fireEvent.change(screen.getByLabelText("上传语音"), { target: { files: [voice] } });
    expect(screen.getByText("已选择：family-story.m4a")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "家书工坊" }));
    expect(screen.getByText("请先确认一条共鸣星轨，再进入家书工坊。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认分享" })).not.toBeInTheDocument();
  });
});
