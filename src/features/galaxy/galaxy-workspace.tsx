"use client";

import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BookOpen,
  Compass,
  Clock3,
  Edit3,
  Eye,
  EyeOff,
  GitBranch,
  Link2,
  LockKeyhole,
  Minus,
  Palette,
  Plus,
  RotateCcw,
  ScanLine,
  Sparkles,
  Trash2,
  Type,
  X,
} from "lucide-react";

import {
  bookDrafts,
  galaxyZones,
  memoryStars,
  planetLinks,
  planets,
  resonanceTracks,
  storyNodes,
} from "@/shared/mock/galaxy-data";
import { demoSession } from "@/shared/mock/demo-session";
import {
  getPlanetPresentationType,
  type BookGenerateResponse,
  type GalaxyZoneKey,
  type MemoryExtractResponse,
  type MemoryStar,
  type Planet,
  type PlanetLink,
  type PlanetLinkKind,
  type ResonanceScanResponse,
} from "@/shared/types/galaxy";

import {
  appendLitMemory,
  readGalaxyBookResult,
  readGalaxyExtractResult,
  readGalaxyResonanceResult,
  readLitMemories,
  writeGalaxyBookResult,
  writeGalaxyExtractResult,
  writeGalaxyResonanceResult,
  writeGalaxySharePayload,
} from "@/features/demo-loop/storage";
import {
  extractMemory,
  generateBook,
  publishBook,
  scanResonance,
  useLoopApi,
} from "./use-loop-api";
import {
  archiveLegacyPlanet,
  createLegacyPlanet,
  createLegacyRelationship,
  restoreLegacyPlanet,
  updateLegacyPlanet,
  type LegacyManagedPlanet,
  type LegacyPlanetUpdate,
} from "./legacy-galaxy-api";

interface GalaxyView {
  panX: number;
  panY: number;
  zoom: number;
  rotate: number;
}

type PanelKey =
  | "me"
  | "mom"
  | "dad"
  | "child"
  | "friend"
  | "grandpa"
  | "legacy"
  | "scopePrivate"
  | "scopeFamily"
  | "scopePublic"
  | "memory1"
  | "memory2"
  | "memory3"
  | "memory4"
  | "resonance"
  | "book"
  | "privacy"
  | "lifecycle"
  | "quickRecord"
  | "shareConfirm";

type LegacyPlanetChanges = Omit<LegacyPlanetUpdate, "id" | "version">;

const initialView: GalaxyView = {
  panX: 0,
  panY: 0,
  zoom: 1,
  rotate: 0,
};

const routeSteps: Array<{
  label: string;
  detail: string;
  action: "planet" | PanelKey;
}> = [
  {
    label: "靠近妈妈的星球",
    detail: "查看她的记忆、星轨和可生成的家书线索",
    action: "planet",
  },
  {
    label: "点开春节记忆星",
    detail: "一段饭桌和全家福的记忆正在发光",
    action: "memory1",
  },
  {
    label: "沿共鸣星轨前进",
    detail: "AI 发现两颗星球记住了同一天",
    action: "resonance",
  },
  {
    label: "写成一页家书",
    detail: "只基于已确认记忆，分享前仍需确认",
    action: "book",
  },
];

const planetClassByType: Record<Planet["type"], string> = {
  self: "planet me private-planet has-ring",
  parent: "planet mom has-ring",
  child: "planet child has-ring",
  memorial: "planet ancestor memorial-planet has-ring",
  public: "planet friend public-planet",
  partner: "planet friend has-ring",
  other: "planet friend has-ring",
};

const planetBadgeByType: Record<Planet["type"], string> = {
  self: "我",
  parent: "亲",
  child: "长",
  memorial: "念",
  public: "旅",
  partner: "伴",
  other: "他",
};

const planetLinkKindLabels: Record<PlanetLinkKind, string> = {
  family: "家庭线",
  resonance: "共鸣线",
  inheritance: "传承线",
  privacy: "权限线",
  public: "公开线",
  custom: "自定义线",
};

const planetLinkKindClassName: Record<PlanetLinkKind, string> = {
  family: "link-family",
  resonance: "link-resonance",
  inheritance: "link-ancestor",
  privacy: "link-private",
  public: "link-public",
  custom: "link-custom",
};

type MemoryPanelKey = "memory1" | "memory2" | "memory3" | "memory4";

const memoryPanelContent: Record<
  MemoryPanelKey,
  { title: string; tags: string[]; body: string; assist: string }
> = {
  memory1: {
    title: "新家里的第一个除夕",
    tags: ["可参与共鸣", "2018 除夕", "全家福"],
    body: "那年第一次在新房里过年。妈妈忙了一整天，最后在客厅拍了一张合照。",
    assist: "时间、地点、人物和情绪已提取，可继续进入共鸣星轨。",
  },
  memory2: {
    title: "生日卡片",
    tags: ["2020", "感动"],
    body: "孩子第一次亲手做了生日卡片，妈妈说这是那年最好的礼物。",
    assist: "这颗记忆星适合进入亲子成长星云，也可以补一句妈妈当时的反应。",
  },
  memory3: {
    title: "云南旅行",
    tags: ["旅行星云", "2024"],
    body: "退休后最放松的一次旅行。爸爸记得路线，妈妈记得阳光，孩子记得山风。",
    assist: "这段记忆适合旅行星云，照片优先，地点线索清晰。",
  },
  memory4: {
    title: "外婆的菜谱",
    tags: ["传承记忆", "春节"],
    body: "妈妈说，这道菜是外婆每年春节都会做的味道。",
    assist: "这段记忆连接纪念星域，适合做家族传承页。",
  },
};

const sceneClassByZone: Record<GalaxyZoneKey, string> = {
  galaxy: "scene-galaxy",
  privacy: "scene-scope",
  memorial: "scene-memorial",
  workshop: "scene-customize",
  memories: "scene-roam",
  resonance: "scene-resonance",
  themes: "scene-themes",
  books: "scene-bookmaker",
};

const nebulaClassByTheme: Record<string, string> = {
  家庭团圆: "nebula-family",
  父母人生: "nebula-parent",
  亲子成长: "nebula-child",
  纪念星册: "nebula-memorial",
  旅行星云: "nebula-travel",
  伴侣星云: "nebula-couple",
};

const zoneContent: Record<
  GalaxyZoneKey,
  {
    title: string;
    eyebrow: string;
    body: string;
    tags: string[];
  }
> = {
  galaxy: {
    title: "家庭星系操作台",
    eyebrow: "我的星系",
    body: "这里不是传统功能菜单，而是一片可以拖拽、缩放、靠近的家庭星系。第一次进入时，推荐航线会引导用户完成从漫游到家书的闭环。",
    tags: ["推荐航线", "星球漫游", "Mock 数据"],
  },
  privacy: {
    title: "隐私星域",
    eyebrow: "分享边界",
    body: "私密核心、家庭可见和公开分享是三层不同轨道。AI 只点亮候选连接，分享前必须由用户确认范围。",
    tags: ["私密核心", "家庭可见", "公开分享轨道"],
  },
  memorial: {
    title: "纪念星域",
    eyebrow: "传承星云",
    body: "纪念星以克制语气保存来源、时间和家人寄语。它可以被写入纪念星册，但不会默认公开整颗星球。",
    tags: ["纪念星", "传承记忆", "克制叙事"],
  },
  workshop: {
    title: "星球工坊",
    eyebrow: "个人主题",
    body: "星球材质、星环、主题色和故事节点密度都属于表达层配置。MVP 阶段先保留 Mock 主题，不做复杂保存。",
    tags: ["星球材质", "个人星环", "主题实验"],
  },
  memories: {
    title: "记忆星群",
    eyebrow: "点亮记忆星",
    body: "记忆以发光节点进入星系。表单只作为轻量入口，真正的浏览和补充发生在星球漫游中。",
    tags: ["一句话录入", "AI 整理候选", "补充视角"],
  },
  resonance: {
    title: "共鸣星轨",
    eyebrow: "候选连接",
    body: "当两颗星球记住同一天，系统点亮共鸣星轨。用户确认后，来源记忆才会进入家书工坊。",
    tags: ["同一天", "来源对比", "用户确认"],
  },
  themes: {
    title: "主题星云",
    eyebrow: "写作模板",
    body: "家庭团圆、父母人生、亲子成长、纪念星册、旅行星云和伴侣星云是当前家书生成的主题入口。",
    tags: ["家庭团圆", "旅行星云", "纪念星册"],
  },
  books: {
    title: "家书工坊",
    eyebrow: "成果物",
    body: "家书是一段漫游后的成果物，支持单星球、双星系、家庭星系和纪念星来源范围。分享前必须再次确认。",
    tags: ["一页家书", "sourceMemoryIds", "分享前确认"],
  },
};

function toVisualPlanet(result: LegacyManagedPlanet, fallback: Planet): Planet {
  return {
    ...fallback,
    id: result.id,
    name: result.name,
    type: result.type,
    lifeState: result.lifeState,
    visibility: result.visibility,
    role: result.role ?? fallback.role,
    theme: result.theme ?? fallback.theme,
    summary: result.summary ?? fallback.summary,
    position: {
      x: result.position.x ?? fallback.position.x,
      y: result.position.y ?? fallback.position.y,
    },
    version: result.version,
    coverAssetId: result.coverAssetId,
  };
}

export function GalaxyWorkspace({
  initialPlanets = planets,
  initialLinks = planetLinks,
  initialArchivedPlanets = [],
}: {
  initialPlanets?: Planet[];
  initialLinks?: PlanetLink[];
  initialArchivedPlanets?: Planet[];
}) {
  const [activeZone, setActiveZone] = useState<GalaxyZoneKey>("galaxy");
  const [activeRouteStep, setActiveRouteStep] = useState(0);
  const [activePanel, setActivePanel] = useState<PanelKey | null>(null);
  const [roamingPlanetId, setRoamingPlanetId] = useState<string | null>(null);
  const [selectedPlanetId, setSelectedPlanetId] = useState<string | null>(null);
  const [closingPlanetId, setClosingPlanetId] = useState<string | null>(null);
  const [bookBeamPlanet, setBookBeamPlanet] = useState<Planet | null>(null);
  const [layerDockPinned, setLayerDockPinned] = useState(false);
  const [elderMode, setElderMode] = useState(false);
  const [immersiveMode, setImmersiveMode] = useState(true);
  const [autoCruise, setAutoCruise] = useState(true);
  const [routeCollapsed, setRouteCollapsed] = useState(true);
  const [selectedWorkshopZone, setSelectedWorkshopZone] = useState<GalaxyZoneKey>("galaxy");
  const [selectedWorkshopBg, setSelectedWorkshopBg] = useState("家书暖夜");
  const [selectedWorkshopMaterial, setSelectedWorkshopMaterial] = useState("柔光釉面");
  const [selectedTheme, setSelectedTheme] = useState("家庭团圆");
  const [renamePlanetTarget, setRenamePlanetTarget] = useState<Planet | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [bookGenerated, setBookGenerated] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [view, setView] = useState<GalaxyView>(initialView);
  const [isDragging, setIsDragging] = useState(false);
  const [galaxyPlanets, setGalaxyPlanets] = useState<Planet[]>(initialPlanets);
  const [hiddenPlanetIds, setHiddenPlanetIds] = useState<string[]>([]);
  const [archivedPlanets, setArchivedPlanets] = useState<Planet[]>(initialArchivedPlanets);
  const [galaxyLinks, setGalaxyLinks] = useState<PlanetLink[]>(initialLinks);
  const [visibleLinkKinds, setVisibleLinkKinds] = useState<PlanetLinkKind[]>([
    "family",
    "resonance",
    "inheritance",
    "privacy",
    "public",
    "custom",
  ]);
  const [starMapEditorOpen, setStarMapEditorOpen] = useState(false);
  const dragStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  // 星系内闭环真实数据（接 /api/*），初值从 localStorage 读取以支持刷新存活。
  const [quickRecordContent, setQuickRecordContent] = useState(
    "2018 年除夕，妈妈在新房里忙了一整天，最后全家人拍了一张合照。",
  );
  const [extractResult, setExtractResult] = useState<MemoryExtractResponse | null>(
    () => readGalaxyExtractResult(),
  );
  const [resonanceResult, setResonanceResult] = useState<ResonanceScanResponse | null>(
    () => readGalaxyResonanceResult(),
  );
  const [bookResult, setBookResult] = useState<BookGenerateResponse | null>(
    () => readGalaxyBookResult(),
  );
  const [litMemories, setLitMemories] = useState<MemoryStar[]>(() => readLitMemories());
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const loopApi = useLoopApi();

  const activeZoneContent = zoneContent[activeZone];
  const visiblePlanets = useMemo(
    () => galaxyPlanets.filter((planet) => !hiddenPlanetIds.includes(planet.id)),
    [galaxyPlanets, hiddenPlanetIds],
  );
  const visiblePlanetIds = useMemo(() => new Set(visiblePlanets.map((planet) => planet.id)), [visiblePlanets]);
  const visibleLinks = useMemo(
    () =>
      galaxyLinks.filter(
        (link) =>
          link.status !== "hidden" &&
          visibleLinkKinds.includes(link.kind) &&
          visiblePlanetIds.has(link.sourcePlanetId) &&
          visiblePlanetIds.has(link.targetPlanetId),
      ),
    [galaxyLinks, visibleLinkKinds, visiblePlanetIds],
  );
  const hiddenPlanets = archivedPlanets;
  const anchorPlanetIds = useMemo(() => {
    const selfPlanet = galaxyPlanets.find((planet) => planet.type === "self");
    const parentPlanet = galaxyPlanets.find((planet) => planet.type === "parent");
    const memorialPlanet = galaxyPlanets.find((planet) => planet.type === "memorial");
    const publicPlanet = galaxyPlanets.find((planet) => planet.type === "public");
    const firstPlanet = galaxyPlanets[0] ?? null;
    const firstNonSelfPlanet = galaxyPlanets.find((planet) => planet.type !== "self") ?? null;

    return {
      self: selfPlanet?.id ?? firstPlanet?.id ?? null,
      parent: parentPlanet?.id ?? firstNonSelfPlanet?.id ?? firstPlanet?.id ?? null,
      memorial: memorialPlanet?.id ?? parentPlanet?.id ?? firstNonSelfPlanet?.id ?? firstPlanet?.id ?? null,
      public: publicPlanet?.id ?? parentPlanet?.id ?? firstNonSelfPlanet?.id ?? firstPlanet?.id ?? null,
    };
  }, [galaxyPlanets]);
  const selectedPlanet = galaxyPlanets.find((planet) => planet.id === selectedPlanetId) ?? null;
  const roamingPlanet = galaxyPlanets.find((planet) => planet.id === roamingPlanetId) ?? null;

  const galaxyStyle = useMemo(
    () =>
      ({
        "--pan-x": `${view.panX}px`,
        "--pan-y": `${view.panY}px`,
        "--zoom": view.zoom,
        "--rotate": `${view.rotate}deg`,
      }) as React.CSSProperties,
    [view],
  );

  const appClassName = [
    "app",
    sceneClassByZone[activeZone],
    nebulaClassByTheme[selectedTheme] ?? "nebula-family",
    elderMode ? "elder" : "",
    immersiveMode ? "immersive-ui-active" : "",
    autoCruise ? "auto-cruise-active" : "",
    roamingPlanet ? "planet-roaming-active" : "",
    selectedPlanetId ? "planet-focus-active" : "",
    starMapEditorOpen ? "star-map-editor-active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  function focusPlanet(planetId: string) {
    const planet = galaxyPlanets.find((item) => item.id === planetId);
    if (!planet) return;

    setActiveZone("galaxy");
    setView({
      panX: (50 - planet.position.x) * 8,
      panY: (50 - planet.position.y) * 6,
      zoom: 1.25,
      rotate: view.rotate,
    });
  }

  function focusAnchorPlanet(planetId: string | null) {
    if (!planetId) return;
    focusPlanet(planetId);
  }

  function openAnchorPlanet(planetId: string | null) {
    if (!planetId) return;
    setSelectedPlanetId(null);
    setClosingPlanetId(null);
    setRoamingPlanetId(planetId);
    setActivePanel(null);
  }

  function runRouteStep(index: number) {
    const step = routeSteps[index];
    setActiveRouteStep(index);
    setSelectedPlanetId(null);
    setClosingPlanetId(null);
    setBookBeamPlanet(null);

    if (step.action === "planet") {
      focusAnchorPlanet(anchorPlanetIds.parent);
      openAnchorPlanet(anchorPlanetIds.parent);
      return;
    }

    setRoamingPlanetId(null);
    setActivePanel(step.action);
    if (step.action === "resonance") setActiveZone("resonance");
    if (step.action === "book") setActiveZone("books");
  }

  function openPanel(key: PanelKey) {
    setActivePanel(key);
    setRoamingPlanetId(null);
    setSelectedPlanetId(null);
    setClosingPlanetId(null);
    setBookBeamPlanet(null);
  }

  function goToZone(zone: GalaxyZoneKey) {
    setActiveZone(zone);
    setActivePanel(null);
    setRoamingPlanetId(null);
    setSelectedPlanetId(null);
    setClosingPlanetId(null);
    setBookBeamPlanet(null);
  }

  function selectThemeFromNebula(theme: string) {
    setSelectedTheme(theme);
    setActiveZone("books");
    setActivePanel(null);
    setToast(`已带入「${theme}」`);
  }

  async function lightMemoryStar() {
    const content = quickRecordContent.trim();
    if (content.length === 0) {
      setToast("先写下一句话，再点亮记忆星");
      return;
    }

    const result = await loopApi.run(() =>
      extractMemory({
        planetId: demoSession.defaultPlanetId,
        visibility: "family",
        content,
      }),
    );

    if (!result) {
      setToast(loopApi.error ?? "AI 整理失败，请稍后重试");
      return;
    }

    setExtractResult(result);
    writeGalaxyExtractResult(result);
    setLitMemories(appendLitMemory(result.memory));

    setActivePanel("memory1");
    setActiveZone("memories");
    setSelectedPlanetId(null);
    setClosingPlanetId(null);
    setToast("已点亮为记忆星，默认不公开");
  }

  async function scanResonanceStar() {
    const memoryId = extractResult?.memory.id ?? memoryStars[0].id;
    const result = await loopApi.run(() => scanResonance(memoryId));
    if (!result) {
      setToast(loopApi.error ?? "共鸣扫描失败，请稍后重试");
      return false;
    }
    setResonanceResult(result);
    writeGalaxyResonanceResult(result);
    return true;
  }

  async function generateBookDraft() {
    // 乐观反馈：先标记已生成，再用真实响应丰富内容（失败时回落静态草稿）。
    setBookGenerated(true);
    const sourceMemoryIds =
      resonanceResult?.candidate.sourceMemoryIds ?? bookDrafts[0].sourceMemoryIds;
    const result = await loopApi.run(() =>
      generateBook({
        sourceMemoryIds,
        sourceRange: "binary_system",
        themeTemplateKey: "family_reunion",
      }),
    );
    if (!result) {
      setToast(loopApi.error ?? "家书生成失败，请稍后重试");
      return false;
    }
    setBookResult(result);
    writeGalaxyBookResult(result);
    return true;
  }

  async function confirmShare() {
    const share = {
      showBody: true,
      showSourceTitles: true,
      showOriginalText: false,
    };
    writeGalaxySharePayload(share);

    // 没有已生成的家书时，仅确认分享范围（演示降级路径），不发布链接。
    if (!bookResult) {
      setToast("分享范围已确认");
      return;
    }

    const published = await loopApi.run(() =>
      publishBook({
        draft: bookResult.draft,
        body: bookResult.body,
        sections: bookResult.sections,
        share,
      }),
    );
    if (!published) {
      setToast(loopApi.error ?? "家书发布失败，请稍后重试");
      return;
    }
    setShareUrl(published.url);
    setToast("分享链接已生成，可复制打开");
  }

  function selectPlanet(planetId: string) {
    if (hiddenPlanetIds.includes(planetId)) return;

    if (selectedPlanetId === planetId) {
      setClosingPlanetId(planetId);
      setSelectedPlanetId(null);
      setActivePanel(null);
      setRoamingPlanetId(null);
      setBookBeamPlanet(null);
      window.setTimeout(() => {
        setClosingPlanetId((current) => (current === planetId ? null : current));
      }, 1320);
      return;
    }

    focusPlanet(planetId);
    setClosingPlanetId(null);
    setSelectedPlanetId(planetId);
    setActivePanel(null);
    setRoamingPlanetId(null);
    setBookBeamPlanet(null);
  }

  function openSelectedPlanet(planetId: string | null) {
    if (!planetId) return;

    setSelectedPlanetId(null);
    setClosingPlanetId(null);
    setRoamingPlanetId(planetId);
    setActivePanel(null);
  }

  async function persistPlanetChange(planet: Planet, changes: LegacyPlanetChanges) {
    if (planet.version === undefined) {
      setToast("这颗演示星球尚未保存，无法同步设置");
      return false;
    }

    try {
      const updated = await updateLegacyPlanet({ id: planet.id, version: planet.version, ...changes });
      const persistedPlanet = toVisualPlanet(updated, planet);

      setGalaxyPlanets((current) => current.map((item) => (item.id === planet.id ? persistedPlanet : item)));
      setToast(`已同步「${persistedPlanet.name}」的星球设置`);
      return true;
    } catch (error) {
      setToast(error instanceof Error ? error.message : "保存星球设置失败，请稍后重试");
      return false;
    }
  }

  function editPlanetTheme(planetId: string) {
    const planet = galaxyPlanets.find((item) => item.id === planetId);
    if (!planet) return;

    setSelectedPlanetId(planetId);
    setClosingPlanetId(null);
    setActiveZone("workshop");
    setActivePanel(null);
    setRoamingPlanetId(null);
    setSelectedWorkshopBg(planet.theme);
    setToast("星球主题实验室已就近展开");
  }

  function configurePlanetPrivacy(planet: Planet) {
    setActiveZone("privacy");
    setSelectedPlanetId(planet.id);
    setClosingPlanetId(null);
    setRoamingPlanetId(null);
    if (planet.type === "self") setActivePanel("scopePrivate");
    else if (planet.type === "public") setActivePanel("scopePublic");
    else setActivePanel("scopeFamily");
  }

  function openPlanetLifecycle(planetId: string) {
    setSelectedPlanetId(planetId);
    setClosingPlanetId(null);
    setActivePanel("lifecycle");
    setRoamingPlanetId(null);
  }

  function generateBookFromPlanet(planet: Planet) {
    setSelectedPlanetId(planet.id);
    setClosingPlanetId(null);
    setActivePanel(null);
    setRoamingPlanetId(null);
    setBookBeamPlanet(planet);
    setToast(`已选中「${planet.name}」的记忆星`);
  }

  function renamePlanet(planet: Planet) {
    setSelectedPlanetId(planet.id);
    setClosingPlanetId(null);
    setRenamePlanetTarget(planet);
    setRenameDraft(planet.name);
  }

  async function savePlanetName() {
    if (!renamePlanetTarget) return;

    const name = renameDraft.trim();
    if (!name) {
      setToast("请先填写星球名称");
      return;
    }

    if (await persistPlanetChange(renamePlanetTarget, { name })) {
      setRenamePlanetTarget(null);
    }
  }

  async function addFamilyPlanet() {
    const nextIndex = galaxyPlanets.filter((planet) => planet.name.startsWith("新家庭星球 ")).length + 1;
    const basePosition = [
      { x: 24, y: 58 },
      { x: 84, y: 55 },
      { x: 42, y: 72 },
      { x: 58, y: 24 },
    ][(nextIndex - 1) % 4];
    const newPlanet: Planet = {
      id: `pending-family-planet-${Date.now()}`,
      name: `新家庭星球 ${nextIndex}`,
      type: "partner",
      role: "待命名星球",
      visibility: "family",
      theme: "新生星环",
      position: basePosition,
      stats: { memoryStars: 0, resonanceTracks: 0, bookDrafts: 0 },
      summary: "一颗刚加入星系的家庭星球，可继续编辑主题、权限和连接线。",
    };
    const anchorPlanet = galaxyPlanets.find((planet) => planet.id === anchorPlanetIds.self) ?? galaxyPlanets[0];

    try {
      const created = await createLegacyPlanet({
        name: newPlanet.name,
        type: "partner",
        lifeState: "active",
        visibility: "family",
        role: newPlanet.role,
        theme: newPlanet.theme,
        summary: newPlanet.summary,
        position: basePosition,
      });
      const persistedPlanet = toVisualPlanet(created, newPlanet);

      setGalaxyPlanets((current) => [...current, persistedPlanet]);
      setHiddenPlanetIds((current) => current.filter((id) => id !== persistedPlanet.id));
      setSelectedPlanetId(persistedPlanet.id);
      setClosingPlanetId(null);
      setStarMapEditorOpen(true);

      if (!anchorPlanet) {
        setToast(`已保存「${persistedPlanet.name}」`);
        return;
      }

      try {
        const relationship = await createLegacyRelationship({
          sourcePlanetId: anchorPlanet.id,
          targetPlanetId: persistedPlanet.id,
          relationshipType: "other",
          label: "手动新增星轨",
          visibility: "family",
        });

        setGalaxyLinks((current) => [
          ...current,
          {
            id: relationship.id,
            sourcePlanetId: relationship.sourcePlanetId,
            targetPlanetId: relationship.targetPlanetId,
            kind: "custom",
            status: "confirmed",
            label: relationship.label ?? "手动新增星轨",
            visibility: relationship.visibility,
            strength: 1,
            rule: "manual",
          },
        ]);
        setToast(`已保存「${persistedPlanet.name}」并连接到家庭星系`);
      } catch (error) {
        setToast(error instanceof Error ? `星球已保存，但连接未完成：${error.message}` : "星球已保存，但连接未完成");
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : "新增星球失败，请稍后重试");
    }
  }

  async function archivePlanetFromGalaxy(planetId: string) {
    const planet = galaxyPlanets.find((item) => item.id === planetId);
    if (!planet) return;

    if (planet.version === undefined) {
      setToast("这颗演示星球尚未保存，登录后创建的家人星球才能归档");
      return;
    }

    try {
      const archived = await archiveLegacyPlanet(planetId, planet.version);
      const archivedPlanet = { ...planet, version: archived.version };

      setArchivedPlanets((current) => [
        ...current.filter((item) => item.id !== planetId),
        archivedPlanet,
      ]);
      setGalaxyPlanets((current) => current.filter((item) => item.id !== planetId));
      setHiddenPlanetIds((current) => (current.includes(planetId) ? current : [...current, planetId]));
      setSelectedPlanetId(null);
      setClosingPlanetId(null);
      setRoamingPlanetId((current) => (current === planetId ? null : current));
      setBookBeamPlanet((current) => (current?.id === planetId ? null : current));
      setToast(`已归档「${planet.name}」，可在星图编辑中恢复`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "归档星球失败，请稍后重试");
    }
  }

  async function hidePlanet(planetId: string) {
    await archivePlanetFromGalaxy(planetId);
  }

  async function restorePlanet(planetId: string) {
    const planet = archivedPlanets.find((item) => item.id === planetId);
    if (!planet || planet.version === undefined) {
      setToast("找不到可恢复的已归档星球");
      return;
    }

    try {
      const restored = await restoreLegacyPlanet(planetId, planet.version);
      setGalaxyPlanets((current) => {
        const restoredPlanet = { ...planet, version: restored.version };
        return current.some((item) => item.id === planetId)
          ? current.map((item) => (item.id === planetId ? restoredPlanet : item))
          : [...current, restoredPlanet];
      });
      setArchivedPlanets((current) => current.filter((item) => item.id !== planetId));
      setHiddenPlanetIds((current) => current.filter((id) => id !== planetId));
      setSelectedPlanetId(planet.id);
      focusPlanet(planet.id);
      setToast(`「${planet.name}」已恢复到家庭星系`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "恢复星球失败，请稍后重试");
    }
  }

  async function removePlanet(planetId: string) {
    await archivePlanetFromGalaxy(planetId);
  }

  function toggleLinkKind(kind: PlanetLinkKind) {
    setVisibleLinkKinds((current) =>
      current.includes(kind) ? current.filter((item) => item !== kind) : [...current, kind],
    );
  }

  function toggleLinkVisibility(linkId: string) {
    setGalaxyLinks((current) =>
      current.map((link) =>
        link.id === linkId
          ? { ...link, status: link.status === "hidden" ? "confirmed" : "hidden" }
          : link,
      ),
    );
  }

  async function addCustomLinkFromSelected() {
    if (!selectedPlanet) {
      setToast("请先点选一颗星球，再添加自定义星轨");
      return;
    }

    const targetPlanet =
      visiblePlanets.find((planet) => planet.id !== selectedPlanet.id && planet.type === "parent") ??
      visiblePlanets.find((planet) => planet.id !== selectedPlanet.id);

    if (!targetPlanet) {
      setToast("至少需要两颗可见星球才能连接");
      return;
    }

    const existingLink = galaxyLinks.find(
      (link) =>
        link.kind === "custom" &&
        ((link.sourcePlanetId === selectedPlanet.id && link.targetPlanetId === targetPlanet.id) ||
          (link.sourcePlanetId === targetPlanet.id && link.targetPlanetId === selectedPlanet.id)),
    );

    if (existingLink) {
      setToast("这两颗星球已经存在自定义星轨");
      return;
    }

    try {
      const relationship = await createLegacyRelationship({
        sourcePlanetId: selectedPlanet.id,
        targetPlanetId: targetPlanet.id,
        relationshipType: "other",
        label: "手动配置星轨",
        visibility: "family",
      });

      setGalaxyLinks((current) => [
        ...current,
        {
          id: relationship.id,
          sourcePlanetId: relationship.sourcePlanetId,
          targetPlanetId: relationship.targetPlanetId,
          kind: "custom",
          status: "confirmed",
          label: relationship.label ?? "手动配置星轨",
          visibility: relationship.visibility,
          strength: 1,
          rule: "manual",
        },
      ]);
      setToast(`已连接「${selectedPlanet.name}」和「${targetPlanet.name}」`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "创建星轨失败，请稍后重试");
    }
  }

  function toggleAutoCruise() {
    if (autoCruise) {
      setAutoCruise(false);
      setImmersiveMode(false);
      setToast("自动巡航已停止");
      return;
    }

    setAutoCruise(true);
    setImmersiveMode(true);
    setRouteCollapsed(true);
    setActivePanel(null);
    setRoamingPlanetId(null);
    setBookBeamPlanet(null);
    setToast("自动巡航已启动，星球开始沿轨道漫游");
  }

  function exitImmersiveMode() {
    setAutoCruise(false);
    setImmersiveMode(false);
    setRoamingPlanetId(null);
    setBookBeamPlanet(null);
  }

  return (
    <main className={`${appClassName} ${layerDockPinned ? "layer-dock-pinned" : ""}`} data-testid="galaxy-app">
      <div className="stars" />

      <aside className="galaxy-sidebar layer-sidebar">
        <div className="brand">
          <span className="logo" />
          <div>
            <h1>我的星系</h1>
            <p>Jia Shu Planet v7.3</p>
          </div>
        </div>

        <label className="mobile-nav-label" htmlFor="mobile-zone">
          星域
        </label>
        <select
          className="mobile-nav"
          id="mobile-zone"
          value={activeZone}
          onChange={(event) => setActiveZone(event.target.value as GalaxyZoneKey)}
        >
          {galaxyZones.map((zone) => (
            <option key={zone.key} value={zone.key}>
              {zone.label}
            </option>
          ))}
        </select>

        <p className="nav-label">星系图层</p>
        <nav aria-label="星系图层">
          {galaxyZones.map((zone) => (
            <button
              aria-label={zone.label}
              className={`nav-btn ${activeZone === zone.key ? "active" : ""}`}
              key={zone.key}
              onClick={() => {
                setActiveZone(zone.key);
                setActivePanel(zone.key === "privacy" ? "privacy" : null);
                setRoamingPlanetId(null);
                setSelectedPlanetId(null);
              }}
              type="button"
            >
              {zone.label}
            </button>
          ))}
        </nav>

        <div className="legend">
          <h3>对象权限层</h3>
          <div className="legend-row">
            <i className="dot private-dot" />
            私密核心
          </div>
          <div className="legend-row">
            <i className="dot family-dot" />
            家庭可见
          </div>
          <div className="legend-row">
            <i className="dot public-dot" />
            公开分享
          </div>
          <div className="legend-row">
            <i className="dot memorial-dot" />
            纪念星
          </div>
        </div>
        <div className="layer-tools">
          <button
            className={`layer-tool ${elderMode ? "active" : ""}`}
            onClick={() => setElderMode((current) => !current)}
            type="button"
          >
            <Type size={15} />
            长辈大字模式
          </button>
          <button className="layer-tool" onClick={() => setRouteCollapsed((current) => !current)} type="button">
            <Sparkles size={15} />
            推荐航线
          </button>
        </div>
      </aside>

      <section
        className={`space interactive-space ${isDragging ? "dragging" : ""}`}
        onDoubleClick={() => focusAnchorPlanet(anchorPlanetIds.parent)}
        onPointerDown={(event) => {
          if (
            (event.target as HTMLElement).closest(
              "button,a,input,textarea,select,.panel,.planet-explorer,.route-card,.assistant-note,.hint,.view-controls,.gesture-hint,.mini-map,.screen-summary,.star-map-editor",
            )
          ) {
            return;
          }
          dragStart.current = {
            x: event.clientX,
            y: event.clientY,
            panX: view.panX,
            panY: view.panY,
          };
          setIsDragging(true);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!dragStart.current) return;
          const nextPanX = dragStart.current.panX + event.clientX - dragStart.current.x;
          const nextPanY = dragStart.current.panY + event.clientY - dragStart.current.y;
          setView((current) => ({ ...current, panX: nextPanX, panY: nextPanY }));
        }}
        onPointerUp={() => {
          dragStart.current = null;
          setIsDragging(false);
        }}
        onPointerCancel={() => {
          dragStart.current = null;
          setIsDragging(false);
        }}
        onWheel={(event) => {
          event.preventDefault();
          const delta = event.deltaY > 0 ? -0.08 : 0.08;
          setView((current) => ({
            ...current,
            zoom: Math.min(1.65, Math.max(0.72, Number((current.zoom + delta).toFixed(2)))),
          }));
        }}
      >
        <section className="screen active" aria-label={activeZoneContent.title}>
          <div className="top-actions galaxy-hud">
            <button
              aria-label="星图菜单"
              className={`chip-btn ${layerDockPinned ? "active" : ""}`}
              onClick={() => setLayerDockPinned((current) => !current)}
              type="button"
            >
              <Sparkles size={15} />
              星图菜单
            </button>
            <button
              aria-label="星图编辑"
              className={`chip-btn ${starMapEditorOpen ? "active" : ""}`}
              onClick={() => setStarMapEditorOpen((current) => !current)}
              type="button"
            >
              <GitBranch size={15} />
              星图编辑
            </button>
            <button
              className={`chip-btn ${autoCruise ? "active" : ""}`}
              onClick={toggleAutoCruise}
              type="button"
            >
              <ScanLine size={15} />
              自动巡航
            </button>
            <button className="chip-btn primary-chip" onClick={() => openPanel("quickRecord")} type="button">
              <Plus size={15} />
              点亮记忆星
            </button>
          </div>

          <div className="assistant-note">
            <Sparkles size={15} />
            <span>
              星图助手建议：先靠近妈妈的星球，点亮春节记忆星，再沿共鸣星轨写成一页家书。
            </span>
          </div>

          {activeZone === "galaxy" ? (
            <RouteCard
              activeStep={activeRouteStep}
              collapsed={routeCollapsed}
              onRunStep={runRouteStep}
              onToggle={() => setRouteCollapsed((current) => !current)}
            />
          ) : null}

          <div className="galaxy-canvas" style={galaxyStyle}>
            <ZoneScene
              activeZone={activeZone}
              bookGenerated={bookGenerated}
              bookResult={bookResult}
              litMemories={litMemories}
              anchorPlanetIds={anchorPlanetIds}
              onGenerateBook={() => {
                void generateBookDraft();
              }}
              onGo={goToZone}
              onOpenPanel={openPanel}
              onOpenPlanet={openSelectedPlanet}
              onSelectTheme={selectThemeFromNebula}
              onSelectPlanet={selectPlanet}
              onToast={setToast}
              planets={visiblePlanets}
              planetLinks={visibleLinks}
              selectedPlanetId={selectedPlanetId}
              closingPlanetId={closingPlanetId}
              selectedTheme={selectedTheme}
              selectedWorkshopBg={selectedWorkshopBg}
              selectedWorkshopMaterial={selectedWorkshopMaterial}
              selectedWorkshopZone={selectedWorkshopZone}
              selectedPlanet={selectedPlanet}
              onConfigurePlanetPrivacy={configurePlanetPrivacy}
              onEditPlanetTheme={editPlanetTheme}
              onGenerateBookFromPlanet={generateBookFromPlanet}
              onHidePlanet={hidePlanet}
              onOpenStarMapEditor={() => setStarMapEditorOpen(true)}
              onOpenPlanetLifecycle={openPlanetLifecycle}
              onRenamePlanet={renamePlanet}
              onSaveSelectedPlanetTheme={(theme) => {
                if (selectedPlanet) void persistPlanetChange(selectedPlanet, { theme });
              }}
              setSelectedWorkshopBg={setSelectedWorkshopBg}
              setSelectedWorkshopMaterial={setSelectedWorkshopMaterial}
              setSelectedWorkshopZone={setSelectedWorkshopZone}
            />
          </div>

          <ScreenSummary content={activeZoneContent} />
          <MiniMap activeLabel={zoneContent[activeZone].eyebrow} planets={visiblePlanets} rotation={view.rotate} />
          <ViewCompass rotation={view.rotate} />
          <ViewControls
            autoCruise={autoCruise}
            view={view}
            onAutoCruise={toggleAutoCruise}
            onReset={() => setView(initialView)}
            onRotate={() => setView((current) => ({ ...current, rotate: current.rotate + 18 }))}
            onZoomIn={() =>
              setView((current) => ({ ...current, zoom: Math.min(1.65, current.zoom + 0.1) }))
            }
            onZoomOut={() =>
              setView((current) => ({ ...current, zoom: Math.max(0.72, current.zoom - 0.1) }))
            }
          />
          <div className="gesture-hint">拖拽漫游 / 滚轮缩放 / 双击靠近星球</div>
          <AnimatePresence>
            {starMapEditorOpen ? (
              <StarMapEditor
                hiddenPlanets={hiddenPlanets}
                links={galaxyLinks}
                onAddCustomLink={addCustomLinkFromSelected}
                onAddPlanet={addFamilyPlanet}
                onClose={() => setStarMapEditorOpen(false)}
                onRemovePlanet={removePlanet}
                onRestorePlanet={restorePlanet}
                onToggleLink={toggleLinkVisibility}
                onToggleLinkKind={toggleLinkKind}
                planets={galaxyPlanets}
                selectedPlanet={selectedPlanet}
                visibleLinkKinds={visibleLinkKinds}
              />
            ) : null}
          </AnimatePresence>
        </section>
      </section>

      <AnimatePresence>
        <SidePanel
          activePanel={activePanel}
          extractResult={extractResult}
          resonanceResult={resonanceResult}
          bookResult={bookResult}
          quickRecordContent={quickRecordContent}
          loading={loopApi.loading}
          onClose={() => setActivePanel(null)}
          onGo={goToZone}
          onLightMemory={lightMemoryStar}
          onQuickRecordChange={setQuickRecordContent}
          onScanResonance={scanResonanceStar}
          onPersistPlanetChange={persistPlanetChange}
          onConfirmShare={() => {
            void confirmShare();
          }}
          shareUrl={shareUrl}
          onOpenPanel={openPanel}
          onSelectTheme={selectThemeFromNebula}
          onToast={setToast}
          selectedPlanet={selectedPlanet}
        />
      </AnimatePresence>
      {renamePlanetTarget ? (
        <RenamePlanetDialog
          name={renameDraft}
          onCancel={() => setRenamePlanetTarget(null)}
          onNameChange={setRenameDraft}
          onSave={() => {
            void savePlanetName();
          }}
          planet={renamePlanetTarget}
        />
      ) : null}
      {roamingPlanet ? (
        <PlanetRoamingOverlay
          planet={roamingPlanet}
          onBook={() => {
            setRoamingPlanetId(null);
            goToZone("books");
            setToast("已从星球漫游带入家书工坊");
          }}
          onClose={() => setRoamingPlanetId(null)}
          onQuickRecord={() => {
            setRoamingPlanetId(null);
            openPanel("quickRecord");
          }}
        />
      ) : null}
      {bookBeamPlanet ? (
        <BookBeamOverlay
          planet={bookBeamPlanet}
          onClose={() => setBookBeamPlanet(null)}
          onPreview={() => {
            setBookBeamPlanet(null);
            goToZone("books");
          }}
          onShareConfirm={() => {
            setBookBeamPlanet(null);
            setActivePanel("shareConfirm");
          }}
        />
      ) : null}
      <AnimatePresence>
        {toast ? (
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="toast show"
            exit={{ opacity: 0, y: -8 }}
            initial={{ opacity: 0, y: -8 }}
            onAnimationComplete={() => window.setTimeout(() => setToast(null), 1400)}
          >
            {toast}
          </motion.div>
        ) : null}
      </AnimatePresence>
      {immersiveMode || autoCruise ? (
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="immersive-pill"
          initial={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.24 }}
        >
          <span>{autoCruise ? "自动巡航中 · 星球正在沿轨道漫游" : "沉浸漫游中 · 左侧目录已自动收起"}</span>
          <button onClick={exitImmersiveMode} type="button">
            退出沉浸
          </button>
        </motion.div>
      ) : null}
    </main>
  );
}

function ZoneScene({
  activeZone,
  anchorPlanetIds,
  bookGenerated,
  bookResult,
  litMemories,
  closingPlanetId,
  onGenerateBook,
  onGo,
  onOpenPanel,
  onOpenPlanet,
  onSelectTheme,
  onSelectPlanet,
  onToast,
  planetLinks,
  planets,
  selectedPlanetId,
  selectedTheme,
  selectedWorkshopBg,
  selectedWorkshopMaterial,
  selectedWorkshopZone,
  selectedPlanet,
  setSelectedWorkshopBg,
  setSelectedWorkshopMaterial,
  setSelectedWorkshopZone,
  onConfigurePlanetPrivacy,
  onEditPlanetTheme,
  onGenerateBookFromPlanet,
  onHidePlanet,
  onOpenStarMapEditor,
  onOpenPlanetLifecycle,
  onRenamePlanet,
  onSaveSelectedPlanetTheme,
}: {
  activeZone: GalaxyZoneKey;
  anchorPlanetIds: {
    self: string | null;
    parent: string | null;
    memorial: string | null;
    public: string | null;
  };
  bookGenerated: boolean;
  bookResult: BookGenerateResponse | null;
  litMemories: MemoryStar[];
  closingPlanetId: string | null;
  onGenerateBook: () => void;
  onGo: (zone: GalaxyZoneKey) => void;
  onOpenPanel: (key: PanelKey) => void;
  onOpenPlanet: (planetId: string | null) => void;
  onSelectTheme: (theme: string) => void;
  onSelectPlanet: (planetId: string) => void;
  onToast: (message: string) => void;
  planetLinks: PlanetLink[];
  planets: Planet[];
  selectedPlanetId: string | null;
  selectedTheme: string;
  selectedWorkshopBg: string;
  selectedWorkshopMaterial: string;
  selectedWorkshopZone: GalaxyZoneKey;
  selectedPlanet: Planet | null;
  setSelectedWorkshopBg: (value: string) => void;
  setSelectedWorkshopMaterial: (value: string) => void;
  setSelectedWorkshopZone: (value: GalaxyZoneKey) => void;
  onConfigurePlanetPrivacy: (planet: Planet) => void;
  onEditPlanetTheme: (planetId: string) => void;
  onGenerateBookFromPlanet: (planet: Planet) => void;
  onHidePlanet: (planetId: string) => void;
  onOpenStarMapEditor: () => void;
  onOpenPlanetLifecycle: (planetId: string) => void;
  onRenamePlanet: (planet: Planet) => void;
  onSaveSelectedPlanetTheme: (theme: string) => void;
}) {
  if (activeZone === "privacy") {
    return (
      <>
        <ScopeRings />
        <ScenePlanetButton
          badge="私"
          className="me private-planet"
          label="私密核心"
          left="50%"
          onClick={() => onOpenPanel("scopePrivate")}
          top="50%"
        />
        <ScenePlanetButton
          badge="家"
          className="mom"
          label="家庭可见"
          left="32%"
          onClick={() => onOpenPanel("scopeFamily")}
          top="44%"
        />
        <ScenePlanetButton
          badge="公"
          className="friend public-planet"
          label="公开分享"
          left="74%"
          onClick={() => onOpenPanel("scopePublic")}
          top="36%"
        />
        <SceneHint
          subtitle="私密、家庭、公开不是开关，而是三层轨道"
          title="每颗星球都有自己的光照范围"
        />
      </>
    );
  }

  if (activeZone === "memorial") {
    return (
      <>
        <svg className="links" viewBox="0 0 1000 700" preserveAspectRatio="none" aria-hidden="true">
          <line className="link-ancestor" x1="275" x2="500" y1="259" y2="361" />
          <line className="link-ancestor" x1="730" x2="500" y1="252" y2="361" />
          <line className="link-family" x1="500" x2="500" y1="361" y2="539" />
        </svg>
        <ScenePlanetButton
          badge="念"
          className="ancestor memorial-planet has-ring"
          label="外婆的纪念星"
          left="27.5%"
          onClick={() => onOpenPlanet(anchorPlanetIds.memorial)}
          top="37%"
        />
        <ScenePlanetButton
          badge="念"
          className="dad memorial-planet"
          label="外公的纪念星"
          left="73%"
          onClick={() => onOpenPanel("grandpa")}
          top="36%"
        />
        <ScenePlanetButton
          badge="家"
          className="mom"
          label="妈妈"
          left="50%"
          onClick={() => onOpenPlanet(anchorPlanetIds.parent)}
          top="51.5%"
        />
        <ScenePlanetButton
          badge="私"
          className="me"
          label="我"
          left="50%"
          onClick={() => onOpenPlanet(anchorPlanetIds.self)}
          top="77%"
        />
        <SparkButton
          label="家族传承星云"
          left="50%"
          onClick={() => onOpenPanel("legacy")}
          top="28%"
        />
        <SceneHint
          subtitle="他们的生命周期会凝成纪念星，照亮后来的星球"
          title="已过世的家人，不会从星系里消失"
        />
      </>
    );
  }

  if (activeZone === "workshop") {
    return (
      <div className="workshop-board">
        <section className="workshop-panel">
          <p className="panel-kicker">星球工坊</p>
          <h2>调整星系气质，不改变故事本身</h2>
          <p>这里模拟 demo 的主题实验室。选择星域、背景和星球材质后，可以应用到当前星域，也可以直接预览该星域。</p>
          <PresetGrid
            current={selectedWorkshopZone}
            items={[
              ["galaxy", "我的星系", "温暖、家庭关系、低速漂浮"],
              ["memories", "记忆星群", "明亮碎片、星点跳动、轨道更密"],
              ["resonance", "共鸣星轨", "双星牵引、脉冲连线、对比更强"],
              ["memorial", "纪念星域", "克制、低饱和、慢速光晕"],
            ]}
            onSelect={(value) => setSelectedWorkshopZone(value as GalaxyZoneKey)}
          />
        </section>
        <section className="workshop-panel">
          <p className="panel-kicker">背景主题</p>
          {selectedPlanet ? <p>正在调整「{selectedPlanet.name}」· 当前星球主题：{selectedPlanet.theme}</p> : null}
          <PresetGrid
            current={selectedWorkshopBg}
            items={[
              ["家书暖夜", "家书暖夜", "默认家庭叙事底色"],
              ["极光蓝绿", "极光蓝绿", "适合旅行与成长"],
              ["橘粉黄昏", "橘粉黄昏", "适合团圆与伴侣"],
              ["深空墨蓝", "深空墨蓝", "适合纪念与私密"],
            ]}
            onSelect={setSelectedWorkshopBg}
          />
          <p className="panel-kicker">星球材质</p>
          <PresetGrid
            current={selectedWorkshopMaterial}
            items={[
              ["柔光釉面", "柔光釉面", "更像成熟产品默认材质"],
              ["晶体折光", "晶体折光", "适合共鸣星轨"],
              ["胶片颗粒", "胶片颗粒", "适合老照片与记忆"],
              ["纪念石纹", "纪念石纹", "适合纪念星域"],
            ]}
            onSelect={setSelectedWorkshopMaterial}
          />
          <div className="book-actions">
            {selectedPlanet ? (
              <button className="primary" onClick={() => onSaveSelectedPlanetTheme(selectedWorkshopBg)} type="button">
                保存星球主题
              </button>
            ) : (
              <button className="primary" onClick={() => onToast("星球主题已应用")} type="button">
                应用到当前星域
              </button>
            )}
            <button className="secondary" onClick={() => onGo(selectedWorkshopZone)} type="button">
              预览该星域
            </button>
          </div>
        </section>
      </div>
    );
  }

  if (activeZone === "memories") {
    return (
      <>
        <div className="orbit memory-orbit" />
        <ScenePlanetButton
          badge="家"
          className="mom public-planet has-ring"
          label="妈妈的星球"
          left="50%"
          onClick={() => onOpenPlanet(anchorPlanetIds.parent)}
          top="50%"
        />
        <MemoryButton label="新家里的第一个除夕" left="50%" onClick={() => onOpenPanel("memory1")} top="25%" variant="coral" />
        <MemoryButton label="生日卡片" left="31%" onClick={() => onOpenPanel("memory2")} top="63%" />
        <MemoryButton label="云南旅行" left="68%" onClick={() => onOpenPanel("memory3")} top="66%" variant="blue" />
        <MemoryButton label="外婆的菜谱" left="18%" onClick={() => onOpenPanel("memory4")} top="47%" variant="ancestor-light" />
        {litMemories.map((memory, index) => (
          <MemoryButton
            key={memory.id}
            label={memory.title}
            left={`${42 + index * 8}%`}
            onClick={() => onOpenPanel("memory1")}
            top={`${78 - index * 6}%`}
            variant="coral"
          />
        ))}
        <SparkButton label="共鸣星轨正在生成" left="76%" onClick={() => onGo("resonance")} top="34%" />
        <SceneHint
          subtitle="点击光点查看故事；新的记忆会自然进入轨道"
          title="记忆不是表单，是一颗颗被点亮的星"
        />
      </>
    );
  }

  if (activeZone === "resonance") {
    return (
      <>
        <svg className="links" viewBox="0 0 1000 700" preserveAspectRatio="none" aria-hidden="true">
          <path className="link-public" d="M285 350 C420 250 580 250 715 350" />
          <path className="link-private" d="M285 350 C420 450 580 450 715 350" />
        </svg>
        <ScenePlanetButton
          badge="家"
          className="mom public-planet has-ring"
          label="妈妈的星球"
          left="28.5%"
          onClick={() => onOpenPlanet(anchorPlanetIds.parent)}
          top="50%"
        />
        <ScenePlanetButton
          badge="私"
          className="me private-planet"
          label="我的星球"
          left="71.5%"
          onClick={() => onOpenPlanet(anchorPlanetIds.self)}
          top="50%"
        />
        <SparkButton label="2018 除夕共鸣星轨" left="50%" onClick={() => onOpenPanel("resonance")} top="45%" />
        <MemoryButton label="妈妈的除夕记忆" left="39%" onClick={() => onOpenPanel("memory1")} top="38%" variant="coral" />
        <MemoryButton label="我的除夕记忆" left="61%" onClick={() => onOpenPanel("memory1")} top="38%" variant="blue" />
        <SceneHint
          subtitle="AI 只点亮候选连接，故事是否成立由家人确认"
          title="两颗星球之间，不是合并，而是共鸣"
        />
      </>
    );
  }

  if (activeZone === "themes") {
    return (
      <div className="nebula-grid">
        <ThemeNebula
          description="第一次、成长里程碑、给未来的你。适合孩子星球与父母星系。"
          label="亲子成长"
          onSelect={onSelectTheme}
          title="亲子成长星云"
        />
        <ThemeNebula
          description="年轻时的 TA、成家、工作、没说出口的话。适合父母采访。"
          label="父母人生"
          onSelect={onSelectTheme}
          title="父母人生星云"
        />
        <ThemeNebula
          description="已故成员的生命周期、家人眼中的 TA、留下来的光。"
          label="纪念星册"
          onSelect={onSelectTheme}
          title="纪念星云"
        />
        <ThemeNebula
          description="一次旅行中，不同家人记住的风景、路线和心情。"
          label="旅行星云"
          onSelect={onSelectTheme}
          title="旅行星云"
        />
        <SceneHint
          subtitle="主题不是模板库，而是进入家书工坊之前的一片写作星云"
          title="选择一种主题，就像进入一片新的星云"
        />
      </div>
    );
  }

  if (activeZone === "books") {
    const bookTitle = bookResult?.draft.title ?? bookDrafts[0].title;
    const bookIntro = bookResult?.draft.intro ?? bookDrafts[0].intro;
    const bookSourceIds = bookResult?.draft.sourceMemoryIds ?? bookDrafts[0].sourceMemoryIds;
    return (
      <div className="bookmaker-stage">
        <section className="book-workbench">
          <p className="panel-kicker">家书工坊</p>
          <h2>把星系里的光，整理成一页可以分享的家书</h2>
          <p>当前主题：{selectedTheme}。来源范围支持单星球、双星系、家庭星系和纪念星。</p>
          <div className="source-pair">
            <div className="source-card">
              <strong>来源范围</strong>
              <p>妈妈的星球 + 我的星球 · 2018 除夕共鸣星轨</p>
            </div>
            <div className="source-card">
              <strong>保留 sourceMemoryIds</strong>
              <p>{bookSourceIds.join(" / ")}</p>
            </div>
          </div>
          <div className="book-actions">
            <button className="primary" onClick={onGenerateBook} type="button">
              生成家书草稿
            </button>
            <button className="secondary" onClick={() => onOpenPanel("shareConfirm")} type="button">
              分享前确认
            </button>
          </div>
        </section>
        <article className="book-preview">
          <p>{bookGenerated || bookResult ? "家书草稿已生成" : "等待生成"}</p>
          <h3>{bookTitle}</h3>
          <span>{bookIntro}</span>
          {bookResult ? (
            <div className="book-sections">
              {bookResult.sections.map((section) => (
                <div className="book-section" key={section.title}>
                  <strong>{section.title}</strong>
                  <p>{section.body}</p>
                  <span className="book-source">来源：{section.sourceMemoryIds.join(" / ")}</span>
                </div>
              ))}
            </div>
          ) : null}
        </article>
        <SceneHint
          subtitle="只基于已确认记忆生成；公开分享前必须确认范围"
          title="家书是一次漫游后的成果物"
        />
      </div>
    );
  }

  return (
    <>
      <PlanetLinkField links={planetLinks} planets={planets} />

      <div className="orbit family-orbit" />
      <div className="orbit memory-orbit" />

      {planets.map((planet) => (
        <GalaxyPlanetObject
          key={planet.id}
          onConfigurePrivacy={onConfigurePlanetPrivacy}
          onEditTheme={onEditPlanetTheme}
          onGenerateBook={onGenerateBookFromPlanet}
          onHide={onHidePlanet}
          onLightMemory={() => onOpenPanel("quickRecord")}
          onLink={() => {
            onOpenStarMapEditor();
            onToast(`正在配置「${planet.name}」的星轨连接`);
          }}
          onOpen={onOpenPlanet}
          onOpenLifecycle={onOpenPlanetLifecycle}
          onRename={onRenamePlanet}
          onSelect={onSelectPlanet}
          closing={closingPlanetId === planet.id}
          planet={planet}
          selected={selectedPlanetId === planet.id}
        />
      ))}

      {litMemories.map((memory, index) => (
        <MemoryButton
          key={`galaxy-${memory.id}`}
          label={`新点亮：${memory.title}`}
          left={`${36 + (index % 4) * 9}%`}
          onClick={() => onOpenPanel("memory1")}
          top={`${28 + Math.floor(index / 4) * 10}%`}
          variant="coral"
        />
      ))}

      <MemoryButton label="点开春节记忆星" left="43%" onClick={() => onOpenPanel("memory1")} top="32%" variant="coral" />
      <MemoryButton label="点亮云南旅行记忆星" left="74%" onClick={() => onOpenPanel("memory3")} top="24%" variant="blue" />
      <SparkButton label="推荐航线：共鸣星轨" left="50%" onClick={() => onGo("resonance")} top="25%" />

      <SceneHint
        subtitle="自由靠近任意星球；第一次进入时，也可以跟随推荐航线"
        title="这里不是功能菜单，而是一片可以漫游的家庭星系"
      />
    </>
  );
}

function ScenePlanetButton({
  badge,
  className,
  label,
  left,
  onClick,
  top,
}: {
  badge: string;
  className: string;
  label: string;
  left: string;
  onClick: () => void;
  top: string;
}) {
  return (
    <button
      aria-label={label}
      className={`planet ${className}`}
      onClick={onClick}
      style={{ left, top }}
      type="button"
    >
      <span className="badge">{badge}</span>
      <span className="planet-label">{label}</span>
    </button>
  );
}

function PlanetLinkField({ links, planets }: { links: PlanetLink[]; planets: Planet[] }) {
  const planetById = new Map(planets.map((planet) => [planet.id, planet]));

  return (
    <svg className="links" viewBox="0 0 1000 700" preserveAspectRatio="none" aria-hidden="true">
      {links.map((link) => {
        const source = planetById.get(link.sourcePlanetId);
        const target = planetById.get(link.targetPlanetId);
        if (!source || !target) return null;

        const x1 = source.position.x * 10;
        const y1 = source.position.y * 7;
        const x2 = target.position.x * 10;
        const y2 = target.position.y * 7;
        const centerLift = link.kind === "resonance" || link.status === "candidate" ? -72 : 0;
        const controlX = (x1 + x2) / 2;
        const controlY = (y1 + y2) / 2 + centerLift;
        const className = [
          planetLinkKindClassName[link.kind],
          link.status === "candidate" ? "link-candidate" : "",
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <path
            className={className}
            data-testid={`planet-link-${link.id}`}
            d={`M${x1} ${y1} Q${controlX} ${controlY} ${x2} ${y2}`}
            key={link.id}
            pathLength="1"
            style={{ "--link-strength": link.strength } as React.CSSProperties}
          />
        );
      })}
    </svg>
  );
}

function GalaxyPlanetObject({
  closing,
  onConfigurePrivacy,
  onEditTheme,
  onGenerateBook,
  onHide,
  onLightMemory,
  onLink,
  onOpen,
  onOpenLifecycle,
  onRename,
  onSelect,
  planet,
  selected,
}: {
  closing: boolean;
  onConfigurePrivacy: (planet: Planet) => void;
  onEditTheme: (planetId: string) => void;
  onGenerateBook: (planet: Planet) => void;
  onHide: (planetId: string) => void;
  onLightMemory: () => void;
  onLink: () => void;
  onOpen: (planetId: string) => void;
  onOpenLifecycle: (planetId: string) => void;
  onRename: (planet: Planet) => void;
  onSelect: (planetId: string) => void;
  planet: Planet;
  selected: boolean;
}) {
  const style = { left: `${planet.position.x}%`, top: `${planet.position.y}%` };
  const presentationType = getPlanetPresentationType(planet);
  const showActionRing = selected || closing;

  return (
    <>
      <button
        aria-label={`进入${planet.name}漫游`}
        className={`${planetClassByType[presentationType]} ${selected ? "selected" : ""}`}
        onClick={() => onSelect(planet.id)}
        style={style}
        type="button"
      >
        <span className="badge">{planetBadgeByType[presentationType]}</span>
        <span className="planet-label">{planet.name.replace("的星球", "").replace("星球", "")}</span>
      </button>

      {showActionRing ? (
          <div className="planet-action-ring" style={style}>
            <motion.div
              animate={closing ? { opacity: 0, rotate: 96, scale: 0.5 } : { opacity: 1, rotate: 0, scale: 1 }}
              aria-hidden={closing || undefined}
              aria-label={closing ? undefined : `${planet.name}操作`}
              className={`planet-action-ring-motion ${closing ? "closing" : ""}`}
              initial={closing ? false : { opacity: 0, rotate: -118, scale: 0.48 }}
              role={closing ? undefined : "group"}
              transition={{ duration: 1.28, ease: [0.12, 0.86, 0.16, 1] }}
            >
              <button aria-label="进入星球" className="orbit-action action-open" onClick={() => onOpen(planet.id)} type="button">
                <ScanLine size={15} />
                <span>进入星球</span>
              </button>
              <button aria-label="点亮记忆" className="orbit-action action-memory" onClick={onLightMemory} type="button">
                <Plus size={15} />
                <span>点亮记忆</span>
              </button>
              <button aria-label="一键生成家书" className="orbit-action action-book" onClick={() => onGenerateBook(planet)} type="button">
                <BookOpen size={15} />
                <span>生成家书</span>
              </button>
              <button aria-label="编辑主题" className="orbit-action action-theme" onClick={() => onEditTheme(planet.id)} type="button">
                <Palette size={15} />
                <span>编辑主题</span>
              </button>
              <button aria-label="设置权限" className="orbit-action action-privacy" onClick={() => onConfigurePrivacy(planet)} type="button">
                <LockKeyhole size={15} />
                <span>设置权限</span>
              </button>
              <button aria-label="生命周期" className="orbit-action action-life" onClick={() => onOpenLifecycle(planet.id)} type="button">
                <Clock3 size={15} />
                <span>生命周期</span>
              </button>
              <button aria-label="重命名星球" className="orbit-action action-rename" onClick={() => onRename(planet)} type="button">
                <Edit3 size={15} />
                <span>重命名</span>
              </button>
              <button aria-label="配置连接" className="orbit-action action-link" onClick={onLink} type="button">
                <Link2 size={15} />
                <span>配置连接</span>
              </button>
              <button aria-label="隐藏星球" className="orbit-action action-hide" onClick={() => onHide(planet.id)} type="button">
                <EyeOff size={15} />
                <span>隐藏星球</span>
              </button>
            </motion.div>
          </div>
        ) : null}
    </>
  );
}

function MemoryButton({
  label,
  left,
  onClick,
  top,
  variant = "",
}: {
  label: string;
  left: string;
  onClick: () => void;
  top: string;
  variant?: string;
}) {
  return (
    <button
      aria-label={label}
      className={`memory ${variant}`}
      onClick={onClick}
      style={{ left, top }}
      type="button"
    />
  );
}

function SparkButton({
  label,
  left,
  onClick,
  top,
}: {
  label: string;
  left: string;
  onClick: () => void;
  top: string;
}) {
  return (
    <button
      aria-label={label}
      className="spark trail-active"
      data-label={label}
      onClick={onClick}
      style={{ left, top }}
      type="button"
    />
  );
}

function SceneHint({ subtitle, title }: { subtitle: string; title: string }) {
  return (
    <div className="hint">
      {title}
      <span>{subtitle}</span>
    </div>
  );
}

function ScopeRings() {
  return (
    <div className="scope-stage">
      <span className="scope-ring private-ring">私密核心</span>
      <span className="scope-ring family-ring">家庭可见</span>
      <span className="scope-ring public-ring">公开分享轨道</span>
    </div>
  );
}

function PresetGrid({
  current,
  items,
  onSelect,
}: {
  current: string;
  items: Array<[string, string, string]>;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="preset-grid">
      {items.map(([value, title, description]) => (
        <button
          className={`preset ${current === value ? "selected" : ""}`}
          key={value}
          onClick={() => onSelect(value)}
          type="button"
        >
          <i />
          <strong>{title}</strong>
          <span>{description}</span>
        </button>
      ))}
    </div>
  );
}

function ThemeNebula({
  description,
  label,
  onSelect,
  title,
}: {
  description: string;
  label: string;
  onSelect: (theme: string) => void;
  title: string;
}) {
  return (
    <button aria-label={label} className="nebula" onClick={() => onSelect(label)} type="button">
      <h3>{title}</h3>
      <p>{description}</p>
      <div className="tags">
        <span className="tag">{label}</span>
        <span className="tag">进入家书工坊</span>
      </div>
    </button>
  );
}

function RouteCard({
  activeStep,
  collapsed,
  onRunStep,
  onToggle,
}: {
  activeStep: number;
  collapsed: boolean;
  onRunStep: (index: number) => void;
  onToggle: () => void;
}) {
  return (
    <article className={`route-card ${collapsed ? "collapsed" : ""}`} id="routeCard">
      <h2>新手推荐航线</h2>
      <p>这不是强制流程，只是一条第一次进入星系时更容易看见产品价值的观星路线。</p>
      <div className="route-steps">
        {routeSteps.map((step, index) => (
          <button
            className={`route-step ${activeStep === index ? "active" : ""}`}
            key={step.label}
            onClick={() => onRunStep(index)}
            type="button"
          >
            <i>{index + 1}</i>
            <span>
              <strong>{step.label}</strong>
              <span>{step.detail}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="route-tools">
        <button className="secondary" onClick={onToggle} type="button">
          {collapsed ? "展开航线" : "收起航线"}
        </button>
        <button className="primary" onClick={() => onRunStep(0)} type="button">
          开始靠近
        </button>
      </div>
    </article>
  );
}

function ScreenSummary({ content }: { content: (typeof zoneContent)[GalaxyZoneKey] }) {
  return (
    <article className="screen-summary">
      <p>{content.eyebrow}</p>
      <h2>{content.title}</h2>
      <div className="tags">
        {content.tags.map((tag) => (
          <span className="tag" key={tag}>
            {tag}
          </span>
        ))}
      </div>
    </article>
  );
}

function MiniMap({ activeLabel, planets, rotation }: { activeLabel: string; planets: Planet[]; rotation: number }) {
  return (
    <div className="mini-map">
      <div className="mini-map-head">
        <strong>当前星域</strong>
        <span>{activeLabel}</span>
      </div>
      <div className="mini-map-stage">
        {planets.map((planet) => (
          <i key={planet.id} style={{ left: `${planet.position.x}%`, top: `${planet.position.y}%` }} />
        ))}
        <b style={{ "--mini-rotation": `${rotation}deg` } as React.CSSProperties} />
      </div>
    </div>
  );
}

function StarMapEditor({
  hiddenPlanets,
  links,
  onAddCustomLink,
  onAddPlanet,
  onClose,
  onRemovePlanet,
  onRestorePlanet,
  onToggleLink,
  onToggleLinkKind,
  planets,
  selectedPlanet,
  visibleLinkKinds,
}: {
  hiddenPlanets: Planet[];
  links: PlanetLink[];
  onAddCustomLink: () => void;
  onAddPlanet: () => void;
  onClose: () => void;
  onRemovePlanet: (planetId: string) => void;
  onRestorePlanet: (planetId: string) => void;
  onToggleLink: (linkId: string) => void;
  onToggleLinkKind: (kind: PlanetLinkKind) => void;
  planets: Planet[];
  selectedPlanet: Planet | null;
  visibleLinkKinds: PlanetLinkKind[];
}) {
  const planetById = new Map(planets.map((planet) => [planet.id, planet.name]));
  const editablePlanets = planets.filter((planet) => !hiddenPlanets.some((hidden) => hidden.id === planet.id));

  return (
    <motion.article
      animate={{ opacity: 1, y: 0, scale: 1 }}
      aria-label="星图编辑"
      className="star-map-editor"
      exit={{ opacity: 0, y: 18, scale: 0.96 }}
      initial={{ opacity: 0, y: 18, scale: 0.96 }}
      role="dialog"
      transition={{ duration: 0.28, ease: [0.22, 0.86, 0.28, 1] }}
    >
      <div className="star-map-editor-head">
        <div>
          <p>星图编辑</p>
          <h2>{selectedPlanet ? selectedPlanet.name : "当前家庭星系"}</h2>
        </div>
        <button aria-label="关闭星图编辑" className="icon-close" onClick={onClose} type="button">
          <X size={16} />
        </button>
      </div>

      <div className="star-map-actions">
        <button className="star-map-primary-action" onClick={onAddPlanet} type="button">
          <Plus size={15} />
          新增星球
        </button>
        <button className="star-map-primary-action secondary" onClick={onAddCustomLink} type="button">
          <Link2 size={15} />
          连接当前星球
        </button>
      </div>

      <section className="star-map-section">
        <h3>连接规则</h3>
        <div className="link-kind-grid">
          {(Object.keys(planetLinkKindLabels) as PlanetLinkKind[]).map((kind) => (
            <button
              aria-pressed={visibleLinkKinds.includes(kind)}
              className={`link-kind ${visibleLinkKinds.includes(kind) ? "active" : ""}`}
              key={kind}
              onClick={() => onToggleLinkKind(kind)}
              type="button"
            >
              <i className={`link-kind-dot ${kind}`} />
              <span>{planetLinkKindLabels[kind]}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="star-map-section">
        <h3>星轨清单</h3>
        <div className="star-map-list">
          {links.map((link) => (
            <button
              aria-pressed={link.status !== "hidden"}
              className={`star-link-row ${link.status === "hidden" ? "muted" : ""}`}
              key={link.id}
              onClick={() => onToggleLink(link.id)}
              type="button"
            >
              <span>
                <strong>{link.label}</strong>
                <small>
                  {planetById.get(link.sourcePlanetId)} → {planetById.get(link.targetPlanetId)}
                </small>
              </span>
              <em>{planetLinkKindLabels[link.kind]}</em>
            </button>
          ))}
        </div>
      </section>

      <section className="star-map-section">
        <h3>星球管理</h3>
        <div className="star-map-list compact">
          {editablePlanets.map((planet) => (
            <div className="planet-manage-row" key={planet.id}>
              <span>
                <strong>{planet.name}</strong>
                <small>{planet.role}</small>
              </span>
              <button aria-label={`移除${planet.name}`} onClick={() => onRemovePlanet(planet.id)} type="button">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </section>

      {hiddenPlanets.length > 0 ? (
        <section className="star-map-section">
          <h3>隐藏星球</h3>
          <div className="hidden-planet-row">
            {hiddenPlanets.map((planet) => (
              <button key={planet.id} onClick={() => onRestorePlanet(planet.id)} type="button">
                <Eye size={14} />
                恢复{planet.name}
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </motion.article>
  );
}

function ViewCompass({ rotation }: { rotation: number }) {
  return (
    <div className="view-compass">
      <i style={{ "--compass-rotation": `${rotation}deg` } as React.CSSProperties} />
      北
    </div>
  );
}

function ViewControls({
  autoCruise,
  view,
  onAutoCruise,
  onReset,
  onRotate,
  onZoomIn,
  onZoomOut,
}: {
  autoCruise: boolean;
  view: GalaxyView;
  onAutoCruise: () => void;
  onReset: () => void;
  onRotate: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}) {
  return (
    <div className="view-controls">
      <button aria-label="放大视角" onClick={onZoomIn} type="button">
        <Plus size={17} />
        <small>靠近</small>
      </button>
      <button aria-label="缩小视角" onClick={onZoomOut} type="button">
        <Minus size={17} />
        <small>远离</small>
      </button>
      <button aria-label="旋转视角" onClick={onRotate} type="button">
        <Compass size={17} />
        <small>旋转</small>
      </button>
      <button aria-label="重置视角" onClick={onReset} type="button">
        <RotateCcw size={17} />
        <small>重置</small>
      </button>
      <button aria-label="自动巡航" className={autoCruise ? "active" : ""} onClick={onAutoCruise} type="button">
        <ScanLine size={17} />
        <small>巡航</small>
      </button>
      <span className="view-status">
        {Math.round(view.zoom * 100)}%
        <br />
        {view.rotate} deg
      </span>
    </div>
  );
}

function SidePanel({
  activePanel,
  extractResult,
  resonanceResult,
  bookResult,
  quickRecordContent,
  loading,
  shareUrl,
  onClose,
  onGo,
  onLightMemory,
  onQuickRecordChange,
  onScanResonance,
  onPersistPlanetChange,
  onConfirmShare,
  onOpenPanel,
  onSelectTheme,
  onToast,
  selectedPlanet,
}: {
  activePanel: PanelKey | null;
  extractResult: MemoryExtractResponse | null;
  resonanceResult: ResonanceScanResponse | null;
  bookResult: BookGenerateResponse | null;
  quickRecordContent: string;
  loading: boolean;
  shareUrl: string | null;
  onClose: () => void;
  onGo: (zone: GalaxyZoneKey) => void;
  onLightMemory: () => void;
  onQuickRecordChange: (value: string) => void;
  onScanResonance: () => Promise<boolean>;
  onPersistPlanetChange: (planet: Planet, changes: LegacyPlanetChanges) => Promise<boolean>;
  onConfirmShare: () => void;
  onOpenPanel: (key: PanelKey) => void;
  onSelectTheme: (theme: string) => void;
  onToast: (message: string) => void;
  selectedPlanet: Planet | null;
}) {
  // live-or-fallback：有真实响应时用真实数据，否则回落静态 mock，保证旧测试断言成立。
  const liveMemory = extractResult?.memory ?? memoryStars[0];
  const memory = liveMemory;
  const track = resonanceResult?.candidate ?? resonanceTracks[0];
  const book = bookResult?.draft ?? bookDrafts[0];
  const memoryKey = activePanel as MemoryPanelKey;

  if (!activePanel) return null;

  const sharedProps =
    activePanel === "shareConfirm"
      ? { role: "dialog", "aria-label": "分享前确认", "aria-modal": true }
      : { role: "complementary", "aria-label": "星图详情" };

  return (
    <motion.aside
      animate={{ opacity: 1, x: 0 }}
      className="panel open"
      exit={{ opacity: 0, x: 36 }}
      initial={{ opacity: 0, x: 80 }}
      transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
      {...sharedProps}
    >
      <button aria-label="关闭面板" className="close" onClick={onClose} type="button">
        <X size={16} />
      </button>

      {["me", "mom", "dad", "child", "friend", "grandpa", "legacy"].includes(activePanel) ? (
        <ProfilePanel
          activePanel={activePanel}
          onGo={onGo}
          onOpenPanel={onOpenPanel}
          onSelectTheme={onSelectTheme}
        />
      ) : null}

      {["scopePrivate", "scopeFamily", "scopePublic"].includes(activePanel) ? (
        <ScopePanel
          activePanel={activePanel}
          planet={selectedPlanet}
          onSaveVisibility={(visibility) => {
            if (selectedPlanet) void onPersistPlanetChange(selectedPlanet, { visibility });
          }}
        />
      ) : null}

      {["memory1", "memory2", "memory3", "memory4"].includes(activePanel) ? (
        <>
          <h2>{memoryPanelContent[memoryKey].title}</h2>
          <div className="tags">
            {memoryPanelContent[memoryKey].tags.map((tag) => (
              <span className="tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>
          <p>{memoryPanelContent[memoryKey].body}</p>
          <div className="ai-card">
            <strong>AI 已整理为记忆星：</strong>
            <p>
              {activePanel === "memory1"
                ? `时间：${memory.occurredAt}。地点：${memory.location}。人物：${memory.people.join("、")}。情绪：${memory.emotions.join("、")}。`
                : memoryPanelContent[memoryKey].assist}
            </p>
          </div>
          <div className="big-actions">
            {activePanel === "memory1" ? (
              <button
                className="primary"
                onClick={() => {
                  void onScanResonance();
                  onGo("resonance");
                  onClose();
                }}
                type="button"
              >
                沿共鸣星轨前进
              </button>
            ) : null}
            {activePanel === "memory3" ? (
              <button className="primary" onClick={() => onSelectTheme("旅行星云")} type="button">
                进入旅行星云
              </button>
            ) : null}
            {activePanel === "memory4" ? (
              <button className="primary" onClick={() => onSelectTheme("纪念星册")} type="button">
                写成传承页
              </button>
            ) : null}
            <button className="secondary" onClick={() => onOpenPanel("quickRecord")} type="button">
              补充另一个视角
            </button>
          </div>
        </>
      ) : null}

      {activePanel === "resonance" ? (
        <>
          <h2>{track.title}</h2>
          <div className="tags">
            <span className="tag public">待家人确认</span>
            <span className="tag">匹配度 {Math.round(track.score * 100)}%</span>
          </div>
          <p>{track.reason}</p>
          <div className="source-pair">
            <div className="source-card">
              <strong>妈妈的记忆</strong>
              <p>看着孩子们围坐在桌前，觉得一天的劳累都值了。</p>
            </div>
            <div className="source-card">
              <strong>我的记忆</strong>
              <p>妈妈端出最后一盘饺子，那是我们在新城市真正扎根的一刻。</p>
            </div>
          </div>
          <h3>为什么形成星轨</h3>
          <div className="match-list">
            {(resonanceResult
              ? ([
                  ["时间", Math.round(resonanceResult.breakdown.time * 100)],
                  ["人物", Math.round(resonanceResult.breakdown.people * 100)],
                  ["地点", Math.round(resonanceResult.breakdown.location * 100)],
                  ["语义", Math.round(resonanceResult.breakdown.semantic * 100)],
                ] as const)
              : ([
                  ["时间", 95],
                  ["人物", 92],
                  ["地点", 88],
                  ["语义", 90],
                ] as const)
            ).map(([label, score]) => (
              <div className="match-row" key={label}>
                <span>{label}</span>
                <div className="match-bar">
                  <i style={{ width: `${score}%` }} />
                </div>
                <strong>{score}%</strong>
              </div>
            ))}
          </div>
          <div className="big-actions">
            <button
              className="primary"
              onClick={() => {
                onGo("books");
                onClose();
              }}
              type="button"
            >
              把这条星轨写成家书
            </button>
            <button className="secondary" onClick={onClose} type="button">
              先保留候选
            </button>
          </div>
        </>
      ) : null}

      {activePanel === "book" ? (
        <>
          <h2>{book.title}</h2>
          <div className="tags">
            <span className="tag">双星系来源</span>
            <span className="tag">家庭团圆</span>
          </div>
          <p>{book.intro}</p>
          <div className="book-dock">
            <BookOpen size={18} />
            <strong>{book.chapters[0]?.title}</strong>
            <button className="mini-action" onClick={() => onGo("books")} type="button">
              进入家书工坊
            </button>
          </div>
        </>
      ) : null}

      {activePanel === "privacy" ? (
        <>
          <h2>隐私星域</h2>
          <div className="scope-ring-preview">
            <span className="circle c1" />
            <span className="circle c2" />
            <span className="circle c3" />
          </div>
          <h3>私密核心</h3>
          <p>只属于个人星球，家人不可见，共鸣和家书生成前需要主动授权。</p>
          <h3>家庭可见</h3>
          <p>适合家庭旅行、节日、生日和亲子成长。共同记忆识别需要双方允许。</p>
          <h3>公开分享轨道</h3>
          <p>公开的是成册内容，不是整颗星球，也不是原始素材。</p>
        </>
      ) : null}

      {activePanel === "lifecycle" ? (
        <>
          <h2>生命周期轨道</h2>
          <div className="tags">
            <span className="tag">人生阶段</span>
            <span className="tag">纪念状态</span>
            <span className="tag">可生成家书</span>
          </div>
          <p>
            生命周期不再作为独立表单，而是这颗星球的时间轨道。出生、成长、成为父母、退休和纪念状态会改变星球光晕、轨道速度和可生成的家书主题。
          </p>
          <div className="lifecycle-orbit-panel">
            {[
              ["出生", "1968", "星球核心被点亮"],
              ["成为母亲", "1998", "亲子星轨形成"],
              ["新家除夕", "2018", "家庭共鸣增强"],
              ["退休旅行", "2024", "旅行星云展开"],
            ].map(([label, year, detail]) => (
              <article key={label}>
                <i>{year}</i>
                <strong>{label}</strong>
                <span>{detail}</span>
              </article>
            ))}
          </div>
          <div className="big-actions">
            <button className="primary" onClick={() => onOpenPanel("quickRecord")} type="button">
              给这个阶段补一颗记忆星
            </button>
            <button className="secondary" onClick={() => onSelectTheme("父母人生")} type="button">
              写成父母人生家书
            </button>
            {selectedPlanet ? (
              <button
                className="secondary"
                onClick={() => void onPersistPlanetChange(selectedPlanet, { lifeState: "memorial" })}
                type="button"
              >
                设为纪念星
              </button>
            ) : null}
            {selectedPlanet?.lifeState === "memorial" ? (
              <button
                className="secondary"
                onClick={() => void onPersistPlanetChange(selectedPlanet, { lifeState: "active" })}
                type="button"
              >
                设为在世星球
              </button>
            ) : null}
          </div>
        </>
      ) : null}

      {activePanel === "quickRecord" ? (
        <>
          <h2>点亮记忆星</h2>
          <p>不用填完整表单。先留下一句话，AI 会把它整理成一颗可进入轨道的记忆星，你再决定是否补充细节。</p>
          <input className="panel-input" defaultValue="妈妈的星球" aria-label="这段记忆靠近哪颗星球" />
          <textarea
            aria-label="记忆内容"
            className="panel-textarea"
            onChange={(event) => onQuickRecordChange(event.target.value)}
            value={quickRecordContent}
          />
          <div className="ai-card">
            <strong>整理预览</strong>
            <p>AI 将尝试提取时间、地点、人物、事件和情绪；默认不公开，也不会自动分享。</p>
          </div>
          <div className="big-actions">
            <button className="primary" disabled={loading} onClick={onLightMemory} type="button">
              {loading ? "AI 整理中…" : "点亮为记忆星"}
            </button>
            <button className="secondary" onClick={() => onToast("语音入口已准备")} type="button">
              改用语音
            </button>
          </div>
        </>
      ) : null}

      {activePanel === "shareConfirm" ? (
        <>
          <h2>分享前确认</h2>
          <div className="tags">
            <span className="tag private">不会公开整颗星球</span>
            <span className="tag">可撤回</span>
          </div>
          <p>
            将分享《{book.title}》这一页家书。家人只能看到已选章节和来源说明，看不到其它私密记忆。
          </p>
          <div className="toggle-row">
            <span>展示家书正文</span>
            <i className="switch on" />
          </div>
          <div className="toggle-row">
            <span>展示来源记忆标题</span>
            <i className="switch on" />
          </div>
          <div className="toggle-row">
            <span>展示原始全文</span>
            <i className="switch" />
          </div>
          <div className="big-actions">
            <button className="primary" disabled={loading} onClick={onConfirmShare} type="button">
              {loading ? "生成链接中…" : "确认分享"}
            </button>
            <button className="secondary" onClick={onClose} type="button">
              再检查一下
            </button>
          </div>
          {shareUrl ? (
            <div className="ai-card share-link-card">
              <strong>分享链接已生成</strong>
              <p className="share-link-url">{shareUrl}</p>
              <div className="big-actions">
                <a
                  className="primary"
                  href={shareUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  在新标签页打开
                </a>
                <button
                  className="secondary"
                  onClick={() => {
                    void navigator.clipboard?.writeText(
                      `${window.location.origin}${shareUrl}`,
                    );
                    onToast("链接已复制");
                  }}
                  type="button"
                >
                  复制链接
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </motion.aside>
  );
}

function ProfilePanel({
  activePanel,
  onGo,
  onOpenPanel,
  onSelectTheme,
}: {
  activePanel: PanelKey;
  onGo: (zone: GalaxyZoneKey) => void;
  onOpenPanel: (key: PanelKey) => void;
  onSelectTheme: (theme: string) => void;
}) {
  if (activePanel === "mom") {
    return (
      <>
        <h2>妈妈的星球</h2>
        <div className="tags">
          <span className="tag public">家庭可见</span>
          <span className="tag">父母星球</span>
          <span className="tag">1968-现在</span>
        </div>
        <p>妈妈的星球不只是档案，而是一片可以靠近的时光。这里有她自己的讲述，也有家人从不同方向照过来的记忆。</p>
        <div className="signal-grid">
          <div className="signal">
            <strong>32</strong>
            <span>已点亮记忆星</span>
          </div>
          <div className="signal">
            <strong>1</strong>
            <span>正在发光的共鸣星轨</span>
          </div>
        </div>
        <div className="big-actions">
          <button className="primary" onClick={() => onGo("memories")} type="button">
            进入记忆星群
          </button>
          <button className="secondary" onClick={() => onGo("workshop")} type="button">
            调整星球气质
          </button>
        </div>
      </>
    );
  }

  if (activePanel === "child") {
    return (
      <>
        <h2>孩子的星轨</h2>
        <div className="tags">
          <span className="tag">父母可见</span>
          <span className="tag">成长星球</span>
          <span className="tag">里程碑</span>
        </div>
        <p>儿童星球更明亮，适合记录第一次、作品、生日和未来信。这里的交互应该像收藏星星，而不是填写成长表。</p>
        <div className="big-actions">
          <button className="primary" onClick={() => onOpenPanel("quickRecord")} type="button">
            点亮成长瞬间
          </button>
          <button className="secondary" onClick={() => onSelectTheme("亲子成长")} type="button">
            进入亲子成长星云
          </button>
        </div>
      </>
    );
  }

  if (activePanel === "friend") {
    return (
      <>
        <h2>公开旅行星</h2>
        <div className="tags">
          <span className="tag public">公开星球</span>
          <span className="tag">旅行星云</span>
        </div>
        <p>公开星球只展示你主动选择分享的章节。它可以很亮，但不会自动把私密记忆带到公开轨道上。</p>
        <div className="big-actions">
          <button className="primary" onClick={() => onSelectTheme("旅行星云")} type="button">
            用旅行星云生成星册
          </button>
        </div>
      </>
    );
  }

  if (activePanel === "legacy") {
    return (
      <>
        <h2>家族传承星云</h2>
        <div className="tags">
          <span className="tag memorial">纪念星汇总</span>
          <span className="tag">三代关系</span>
        </div>
        <p>这里汇总已过世成员与在世成员之间的记忆连接，形成家族的时间河流。</p>
        <div className="memory-list">
          <article>
            <strong>外婆 -&gt; 妈妈</strong>
            <p>一手菜谱与春节传统。</p>
          </article>
          <article>
            <strong>外公 -&gt; 我</strong>
            <p>童年时的一次火车旅行。</p>
          </article>
        </div>
        <div className="big-actions">
          <button className="primary" onClick={() => onSelectTheme("纪念星册")} type="button">
            写成传承家书
          </button>
        </div>
      </>
    );
  }

  if (activePanel === "grandpa") {
    return (
      <>
        <h2>外公的纪念星</h2>
        <div className="tags">
          <span className="tag memorial">已故成员</span>
          <span className="tag">1935-2018</span>
        </div>
        <p>纪念星域的语气会更克制，优先保留来源、时间和家人寄语，避免过度改写。</p>
      </>
    );
  }

  if (activePanel === "dad") {
    return (
      <>
        <h2>爸爸的星球</h2>
        <div className="tags">
          <span className="tag">家庭可见</span>
          <span className="tag">工作 / 旅行</span>
        </div>
        <p>爸爸的星球更安静，记忆节点少但很深。系统会优先提供慢节奏语音入口，而不是让他填写复杂信息。</p>
      </>
    );
  }

  return (
    <>
      <h2>我的星球</h2>
      <div className="tags">
        <span className="tag private">私密核心</span>
        <span className="tag">116 颗记忆星</span>
        <span className="tag">1996-现在</span>
      </div>
      <p>这是你的核心星球。它可以和家人形成星轨，但每一次共享、共鸣和生成家书前都会再次确认。</p>
      <div className="big-actions">
        <button className="primary" onClick={() => onOpenPanel("quickRecord")} type="button">
          点亮今天的记忆星
        </button>
        <button className="secondary" onClick={() => onGo("privacy")} type="button">
          查看隐私星域
        </button>
      </div>
    </>
  );
}

function ScopePanel({
  activePanel,
  planet,
  onSaveVisibility,
}: {
  activePanel: PanelKey;
  planet: Planet | null;
  onSaveVisibility: (visibility: Planet["visibility"]) => void;
}) {
  const visibilityLabel: Record<Planet["visibility"], string> = {
    private: "私密核心",
    family: "家庭可见",
    selected: "指定家人可见",
    public: "公开分享",
  };
  const visibilityControls = planet ? (
    <div className="big-actions">
      <p>当前可见范围：{visibilityLabel[planet.visibility]}</p>
      <button className="secondary" onClick={() => onSaveVisibility("private")} type="button">
        设为私密核心
      </button>
      <button className="secondary" onClick={() => onSaveVisibility("family")} type="button">
        设为家庭可见
      </button>
      <button className="secondary" onClick={() => onSaveVisibility("public")} type="button">
        设为公开分享
      </button>
    </div>
  ) : null;

  if (activePanel === "scopePrivate") {
    return (
      <>
        <h2>私密核心</h2>
        <div className="tags">
          <span className="tag private">仅自己可见</span>
        </div>
        <p>适合个人日记、未整理的情绪、尚未确认的记忆。AI 可以帮你整理，但不会自动产生家庭共鸣。</p>
        <div className="toggle-row">
          <span>允许 AI 整理</span>
          <i className="switch on" />
        </div>
        <div className="toggle-row">
          <span>允许进入共鸣候选</span>
          <i className="switch" />
        </div>
        {visibilityControls}
      </>
    );
  }

  if (activePanel === "scopeFamily") {
    return (
      <>
        <h2>家庭可见星域</h2>
        <div className="tags">
          <span className="tag">家庭成员可见</span>
        </div>
        <p>适合家庭旅行、节日、生日和亲子成长。共同记忆识别需要双方允许，生成家书前仍需确认。</p>
        <div className="toggle-row">
          <span>允许家庭成员查看</span>
          <i className="switch on" />
        </div>
        {visibilityControls}
      </>
    );
  }

  return (
    <>
      <h2>公开分享轨道</h2>
      <div className="tags">
        <span className="tag public">链接可访问</span>
      </div>
      <p>只用于对外分享的家书页、旅行星册或故事长图。公开的是成册内容，不是整颗星球。</p>
      <div className="toggle-row">
        <span>公开成册内容</span>
        <i className="switch on" />
      </div>
      <div className="toggle-row">
        <span>公开原始素材</span>
        <i className="switch" />
      </div>
      {visibilityControls}
    </>
  );
}

function RenamePlanetDialog({
  name,
  onCancel,
  onNameChange,
  onSave,
  planet,
}: {
  name: string;
  onCancel: () => void;
  onNameChange: (value: string) => void;
  onSave: () => void;
  planet: Planet;
}) {
  return (
    <motion.section
      animate={{ opacity: 1, y: 0, scale: 1 }}
      aria-label="重命名星球"
      aria-modal="true"
      className="panel open"
      initial={{ opacity: 0, y: 18, scale: 0.96 }}
      role="dialog"
      transition={{ duration: 0.2 }}
    >
      <h2>重命名「{planet.name}」</h2>
      <p>名称会在服务端确认后更新到这颗星球，原有星轨和漫游状态保持不变。</p>
      <label>
        星球名称
        <input
          aria-label="星球名称"
          className="panel-input"
          onChange={(event) => onNameChange(event.target.value)}
          value={name}
        />
      </label>
      <div className="big-actions">
        <button className="primary" onClick={onSave} type="button">
          保存名称
        </button>
        <button className="secondary" onClick={onCancel} type="button">
          取消
        </button>
      </div>
    </motion.section>
  );
}

function BookBeamOverlay({
  planet,
  onClose,
  onPreview,
  onShareConfirm,
}: {
  planet: Planet;
  onClose: () => void;
  onPreview: () => void;
  onShareConfirm: () => void;
}) {
  const memories = memoryStars.filter((memory) => memory.planetId === planet.id).slice(0, 3);

  return (
    <motion.section
      animate={{ opacity: 1, scale: 1 }}
      aria-label="家书光束"
      aria-modal="true"
      className="book-beam-overlay"
      exit={{ opacity: 0, scale: 0.98 }}
      initial={{ opacity: 0, scale: 0.98 }}
      role="dialog"
      transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <button aria-label="关闭家书光束" className="beam-close" onClick={onClose} type="button">
        <X size={16} />
      </button>
      <div className="beam-core">
        <i />
        <span />
        <b />
      </div>
      <div className="beam-copy">
        <p className="panel-kicker">家书光束</p>
        <h2>记忆星正在收束成一页家书</h2>
        <p>
          已从「{planet.name}」选中可写入的记忆星。这里先以光束预览承接生成动作，后续再接真实 AI 和来源确认。
        </p>
        <div className="beam-memory-row">
          {(memories.length ? memories : memoryStars.slice(0, 3)).map((memory) => (
            <span key={memory.id}>{memory.title}</span>
          ))}
        </div>
        <div className="big-actions">
          <button className="primary" onClick={onPreview} type="button">
            展开家书预览
          </button>
          <button className="secondary" onClick={onShareConfirm} type="button">
            分享前确认
          </button>
        </div>
      </div>
    </motion.section>
  );
}

function PlanetRoamingOverlay({
  planet,
  onBook,
  onClose,
  onQuickRecord,
}: {
  planet: Planet;
  onBook: () => void;
  onClose: () => void;
  onQuickRecord: () => void;
}) {
  const nodes = storyNodes.filter((node) => node.planetId === planet.id);
  const memories = memoryStars.filter((memory) => memory.planetId === planet.id);
  const [activeNodeId, setActiveNodeId] = useState(nodes[0]?.id);
  const [storySceneNodeId, setStorySceneNodeId] = useState<string | null>(null);
  const activeNode = nodes.find((node) => node.id === activeNodeId) ?? nodes[0];
  const storySceneNode = nodes.find((node) => node.id === storySceneNodeId) ?? null;

  return (
    <motion.section
      animate={{ opacity: 1, scale: 1 }}
      aria-label={`${planet.name}漫游`}
      aria-modal="true"
      className="planet-explorer open"
      exit={{ opacity: 0, scale: 1.018 }}
      initial={{ opacity: 0, scale: 1.018 }}
      role="dialog"
      transition={{ duration: 0.36, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <div className="planet-explorer-shell">
        <aside className="planet-explorer-card planet-left">
          <div className="planet-breadcrumb">
            <button aria-label="返回星系" className="back-planet" onClick={onClose} type="button">
              <X size={16} />
            </button>
            <span>返回星系</span>
          </div>
          <div className="inner-planet-preview">
            <div className={`inner-planet-body ${planet.type}`} />
          </div>
          <div>
            <h2>{planet.name}</h2>
            <p>{planet.summary}</p>
          </div>
          <div className="planet-stat-grid">
            <span>
              <strong>{planet.stats.memoryStars}</strong>
              记忆星
            </span>
            <span>
              <strong>{planet.stats.resonanceTracks}</strong>
              星轨
            </span>
            <span>
              <strong>{planet.stats.bookDrafts}</strong>
              家书
            </span>
          </div>
          <div className="big-actions">
            <button aria-label="星球漫游点亮记忆星" className="primary" onClick={onQuickRecord} type="button">
              点亮记忆星
            </button>
            <button aria-label="星球漫游写成家书" className="secondary" onClick={onBook} type="button">
              写成家书
            </button>
          </div>
        </aside>

        <section className="planet-explorer-card planet-center">
          <div className="surface-stage">
            <div className="surface-orbit o1" />
            <div className="surface-orbit o2" />
            <div className="surface-orbit o3" />
            <div className="scanner-beam" />
            {nodes.map((node, index) => (
              <button
                aria-label={`打开故事场景：${node.year} ${node.title}`}
                className={`story-node n${index + 1} ${node.id === activeNode?.id ? "active" : ""}`}
                key={node.id}
                onClick={() => {
                  setActiveNodeId(node.id);
                  setStorySceneNodeId(node.id);
                }}
                type="button"
              >
                <i>{node.year}</i>
                <span>{node.title}</span>
              </button>
            ))}
            <div className="surface-caption">
              <h2>星球漫游</h2>
              <p>{activeNode?.summary ?? "点击轨道上的故事星，查看这颗星球的时间轨迹与记忆。"}</p>
            </div>
          </div>
        </section>

        <aside className="planet-explorer-card planet-right">
          <h3>时间轨迹</h3>
          <div className="timeline-list">
            {nodes.map((node) => (
              <button
                className={node.id === activeNode?.id ? "active" : ""}
                key={node.id}
                onClick={() => setActiveNodeId(node.id)}
                type="button"
              >
                <strong>{node.year}</strong>
                <span>{node.title}</span>
              </button>
            ))}
          </div>
          <div className="story-detail">
            <strong>{activeNode?.title ?? "选择一颗故事星"}</strong>
            <p>{activeNode?.sourceLabel ?? "这里会展示时间、地点、人物、情绪和可生成家书的线索。"}</p>
            <div className="planet-action-grid">
              <button className="mini-action" onClick={onQuickRecord} type="button">
                补充视角
              </button>
              <button className="mini-action" onClick={onBook} type="button">
                写成家书
              </button>
            </div>
          </div>
          <div className="planet-theme-lab">
            <h3>个人星球主题</h3>
            <div className="tags">
              <span className="tag">{planet.theme}</span>
              <span className="tag">补充视角</span>
              <span className="tag">扫描记忆星</span>
            </div>
          </div>
          <div className="memory-list">
            {memories.map((memory) => (
              <article key={memory.id}>
                <strong>{memory.title}</strong>
                <p>{memory.summary}</p>
              </article>
            ))}
          </div>
        </aside>
      </div>
      {storySceneNode ? (
        <StorySceneOverlay
          node={storySceneNode}
          onAddToBook={() => {
            setStorySceneNodeId(null);
            onBook();
          }}
          onClose={() => setStorySceneNodeId(null)}
        />
      ) : null}
    </motion.section>
  );
}

function StorySceneOverlay({
  node,
  onAddToBook,
  onClose,
}: {
  node: (typeof storyNodes)[number];
  onAddToBook: () => void;
  onClose: () => void;
}) {
  return (
    <motion.section
      animate={{ opacity: 1, y: 0 }}
      aria-label={`${node.title}故事场景`}
      aria-modal="true"
      className="story-scene-overlay"
      exit={{ opacity: 0, y: 16 }}
      initial={{ opacity: 0, y: 24 }}
      role="dialog"
      transition={{ duration: 0.26, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <button aria-label="返回星球" className="beam-close" onClick={onClose} type="button">
        <X size={16} />
      </button>
      <div className="story-fragments">
        <span>漂浮照片碎片</span>
        <i />
        <b />
      </div>
      <div className="story-scene-copy">
        <p className="panel-kicker">故事场景 · {node.year}</p>
        <h2>{node.title}</h2>
        <p>{node.summary}</p>
        <div className="story-dust-tags">
          <span>时间：{node.year}</span>
          <span>来源：{node.sourceLabel}</span>
          <span>情绪：团圆 / 安定</span>
        </div>
        <div className="big-actions">
          <button className="primary" onClick={onClose} type="button">
            补充一句话
          </button>
          <button className="secondary" onClick={onClose} type="button">
            邀请家人
          </button>
          <button className="secondary" onClick={onAddToBook} type="button">
            加入家书
          </button>
          <button className="secondary" onClick={onClose} type="button">
            设权限
          </button>
        </div>
      </div>
    </motion.section>
  );
}
