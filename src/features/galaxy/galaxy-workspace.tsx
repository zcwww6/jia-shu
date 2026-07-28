"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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
  getPlanetPresentationType,
  type GalaxyZoneKey,
  type MemoryStar,
  type Planet,
  type PlanetLink,
  type PlanetLinkKind,
  type StoryNode,
} from "@/shared/types/galaxy";

import {
  confirmLegacyResonance,
  scanLegacyResonances,
  type LegacyPendingResonance,
} from "./legacy-resonance-api";
import {
  confirmLegacyMemory,
  createLegacyMemoryDraft,
  getLegacyMemoryAiJob,
  getLegacyMemoryReview,
  startLegacyMemoryExtraction,
  type LegacyMemoryAiJob,
  type LegacyMemoryResponse,
} from "./legacy-memory-api";
import {
  uploadLegacyAsset,
  type LegacyAsset,
} from "./legacy-asset-api";
import {
  archiveLegacyPlanet,
  createLegacyPlanet,
  createLegacyRelationship,
  restoreLegacyPlanet,
  updateLegacyPlanet,
  type LegacyManagedPlanet,
  type LegacyPlanetUpdate,
} from "./legacy-galaxy-api";
import {
  createLegacyBook,
  createLegacyBookShare,
  getLegacyBook,
  LegacyBookApiError,
  listLegacyBookShares,
  revokeLegacyBookShare,
  updateLegacyBook,
  type LegacyBookDetail,
  type LegacyBookShare,
  type LegacyBookShareOptions,
  type LegacyBookVisibility,
} from "./legacy-book-api";
import { FamilyBookReader } from "@/features/books/family-book-reader";
import { planetThemeStyle } from "./planet-theme";
import { PlanetThemeStudio } from "./planet-theme-studio";

interface GalaxyView {
  panX: number;
  panY: number;
  zoom: number;
  rotate: number;
}

type PanelKey =
  | "scopePrivate"
  | "scopeFamily"
  | "scopePublic"
  | "memory1"
  | "resonance"
  | "privacy"
  | "lifecycle"
  | "quickRecord";

const galaxyNavigation: Array<{ key: GalaxyZoneKey; label: string }> = [
  { key: "galaxy", label: "我的星系" },
  { key: "privacy", label: "隐私星域" },
  { key: "memorial", label: "纪念星域" },
  { key: "workshop", label: "星球工坊" },
  { key: "memories", label: "记忆星群" },
  { key: "resonance", label: "共鸣星轨" },
  { key: "themes", label: "主题星云" },
  { key: "books", label: "家书工坊" },
];

type LegacyPlanetChanges = Omit<LegacyPlanetUpdate, "id" | "version">;

const bookWorkshopLockMessage = "请先确认一条共鸣星轨，再进入家书工坊。";

function sourceMemoryIdsForConfirmedResonance(candidate: LegacyPendingResonance | undefined) {
  if (!candidate?.sourceMemoryId || !candidate.targetMemoryId) return null;

  const sourceMemoryIds = [...new Set([candidate.sourceMemoryId, candidate.targetMemoryId])];
  return sourceMemoryIds.length === 2 ? sourceMemoryIds : null;
}

const initialView: GalaxyView = {
  panX: 0,
  panY: 0,
  zoom: 1,
  rotate: 0,
};

type RouteStepAction = "book" | "create" | "memory" | "planet" | "quickRecord" | "resonance";

type RouteStep = {
  action: RouteStepAction;
  detail: string;
  label: string;
  targetId?: string;
};

function buildRouteSteps(planets: Planet[], memories: MemoryStar[]): RouteStep[] {
  const primaryPlanet = planets.find((planet) => planet.type === "parent") ?? planets[0];
  if (!primaryPlanet) {
    return [{
      action: "create",
      detail: "先为一位真实家人创建星球，后续的记忆、共鸣与家书才会有可信来源。",
      label: "创建第一颗家人星球",
    }];
  }

  const primaryMemory = memories.find((memory) => memory.planetId === primaryPlanet.id) ?? memories[0];
  return [
    {
      action: "planet",
      detail: `靠近${primaryPlanet.name}，从这颗真实星球开始漫游。`,
      label: `靠近${primaryPlanet.name}`,
      targetId: primaryPlanet.id,
    },
    primaryMemory ? {
      action: "memory",
      detail: `打开已确认的「${primaryMemory.title}」，查看可追溯的家庭记忆。`,
      label: `查看${primaryMemory.title}`,
      targetId: primaryMemory.id,
    } : {
      action: "quickRecord",
      detail: `为${primaryPlanet.name}留下第一段真实记忆，再交给 AI 整理。`,
      label: `记录${primaryPlanet.name}的一段记忆`,
      targetId: primaryPlanet.id,
    },
    {
      action: "resonance",
      detail: "从已确认记忆发起扫描，只有家人确认后才会形成共鸣星轨。",
      label: "查看共鸣候选",
    },
    {
      action: "book",
      detail: "只将已确认共鸣的真实来源写成家书，并在分享前再次确认。",
      label: "写成一页家书",
    },
  ];
}

const planetClassByType: Record<Planet["type"], string> = {
  self: "planet me private-planet has-ring",
  parent: "planet mom has-ring",
  child: "planet child has-ring",
  memorial: "planet ancestor memorial-planet has-ring",
  public: "planet friend public-planet",
  partner: "planet friend has-ring",
  other: "planet friend has-ring",
};

const memoryPollAttempts = 20;
const memoryPollDelayMs = 250;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "请求失败，请稍后重试。";
}

function resonanceCandidateLabel(candidate: LegacyPendingResonance, memories: MemoryStar[]) {
  const source = memories.find((memory) => memory.id === candidate.sourceMemoryId);
  const target = memories.find((memory) => memory.id === candidate.targetMemoryId);

  return `共鸣候选：${source?.title ?? "来源记忆"} ↔ ${target?.title ?? "目标记忆"}`;
}

function safeMemorySummary(memory: MemoryStar | null) {
  return memory?.summary.trim() || "这条已确认记忆暂未填写摘要。";
}

type MemoryPollingControl = {
  signal: AbortSignal;
  isCurrent: () => boolean;
};

type MemoryFlowOperation = {
  controller: AbortController;
};

type ResonanceScanOperation = {
  controller: AbortController;
};

type MemoryDraftContext = {
  draftId: string;
  signature: string;
};

type QuickRecordSource = "text" | "image" | "audio" | "document";

type UploadedQuickRecordAsset = {
  asset: LegacyAsset;
  signature: string;
};

type GrowingBookSummary = {
  id: string;
  title: string | null;
  status: "draft" | "ready";
  memoryCount: number;
};

type ActiveLegacyBook = LegacyBookDetail & { sourceLabelList: string[] };

type BookOperation = {
  bookId: string | null;
  generation: number;
  requestId: number;
};

function isExpiredIdempotencyError(error: unknown): error is LegacyBookApiError {
  return error instanceof LegacyBookApiError
    && error.status === 409
    && error.code === "IDEMPOTENCY_EXPIRED";
}

const expiredIdempotencyRetryMessage = "请求已过期，已准备好新的请求，请直接重试。";

function clearMatchingExpiredRequestKey(
  currentKey: string | undefined,
  requestKey: string,
  clearRequestKey: () => void,
) {
  if (currentKey === requestKey) clearRequestKey();
}

const themeTemplateKeyByLabel: Record<string, string> = {
  "家庭团圆": "family_reunion",
  "父母人生": "parent_life",
  "亲子成长": "child_growth",
  "纪念星册": "memorial_album",
  "旅行星云": "travel_memories",
  "伴侣星云": "couple_story",
};

function buildMemoryDraftSignature(
  planetId: string,
  source: QuickRecordSource,
  sourceText: string,
  file: File | null,
) {
  return JSON.stringify({
    planetId,
    source,
    sourceText: source === "text" ? sourceText : "",
    file: source === "text" || !file ? null : {
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      type: file.type,
    },
    visibility: "family",
    allowResonance: true,
    allowBook: true,
  });
}

function planetCoverUrl(assetId: string) {
  return `/api/assets/${encodeURIComponent(assetId)}/content`;
}

function planetCoverStyle(assetId: string | null | undefined): CSSProperties | undefined {
  if (!assetId) return undefined;

  return { "--planet-cover": `url("${planetCoverUrl(assetId)}")` } as CSSProperties;
}

function planetPresentationStyle(planet: Pick<Planet, "coverAssetId" | "theme">): CSSProperties {
  return {
    ...planetThemeStyle(planet.theme),
    ...planetCoverStyle(planet.coverAssetId),
  };
}

async function waitForMemoryPollDelay(signal: AbortSignal) {
  return new Promise<boolean>((resolve) => {
    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, memoryPollDelayMs);
    const onAbort = () => {
      window.clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      resolve(false);
    };

    if (signal.aborted) {
      onAbort();
      return;
    }

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function waitForMemoryExtraction(
  initialJob: LegacyMemoryAiJob,
  onJobUpdate: (job: LegacyMemoryAiJob) => void,
  control: MemoryPollingControl,
) {
  let job = initialJob;
  if (!control.isCurrent() || control.signal.aborted) return false;
  onJobUpdate(job);

  for (let attempt = 0; attempt < memoryPollAttempts; attempt += 1) {
    if (!control.isCurrent() || control.signal.aborted) return false;
    if (job.status === "completed" || job.status === "succeeded") return true;
    if (job.status === "failed") {
      throw new Error(job.error ?? job.errorCode ?? "AI 整理失败，请稍后重试。");
    }
    if (job.status !== "queued" && job.status !== "processing") {
      throw new Error("AI 作业状态异常，请稍后重试。");
    }

    if (!(await waitForMemoryPollDelay(control.signal)) || !control.isCurrent()) return false;
    job = await getLegacyMemoryAiJob(job.id, { signal: control.signal });
    if (!control.isCurrent() || control.signal.aborted) return false;
    onJobUpdate(job);
  }

  throw new Error("AI 整理仍在进行中，请稍后重试。");
}

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
    tags: ["推荐航线", "星球漫游", "真实星球"],
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
    body: "主题与私人封面会保存到当前星球；材质预览和星图筛选只服务当前浏览，不会改写家庭故事。",
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
  initialPlanets,
  initialLinks = [],
  initialArchivedPlanets = [],
  initialConfirmedMemories = [],
  initialConfirmedResonances = [],
  initialPendingResonances = [],
  initialGrowingBooks = [],
}: {
  initialPlanets?: Planet[];
  initialLinks?: PlanetLink[];
  initialArchivedPlanets?: Planet[];
  initialConfirmedMemories?: MemoryStar[];
  initialConfirmedResonances?: LegacyPendingResonance[];
  initialPendingResonances?: LegacyPendingResonance[];
  initialGrowingBooks?: GrowingBookSummary[];
}) {
  const startingPlanets = initialPlanets ?? [];
  const [activeZone, setActiveZone] = useState<GalaxyZoneKey>("galaxy");
  const [activeRouteStep, setActiveRouteStep] = useState(0);
  const [activePanel, setActivePanel] = useState<PanelKey | null>(null);
  const [roamingPlanetId, setRoamingPlanetId] = useState<string | null>(null);
  const [selectedPlanetId, setSelectedPlanetId] = useState<string | null>(null);
  const [closingPlanetId, setClosingPlanetId] = useState<string | null>(null);
  const [layerDockPinned, setLayerDockPinned] = useState(false);
  const [elderMode, setElderMode] = useState(false);
  const [immersiveMode, setImmersiveMode] = useState(true);
  const [autoCruise, setAutoCruise] = useState(true);
  const [routeCollapsed, setRouteCollapsed] = useState(true);
  const [selectedWorkshopZone, setSelectedWorkshopZone] = useState<GalaxyZoneKey>("galaxy");
  const [selectedWorkshopBg, setSelectedWorkshopBg] = useState("家书暖夜");
  const [selectedWorkshopMaterial, setSelectedWorkshopMaterial] = useState("柔光釉面");
  const [selectedPlanetCoverFile, setSelectedPlanetCoverFile] = useState<File | null>(null);
  const [selectedPlanetCoverPreviewUrl, setSelectedPlanetCoverPreviewUrl] = useState<string | null>(null);
  const [planetCoverSaving, setPlanetCoverSaving] = useState(false);
  const [selectedTheme, setSelectedTheme] = useState("家庭团圆");
  const [renamePlanetTarget, setRenamePlanetTarget] = useState<Planet | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [view, setView] = useState<GalaxyView>(initialView);
  const [isDragging, setIsDragging] = useState(false);
  const [galaxyPlanets, setGalaxyPlanets] = useState<Planet[]>(startingPlanets);
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
  const memoryFlowOperationRef = useRef<MemoryFlowOperation | null>(null);
  const resonanceScanOperationRef = useRef<ResonanceScanOperation | null>(null);
  const assetUploadRequestRef = useRef<{ key: string; signature: string } | null>(null);
  const memoryDraftRequestRef = useRef<{ key: string; signature: string } | null>(null);
  const memoryDraftContextRef = useRef<MemoryDraftContext | null>(null);
  const memoryJobRequestRef = useRef<{ draftId: string; key: string } | null>(null);
  const bookGenerationRequestRef = useRef<{ key: string; signature: string } | null>(null);
  const bookShareRequestRef = useRef<{ key: string; signature: string } | null>(null);
  const bookShareRevokeRequestRef = useRef(new Map<string, string>());
  const bookOperationRef = useRef<BookOperation>({ bookId: null, generation: 0, requestId: 0 });

  const [quickRecordContent, setQuickRecordContent] = useState("");
  const [quickRecordSource, setQuickRecordSource] = useState<QuickRecordSource>("text");
  const [quickRecordFile, setQuickRecordFile] = useState<File | null>(null);
  const [uploadedQuickRecordAsset, setUploadedQuickRecordAsset] = useState<UploadedQuickRecordAsset | null>(null);
  const [pendingResonances, setPendingResonances] = useState<LegacyPendingResonance[]>(initialPendingResonances);
  const [selectedResonanceId, setSelectedResonanceId] = useState<string | null>(null);
  const [resonanceLoading, setResonanceLoading] = useState(false);
  const [resonanceError, setResonanceError] = useState<string | null>(null);
  const [resonanceDecisionMessage, setResonanceDecisionMessage] = useState<string | null>(null);
  const [confirmedResonanceSourceMemoryIds, setConfirmedResonanceSourceMemoryIds] = useState<string[] | null>(
    () => initialConfirmedResonances
      .map(sourceMemoryIdsForConfirmedResonance)
      .find((sourceMemoryIds): sourceMemoryIds is string[] => sourceMemoryIds !== null)
      ?? null,
  );
  const [litMemories, setLitMemories] = useState<MemoryStar[]>(initialConfirmedMemories);
  const [quickRecordTargetPlanetId, setQuickRecordTargetPlanetId] = useState<string | null>(null);
  const [memoryReview, setMemoryReview] = useState<LegacyMemoryResponse | null>(null);
  const [reviewTitle, setReviewTitle] = useState("");
  const [reviewSummary, setReviewSummary] = useState("");
  const [memoryDraftId, setMemoryDraftId] = useState<string | null>(null);
  const [memoryJob, setMemoryJob] = useState<LegacyMemoryAiJob | null>(null);
  const [memoryFlowLoading, setMemoryFlowLoading] = useState(false);
  const [memoryFlowError, setMemoryFlowError] = useState<string | null>(null);
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | null>(null);
  const [growingBooks, setGrowingBooks] = useState<GrowingBookSummary[]>(initialGrowingBooks);
  const [activeBook, setActiveBook] = useState<ActiveLegacyBook | null>(null);
  const [bookEditorOpen, setBookEditorOpen] = useState(false);
  const [bookTitleDraft, setBookTitleDraft] = useState("");
  const [bookBodyDraft, setBookBodyDraft] = useState("");
  const [bookVisibility, setBookVisibility] = useState<LegacyBookVisibility>("family");
  const [bookLoading, setBookLoading] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);
  const [bookSaveError, setBookSaveError] = useState<string | null>(null);
  const [shareOptions, setShareOptions] = useState<LegacyBookShareOptions>({
    showBody: true,
    showSourceTitles: true,
    showOriginalText: false,
  });
  const [bookShares, setBookShares] = useState<LegacyBookShare[]>([]);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const hasConfirmedResonance = confirmedResonanceSourceMemoryIds !== null;
  const routeSteps = useMemo(
    () => buildRouteSteps(galaxyPlanets, litMemories),
    [galaxyPlanets, litMemories],
  );

  const activeZoneContent = zoneContent[activeZone];
  const isGalaxyScene = activeZone === "galaxy";
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

  useEffect(() => () => {
    if (selectedPlanetCoverPreviewUrl && typeof URL.revokeObjectURL === "function") {
      URL.revokeObjectURL(selectedPlanetCoverPreviewUrl);
    }
  }, [selectedPlanetCoverPreviewUrl]);
  const roamingPlanet = galaxyPlanets.find((planet) => planet.id === roamingPlanetId) ?? null;
  const quickRecordTarget = galaxyPlanets.find((planet) => planet.id === quickRecordTargetPlanetId) ?? null;
  const quickRecordDraftSignature = quickRecordTarget
    ? buildMemoryDraftSignature(
      quickRecordTarget.id,
      quickRecordSource,
      quickRecordContent.trim(),
      quickRecordFile,
    )
    : null;
  const hasMatchingMemoryDraft = Boolean(
    memoryDraftId &&
    quickRecordDraftSignature &&
    memoryDraftContextRef.current?.draftId === memoryDraftId &&
    memoryDraftContextRef.current.signature === quickRecordDraftSignature,
  );
  const memoryPrimaryActionLabel = hasMatchingMemoryDraft
    ? memoryFlowError ? "重试整理" : "继续整理"
    : quickRecordSource === "text" ? "点亮为记忆星" : "发送给 AI 整理";
  const selectedMemory = selectedMemoryId
    ? litMemories.find((memory) => memory.id === selectedMemoryId) ?? null
    : null;
  const selectedResonance = selectedResonanceId
    ? pendingResonances.find((candidate) => candidate.id === selectedResonanceId) ?? null
    : null;
  const activeResonance = selectedResonance ?? pendingResonances[0] ?? null;
  const resonanceSourceMemory = activeResonance
    ? litMemories.find((memory) => memory.id === activeResonance.sourceMemoryId) ?? null
    : null;
  const resonanceTargetMemory = activeResonance
    ? litMemories.find((memory) => memory.id === activeResonance.targetMemoryId) ?? null
    : null;
  const resonanceSourcePlanet = resonanceSourceMemory
    ? galaxyPlanets.find((planet) => planet.id === resonanceSourceMemory.planetId) ?? null
    : null;
  const resonanceTargetPlanet = resonanceTargetMemory
    ? galaxyPlanets.find((planet) => planet.id === resonanceTargetMemory.planetId) ?? null
    : null;
  const confirmedBookSources = useMemo(() => {
    if (!confirmedResonanceSourceMemoryIds) return [];

    const titleById = new Map(litMemories.map((memory) => [memory.id, memory.title]));
    return confirmedResonanceSourceMemoryIds.map((id) => ({
      id,
      title: titleById.get(id)?.trim() || "已确认记忆",
    }));
  }, [confirmedResonanceSourceMemoryIds, litMemories]);
  const canOpenSavedBooks = growingBooks.length > 0;

  function abortMemoryFlowOperation() {
    memoryFlowOperationRef.current?.controller.abort();
    memoryFlowOperationRef.current = null;
  }

  function cancelMemoryFlowOperation() {
    const hasActiveMemoryFlow = memoryFlowOperationRef.current !== null;
    abortMemoryFlowOperation();
    if (hasActiveMemoryFlow) setMemoryFlowLoading(false);
  }

  function beginMemoryFlowOperation() {
    abortMemoryFlowOperation();
    const operation = {
      controller: new AbortController(),
    };
    memoryFlowOperationRef.current = operation;
    return operation;
  }

  function isCurrentMemoryFlowOperation(operation: MemoryFlowOperation) {
    return memoryFlowOperationRef.current === operation && !operation.controller.signal.aborted;
  }

  function abortResonanceScanOperation() {
    resonanceScanOperationRef.current?.controller.abort();
    resonanceScanOperationRef.current = null;
  }

  function cancelResonanceScanOperation() {
    const hasActiveResonanceScan = resonanceScanOperationRef.current !== null;
    abortResonanceScanOperation();
    if (hasActiveResonanceScan) setResonanceLoading(false);
  }

  function beginResonanceScanOperation() {
    abortResonanceScanOperation();
    const operation = {
      controller: new AbortController(),
    };
    resonanceScanOperationRef.current = operation;
    return operation;
  }

  function isCurrentResonanceScanOperation(operation: ResonanceScanOperation) {
    return resonanceScanOperationRef.current === operation && !operation.controller.signal.aborted;
  }

  function resetMemoryRequestKeys() {
    memoryDraftRequestRef.current = null;
    memoryJobRequestRef.current = null;
  }

  function resetAssetUploadRequestKey() {
    assetUploadRequestRef.current = null;
  }

  function clearMemoryDraftState() {
    setMemoryReview(null);
    setMemoryDraftId(null);
    setMemoryJob(null);
    setMemoryFlowError(null);
    memoryDraftContextRef.current = null;
    resetMemoryRequestKeys();
  }

  function changeQuickRecordSource(source: QuickRecordSource) {
    if (source === quickRecordSource) return;

    cancelMemoryFlowOperation();
    setQuickRecordSource(source);
    setQuickRecordFile(null);
    setUploadedQuickRecordAsset(null);
    resetAssetUploadRequestKey();
    clearMemoryDraftState();
  }

  function changeQuickRecordFile(file: File | null) {
    cancelMemoryFlowOperation();
    setQuickRecordFile(file);
    setUploadedQuickRecordAsset(null);
    resetAssetUploadRequestKey();
    clearMemoryDraftState();
  }

  function memoryDraftRequestKey(signature: string) {
    const current = memoryDraftRequestRef.current;
    if (current?.signature === signature) return current.key;

    const key = crypto.randomUUID();
    memoryDraftRequestRef.current = { key, signature };
    return key;
  }

  function assetUploadRequestKey(signature: string) {
    const current = assetUploadRequestRef.current;
    if (current?.signature === signature) return current.key;

    const key = crypto.randomUUID();
    assetUploadRequestRef.current = { key, signature };
    return key;
  }

  function memoryJobRequestKey(draftId: string, freshAttempt = false) {
    const current = memoryJobRequestRef.current;
    if (!freshAttempt && current?.draftId === draftId) return current.key;

    const key = crypto.randomUUID();
    memoryJobRequestRef.current = { draftId, key };
    return key;
  }

  function bookGenerationRequestKey(signature: string) {
    const current = bookGenerationRequestRef.current;
    if (current?.signature === signature) return current.key;

    const key = crypto.randomUUID();
    bookGenerationRequestRef.current = { key, signature };
    return key;
  }

  function bookShareRequestKey(signature: string) {
    const current = bookShareRequestRef.current;
    if (current?.signature === signature) return current.key;

    const key = crypto.randomUUID();
    bookShareRequestRef.current = { key, signature };
    return key;
  }

  function bookShareRevokeRequestKey(bookId: string, token: string) {
    const signature = `${bookId}:${token}`;
    const current = bookShareRevokeRequestRef.current.get(signature);
    if (current) return current;

    const key = crypto.randomUUID();
    bookShareRevokeRequestRef.current.set(signature, key);
    return key;
  }

  function beginBookOperation(bookId: string | null) {
    const current = bookOperationRef.current;
    const operation = {
      bookId,
      generation: current.generation + 1,
      requestId: current.requestId + 1,
    };
    bookOperationRef.current = operation;
    return operation;
  }

  function currentBookOperation(bookId: string) {
    const operation = bookOperationRef.current;
    return operation.bookId === bookId ? operation : null;
  }

  function isCurrentBookOperation(operation: BookOperation) {
    const current = bookOperationRef.current;
    return current.bookId === operation.bookId
      && current.generation === operation.generation
      && current.requestId === operation.requestId;
  }

  function applyActiveBook(book: LegacyBookDetail, sourceLabelList: string[]) {
    setActiveBook({ ...book, sourceLabelList });
    setBookEditorOpen(false);
    setBookTitleDraft(book.title);
    setBookBodyDraft(book.body);
    setBookVisibility(book.visibility);
  }

  async function loadActiveBookShares(bookId: string, operation: BookOperation) {
    try {
      const result = await listLegacyBookShares(bookId);
      if (isCurrentBookOperation(operation)) setBookShares(result.shares);
    } catch (error) {
      if (isCurrentBookOperation(operation)) setShareError(errorMessage(error));
    }
  }

  async function openSavedBook(bookId: string, knownSourceLabels: string[] = []) {
    const operation = beginBookOperation(bookId);
    setBookLoading(true);
    setShareLoading(false);
    setBookError(null);
    setBookSaveError(null);
    setBookShares([]);
    setShareError(null);
    setActiveBook(null);
    setBookEditorOpen(false);
    setBookTitleDraft("");
    setBookBodyDraft("");
    try {
      const book = await getLegacyBook(bookId);
      if (!isCurrentBookOperation(operation)) return;
      const sourceLabelList = knownSourceLabels.length > 0
        ? knownSourceLabels
        : Object.values(book.sourceLabels);
      applyActiveBook(book, sourceLabelList);
      await loadActiveBookShares(bookId, operation);
    } catch (error) {
      if (isCurrentBookOperation(operation)) setBookError(errorMessage(error));
    } finally {
      if (isCurrentBookOperation(operation)) setBookLoading(false);
    }
  }

  function returnToBookShelf() {
    const current = bookOperationRef.current;
    bookOperationRef.current = {
      bookId: null,
      generation: current.generation + 1,
      requestId: current.requestId + 1,
    };
    setActiveBook(null);
    setBookEditorOpen(false);
    setBookError(null);
    setBookSaveError(null);
    setShareError(null);
  }

  async function generateLegacyBook() {
    if (!hasConfirmedResonance || !confirmedResonanceSourceMemoryIds) {
      setBookError(bookWorkshopLockMessage);
      return;
    }

    if (confirmedBookSources.length !== confirmedResonanceSourceMemoryIds.length) {
      setBookError("这条共鸣星轨的来源尚未获得生成家书授权。");
      return;
    }

    const input = {
      ...(bookTitleDraft.trim() ? { title: bookTitleDraft.trim() } : {}),
      sourceMemoryIds: confirmedBookSources.map((source) => source.id),
      sourceRange: "binary_system" as const,
      themeTemplateKey: themeTemplateKeyByLabel[selectedTheme] ?? selectedTheme,
      visibility: bookVisibility,
    };
    const requestKey = bookGenerationRequestKey(JSON.stringify(input));
    const operation = beginBookOperation(null);

    setBookLoading(true);
    setBookError(null);
    setBookSaveError(null);
    try {
      const created = await createLegacyBook(input, requestKey);
      if (!isCurrentBookOperation(operation)) return;
      const sourceLabels = Object.fromEntries(created.draft.sourceMemoryIds.map((id) => [
        id,
        created.draft.sourceLabels?.[id]
          ?? confirmedBookSources.find((source) => source.id === id)?.title
          ?? "已授权记忆",
      ]));
      const createdDetail: ActiveLegacyBook = {
        id: created.id,
        title: created.title,
        intro: created.draft.intro ?? "",
        body: created.body,
        sections: created.sections,
        media: [],
        status: created.status,
        version: 0,
        visibility: input.visibility,
        sourceLabels,
        sourceLabelList: Object.values(sourceLabels),
      };
      setActiveBook(createdDetail);
      setBookTitleDraft(created.title);
      setBookBodyDraft(created.body);
      setGrowingBooks((current) => {
        const next = { id: created.id, title: created.title, status: "ready" as const, memoryCount: created.draft.sourceMemoryIds.length };
        return [next, ...current.filter((book) => book.id !== created.id)];
      });
      await openSavedBook(created.id, Object.values(sourceLabels));
    } catch (error) {
      const idempotencyExpired = isExpiredIdempotencyError(error);
      if (idempotencyExpired) {
        clearMatchingExpiredRequestKey(bookGenerationRequestRef.current?.key, requestKey, () => {
          bookGenerationRequestRef.current = null;
        });
      }
      if (!isCurrentBookOperation(operation)) return;
      if (idempotencyExpired) {
        setBookError(expiredIdempotencyRetryMessage);
        return;
      }
      setBookError(errorMessage(error));
    } finally {
      if (isCurrentBookOperation(operation)) setBookLoading(false);
    }
  }

  async function saveActiveBook() {
    if (!activeBook || activeBook.version < 1) {
      setBookSaveError("家书详情尚未加载完成，请刷新后重试。");
      return;
    }
    const operation = currentBookOperation(activeBook.id);
    if (!operation) return;

    setBookLoading(true);
    setBookSaveError(null);
    try {
      const updated = await updateLegacyBook(activeBook.id, {
        version: activeBook.version,
        title: bookTitleDraft,
        body: bookBodyDraft,
      });
      if (!isCurrentBookOperation(operation)) return;
      setActiveBook((current) => current && current.id === updated.id
        ? { ...current, ...updated }
        : current);
      setGrowingBooks((current) => current.map((book) => (
        book.id === updated.id ? { ...book, title: updated.title } : book
      )));
      setBookTitleDraft(updated.title);
      setBookBodyDraft(updated.body);
      setToast("家书修改已保存");
    } catch (error) {
      if (!isCurrentBookOperation(operation)) return;
      const message = errorMessage(error);
      const versionConflict = error instanceof LegacyBookApiError && error.status === 409;
      setBookSaveError(versionConflict || /版本|conflict/i.test(message) ? `${message}，刷新后重试` : message);
    } finally {
      if (isCurrentBookOperation(operation)) setBookLoading(false);
    }
  }

  async function createActiveBookShare() {
    if (!activeBook) {
      setShareError("请先打开一封真实已保存家书，再创建分享链接。");
      return;
    }
    const operation = currentBookOperation(activeBook.id);
    if (!operation) return;

    const requestKey = bookShareRequestKey(JSON.stringify({ bookId: activeBook.id, ...shareOptions }));
    setShareLoading(true);
    setShareError(null);
    try {
      const share = await createLegacyBookShare(activeBook.id, shareOptions, requestKey);
      if (!isCurrentBookOperation(operation)) return;
      setBookShares((current) => [share, ...current.filter((item) => item.token !== share.token)]);
      bookShareRequestRef.current = null;
    } catch (error) {
      const idempotencyExpired = isExpiredIdempotencyError(error);
      if (idempotencyExpired) {
        clearMatchingExpiredRequestKey(bookShareRequestRef.current?.key, requestKey, () => {
          bookShareRequestRef.current = null;
        });
      }
      if (!isCurrentBookOperation(operation)) return;
      if (idempotencyExpired) {
        setShareError(expiredIdempotencyRetryMessage);
        return;
      }
      setShareError(errorMessage(error));
    } finally {
      if (isCurrentBookOperation(operation)) setShareLoading(false);
    }
  }

  async function revokeActiveBookShare(token: string) {
    if (!activeBook) return;
    const operation = currentBookOperation(activeBook.id);
    if (!operation) return;
    const requestSignature = `${activeBook.id}:${token}`;
    const requestKey = bookShareRevokeRequestKey(activeBook.id, token);

    setShareLoading(true);
    setShareError(null);
    try {
      await revokeLegacyBookShare(activeBook.id, token, requestKey);
      if (!isCurrentBookOperation(operation)) return;
      setBookShares((current) => current.filter((share) => share.token !== token));
      bookShareRevokeRequestRef.current.delete(requestSignature);
    } catch (error) {
      const idempotencyExpired = isExpiredIdempotencyError(error);
      if (idempotencyExpired) {
        clearMatchingExpiredRequestKey(bookShareRevokeRequestRef.current.get(requestSignature), requestKey, () => {
          bookShareRevokeRequestRef.current.delete(requestSignature);
        });
      }
      if (!isCurrentBookOperation(operation)) return;
      if (idempotencyExpired) {
        setShareError(expiredIdempotencyRetryMessage);
        return;
      }
      setShareError(errorMessage(error));
    } finally {
      if (isCurrentBookOperation(operation)) setShareLoading(false);
    }
  }

  useEffect(() => () => {
    abortMemoryFlowOperation();
    abortResonanceScanOperation();
  }, []);

  useEffect(() => {
    if (activePanel === "quickRecord") return;
    abortMemoryFlowOperation();
  }, [activePanel]);

  useEffect(() => {
    const operation = resonanceScanOperationRef.current;
    if (!operation) return;

    operation.controller.abort();
    resonanceScanOperationRef.current = null;
    setResonanceLoading(false);
  }, [activePanel, activeZone]);

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

    switchGalaxyZone("galaxy");
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
    cancelResonanceScanOperation();
    setSelectedPlanetId(null);
    setClosingPlanetId(null);
    setRoamingPlanetId(planetId);
    setActivePanel(null);
  }

  function runRouteStep(index: number) {
    cancelMemoryFlowOperation();
    cancelResonanceScanOperation();
    const step = routeSteps[index];
    if (!step) return;
    setActiveRouteStep(index);
    setSelectedPlanetId(null);
    setClosingPlanetId(null);

    if (step.action === "planet") {
      focusAnchorPlanet(step.targetId ?? null);
      openAnchorPlanet(step.targetId ?? null);
      return;
    }

    if (step.action === "create") {
      setStarMapEditorOpen(true);
      return;
    }

    if (step.action === "memory" && step.targetId) {
      openConfirmedMemory(step.targetId);
      return;
    }

    if (step.action === "quickRecord") {
      openPanel("quickRecord", step.targetId);
      return;
    }

    if (step.action === "book") {
      switchGalaxyZone("books");
      return;
    }

    if (step.action === "resonance") switchGalaxyZone("resonance", { panel: "resonance" });
  }

  function openPanel(key: PanelKey, targetPlanetId?: string) {
    cancelMemoryFlowOperation();
    cancelResonanceScanOperation();
    if (key === "memory1") {
      setSelectedMemoryId(null);
    }
    if (key === "quickRecord") {
      const target =
        galaxyPlanets.find((planet) => planet.id === targetPlanetId) ??
        galaxyPlanets.find((planet) => planet.id === selectedPlanetId || planet.id === roamingPlanetId) ??
        galaxyPlanets.find((planet) => planet.type === "self") ??
        galaxyPlanets[0] ??
        null;

      if (!target) {
        setToast("请先选择一颗已保存的星球，再记录这段记忆");
        return;
      }

      const draftSignature = buildMemoryDraftSignature(
        target.id,
        quickRecordSource,
        quickRecordContent.trim(),
        quickRecordFile,
      );
      const existingDraft = memoryDraftContextRef.current;
      const shouldRetainDraft = Boolean(
        memoryDraftId &&
        existingDraft?.draftId === memoryDraftId &&
        existingDraft.signature === draftSignature,
      ) || memoryDraftRequestRef.current?.signature === draftSignature;

      setQuickRecordTargetPlanetId(target.id);
      if (!shouldRetainDraft) {
        clearMemoryDraftState();
      }
    }
    setActivePanel(key);
    setRoamingPlanetId(null);
    setSelectedPlanetId(null);
    setClosingPlanetId(null);
  }

  function openConfirmedMemory(memoryId: string) {
    cancelMemoryFlowOperation();
    cancelResonanceScanOperation();
    setSelectedMemoryId(memoryId);
    setActivePanel("memory1");
    setRoamingPlanetId(null);
    setSelectedPlanetId(null);
    setClosingPlanetId(null);
  }

  function closeActivePanel() {
    cancelMemoryFlowOperation();
    cancelResonanceScanOperation();
    setActivePanel(null);
  }

  function switchGalaxyZone(
    zone: GalaxyZoneKey,
    options: { panel?: PanelKey | null; preserveSelectedPlanet?: boolean } = {},
  ) {
    if (zone === "books" && !hasConfirmedResonance && !canOpenSavedBooks) {
      setToast(bookWorkshopLockMessage);
      return false;
    }

    cancelMemoryFlowOperation();
    cancelResonanceScanOperation();
    if (zone !== "galaxy") {
      setAutoCruise(false);
      setImmersiveMode(false);
      setStarMapEditorOpen(false);
    }
    setActiveZone(zone);
    setActivePanel(options.panel ?? null);
    setRoamingPlanetId(null);
    if (!options.preserveSelectedPlanet) {
      setSelectedPlanetId(null);
      setClosingPlanetId(null);
    }
    return true;
  }

  function goToZone(zone: GalaxyZoneKey) {
    switchGalaxyZone(zone);
  }

  function selectThemeFromNebula(theme: string) {
    setSelectedTheme(theme);
    setToast(canOpenSavedBooks
      ? `已选择「${theme}」，可在家书工坊开始写作`
      : bookWorkshopLockMessage);
  }

  async function lightMemoryStar() {
    const content = quickRecordContent.trim();
    if (quickRecordSource === "text" && content.length === 0) {
      setToast("先写下一句话，再点亮记忆星");
      return;
    }

    if (quickRecordSource !== "text" && !quickRecordFile) {
      setMemoryFlowError("先选择一份真实来源，再发送给 AI 整理");
      return;
    }

    if (!quickRecordTarget) {
      setMemoryFlowError("请先选择一颗已保存的星球，再记录这段记忆");
      return;
    }

    const draftSignature = buildMemoryDraftSignature(
      quickRecordTarget.id,
      quickRecordSource,
      content,
      quickRecordFile,
    );
    const existingDraft = memoryDraftContextRef.current;
    if (
      memoryDraftId &&
      existingDraft?.draftId === memoryDraftId &&
      existingDraft.signature === draftSignature
    ) {
      await retryMemoryExtraction();
      return;
    }

    if (memoryDraftId || existingDraft) {
      clearMemoryDraftState();
    }

    const operation = beginMemoryFlowOperation();
    const idempotencyKey = memoryDraftRequestKey(draftSignature);
    setMemoryFlowLoading(true);
    setMemoryFlowError(null);
    try {
      let assetIds: string[] | undefined;
      if (quickRecordSource !== "text") {
        const cachedAsset = uploadedQuickRecordAsset?.signature === draftSignature
          ? uploadedQuickRecordAsset.asset
          : null;
        const asset = cachedAsset ?? await uploadLegacyAsset({
          file: quickRecordFile as File,
          planetId: quickRecordTarget.id,
          kind: quickRecordSource,
          visibility: "private",
          idempotencyKey: assetUploadRequestKey(draftSignature),
          signal: operation.controller.signal,
        });

        if (!isCurrentMemoryFlowOperation(operation)) return;
        if (!cachedAsset) setUploadedQuickRecordAsset({ asset, signature: draftSignature });
        assetIds = [asset.id];
      }

      const draft = await createLegacyMemoryDraft({
        planetId: quickRecordTarget.id,
        sourceText: quickRecordSource === "text" ? content : "",
        ...(assetIds ? { assetIds } : {}),
        visibility: "family",
        allowResonance: true,
        allowBook: true,
      }, idempotencyKey);
      if (!isCurrentMemoryFlowOperation(operation)) return;
      setMemoryDraftId(draft.id);
      setMemoryJob(null);
      memoryDraftContextRef.current = { draftId: draft.id, signature: draftSignature };
      memoryDraftRequestRef.current = null;
      await startMemoryExtraction(draft.id, operation);
    } catch (error) {
      if (!isCurrentMemoryFlowOperation(operation)) return;
      setMemoryFlowError(errorMessage(error));
    } finally {
      if (isCurrentMemoryFlowOperation(operation)) setMemoryFlowLoading(false);
    }
  }

  async function loadMemoryReview(draftId: string, operation: MemoryFlowOperation) {
    const review = await getLegacyMemoryReview(draftId);
    if (!isCurrentMemoryFlowOperation(operation)) return false;
    if (review.status !== "needs_confirmation") {
      throw new Error("记忆尚未准备好确认，请稍后重试。");
    }
    setMemoryReview(review);
    setReviewTitle(review.title ?? "");
    setReviewSummary(review.summary ?? "");
    return true;
  }

  async function startMemoryExtraction(
    draftId: string,
    operation: MemoryFlowOperation,
    freshAttempt = false,
  ) {
    const job = await startLegacyMemoryExtraction(draftId, memoryJobRequestKey(draftId, freshAttempt));
    if (!isCurrentMemoryFlowOperation(operation)) return false;
    setMemoryJob(job);
    const completed = await waitForMemoryExtraction(job, (nextJob) => {
      if (isCurrentMemoryFlowOperation(operation)) setMemoryJob(nextJob);
    }, {
      signal: operation.controller.signal,
      isCurrent: () => isCurrentMemoryFlowOperation(operation),
    });
    if (!completed || !isCurrentMemoryFlowOperation(operation)) return false;
    return loadMemoryReview(draftId, operation);
  }

  async function retryMemoryExtraction() {
    if (!memoryDraftId) {
      await lightMemoryStar();
      return;
    }

    const operation = beginMemoryFlowOperation();
    setMemoryFlowLoading(true);
    setMemoryFlowError(null);
    try {
      if (!memoryJob) {
        await startMemoryExtraction(memoryDraftId, operation);
        return;
      }

      if (memoryJob.status === "failed") {
        await startMemoryExtraction(memoryDraftId, operation, true);
      } else if (memoryJob.status === "completed" || memoryJob.status === "succeeded") {
        await loadMemoryReview(memoryDraftId, operation);
      } else if (memoryJob.status === "queued" || memoryJob.status === "processing") {
        const completed = await waitForMemoryExtraction(memoryJob, (nextJob) => {
          if (isCurrentMemoryFlowOperation(operation)) setMemoryJob(nextJob);
        }, {
          signal: operation.controller.signal,
          isCurrent: () => isCurrentMemoryFlowOperation(operation),
        });
        if (completed && isCurrentMemoryFlowOperation(operation)) {
          await loadMemoryReview(memoryDraftId, operation);
        }
      } else {
        setMemoryFlowError("AI 作业状态未知，请刷新或重新打开这条草稿后再试");
      }
    } catch (error) {
      if (!isCurrentMemoryFlowOperation(operation)) return;
      setMemoryFlowError(errorMessage(error));
    } finally {
      if (isCurrentMemoryFlowOperation(operation)) setMemoryFlowLoading(false);
    }
  }

  async function confirmMemoryStar() {
    if (!memoryReview) return;

    setMemoryFlowLoading(true);
    setMemoryFlowError(null);
    try {
      const confirmed = await confirmLegacyMemory({
        memoryId: memoryReview.id,
        version: memoryReview.version,
        title: reviewTitle,
        summary: reviewSummary,
        tags: memoryReview.tags ?? [],
        ...(memoryReview.occurredAtLabel?.trim()
          ? { occurredAtLabel: memoryReview.occurredAtLabel.trim() }
          : {}),
        ...(memoryReview.locationLabel?.trim()
          ? { locationLabel: memoryReview.locationLabel.trim() }
          : {}),
        people: memoryReview.people ?? [],
      });
      const memory: MemoryStar = {
        id: confirmed.id,
        planetId: confirmed.planetId,
        title: confirmed.title ?? reviewTitle,
        occurredAt: confirmed.occurredAtLabel ?? "",
        location: confirmed.locationLabel ?? "",
        people: confirmed.people ?? [],
        emotions: [],
        visibility: confirmed.visibility,
        summary: confirmed.summary ?? reviewSummary,
      };
      setLitMemories((current) => [...current.filter((item) => item.id !== memory.id), memory]);
      setGalaxyPlanets((current) => current.map((planet) => (
        planet.id === memory.planetId
          ? { ...planet, stats: { ...planet.stats, memoryStars: planet.stats.memoryStars + 1 } }
          : planet
      )));
      setMemoryReview(null);
      setSelectedMemoryId(memory.id);
      switchGalaxyZone("memories", { panel: "memory1" });
      setToast("已确认点亮为记忆星，默认不公开");
    } catch (error) {
      setMemoryFlowError(errorMessage(error));
    } finally {
      setMemoryFlowLoading(false);
    }
  }

  async function scanResonanceStar() {
    const sourceMemory = selectedMemory;
    if (!sourceMemory) {
      setResonanceError("请先打开一颗已确认的记忆星，再扫描共鸣。");
      return false;
    }

    const operation = beginResonanceScanOperation();
    setResonanceLoading(true);
    setResonanceError(null);
    setResonanceDecisionMessage(null);
    try {
      const result = await scanLegacyResonances(sourceMemory.id, operation.controller.signal);
      if (!isCurrentResonanceScanOperation(operation)) return false;
      const candidates = result.candidates.filter((candidate) => candidate.status === "candidate");
      if (candidates.length === 0) {
        setResonanceError("暂未找到可确认的共鸣星轨。");
        return false;
      }

      setPendingResonances((current) => {
        const merged = new Map(current.map((candidate) => [candidate.id, candidate]));
        candidates.forEach((candidate) => merged.set(candidate.id, {
          id: candidate.id,
          sourceMemoryId: candidate.sourceMemoryId,
          targetMemoryId: candidate.targetMemoryId,
          score: candidate.score,
          reason: candidate.reason,
          version: candidate.version,
        }));
        return [...merged.values()];
      });
      setSelectedResonanceId(candidates[0].id);
      return true;
    } catch (error) {
      if (!isCurrentResonanceScanOperation(operation) || error instanceof Error && error.name === "AbortError") {
        return false;
      }
      setResonanceError(errorMessage(error));
      return false;
    } finally {
      if (isCurrentResonanceScanOperation(operation)) {
        resonanceScanOperationRef.current = null;
        setResonanceLoading(false);
      }
    }
  }

  async function decideResonanceCandidate(status: "confirmed" | "rejected") {
    const candidate = activeResonance;
    if (!candidate) {
      setResonanceError("当前没有可处理的共鸣候选。");
      return false;
    }

    setResonanceLoading(true);
    setResonanceError(null);
    setResonanceDecisionMessage(null);
    try {
      const decided = await confirmLegacyResonance({
        id: candidate.id,
        status,
        version: candidate.version,
      });
      if (decided.status !== status) {
        throw new Error("共鸣候选状态未更新，请刷新后重试。");
      }

      setPendingResonances((current) => current.filter((item) => item.id !== candidate.id));
      setSelectedResonanceId((current) => (
        current === candidate.id ? null : current
      ));

      if (status === "rejected") {
        setResonanceDecisionMessage("已拒绝这条共鸣候选。");
        setToast("已拒绝这条共鸣候选");
        return true;
      }

      const sourceMemory = litMemories.find((memory) => memory.id === candidate.sourceMemoryId) ?? null;
      const targetMemory = litMemories.find((memory) => memory.id === candidate.targetMemoryId) ?? null;
      const sourcePlanetId = sourceMemory?.planetId;
      const targetPlanetId = targetMemory?.planetId;
      const linkAlreadyVisible = galaxyLinks.some((link) => link.id === decided.id);

      if (sourcePlanetId && targetPlanetId && !linkAlreadyVisible) {
        setGalaxyLinks((current) => (
          current.some((link) => link.id === decided.id)
            ? current
            : [
              ...current,
              {
                id: decided.id,
                sourcePlanetId,
                targetPlanetId,
                kind: "resonance",
                status: "confirmed",
                label: candidate.reason,
                visibility: "family",
                strength: candidate.score,
                rule: "sharedMemory",
              },
            ]
        ));
        const linkedPlanetIds = new Set([sourcePlanetId, targetPlanetId]);
        setGalaxyPlanets((current) => current.map((planet) => (
          linkedPlanetIds.has(planet.id)
            ? {
              ...planet,
              stats: { ...planet.stats, resonanceTracks: planet.stats.resonanceTracks + 1 },
            }
            : planet
        )));
      }

      setResonanceDecisionMessage("已确认这条星轨，可进入家书工坊。");
      setConfirmedResonanceSourceMemoryIds([candidate.sourceMemoryId, candidate.targetMemoryId]);
      setToast("共鸣星轨已确认");
      return true;
    } catch (error) {
      setResonanceError(errorMessage(error));
      return false;
    } finally {
      setResonanceLoading(false);
    }
  }

  function selectPlanet(planetId: string) {
    if (hiddenPlanetIds.includes(planetId)) return;
    cancelMemoryFlowOperation();
    cancelResonanceScanOperation();

    if (selectedPlanetId === planetId) {
      setClosingPlanetId(planetId);
      setSelectedPlanetId(null);
      setActivePanel(null);
      setRoamingPlanetId(null);
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
  }

  function openSelectedPlanet(planetId: string | null) {
    if (!planetId) return;
    cancelMemoryFlowOperation();
    cancelResonanceScanOperation();

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

  async function saveSelectedPlanetCover() {
    if (!selectedPlanet) {
      setToast("请先选择一颗家人星球，再保存封面");
      return;
    }

    if (!selectedPlanetCoverFile) {
      setToast("请先选择一张图片作为星球封面");
      return;
    }

    setPlanetCoverSaving(true);
    try {
      const asset = await uploadLegacyAsset({
        file: selectedPlanetCoverFile,
        planetId: selectedPlanet.id,
        kind: "planet_cover",
        visibility: "private",
        idempotencyKey: assetUploadRequestKey(JSON.stringify({
          planetId: selectedPlanet.id,
          kind: "planet_cover",
          name: selectedPlanetCoverFile.name,
          size: selectedPlanetCoverFile.size,
          lastModified: selectedPlanetCoverFile.lastModified,
          type: selectedPlanetCoverFile.type,
        })),
      });

      if (await persistPlanetChange(selectedPlanet, { coverAssetId: asset.id })) {
        setSelectedPlanetCoverFile(null);
        setSelectedPlanetCoverPreviewUrl(null);
        setToast("星球封面已保存");
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : "上传星球封面失败，请稍后重试");
    } finally {
      setPlanetCoverSaving(false);
    }
  }

  function editPlanetTheme(planetId: string) {
    const planet = galaxyPlanets.find((item) => item.id === planetId);
    if (!planet) return;

    setSelectedPlanetId(planetId);
    setClosingPlanetId(null);
    switchGalaxyZone("workshop", { preserveSelectedPlanet: true });
    setSelectedWorkshopBg(planet.theme);
    setSelectedPlanetCoverFile(null);
    setSelectedPlanetCoverPreviewUrl(null);
    setToast("星球主题实验室已就近展开");
  }

  function selectPlanetCover(file: File | null) {
    if (!file) {
      setSelectedPlanetCoverFile(null);
      setSelectedPlanetCoverPreviewUrl(null);
      return;
    }

    if (!file.type.startsWith("image/")) {
      setToast("请选择 JPG、PNG、WebP 或 AVIF 格式的图片");
      return;
    }

    setSelectedPlanetCoverFile(file);
    setSelectedPlanetCoverPreviewUrl(
      typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null,
    );
  }

  function configurePlanetPrivacy(planet: Planet) {
    setSelectedPlanetId(planet.id);
    switchGalaxyZone("privacy", {
      panel: planet.type === "self" ? "scopePrivate" : planet.type === "public" ? "scopePublic" : "scopeFamily",
      preserveSelectedPlanet: true,
    });
  }

  function openPlanetLifecycle(planetId: string) {
    cancelMemoryFlowOperation();
    cancelResonanceScanOperation();
    setSelectedPlanetId(planetId);
    setClosingPlanetId(null);
    setActivePanel("lifecycle");
    setRoamingPlanetId(null);
  }

  function openBookWorkshopFromPlanet(planet: Planet) {
    if (!switchGalaxyZone("books")) return;
    setToast(`已从「${planet.name}」进入家书工坊`);
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
    cancelMemoryFlowOperation();
    cancelResonanceScanOperation();
    setActivePanel(null);
    setRoamingPlanetId(null);
    setToast("自动巡航已启动，星球开始沿轨道漫游");
  }

  function exitImmersiveMode() {
    setAutoCruise(false);
    setImmersiveMode(false);
    setRoamingPlanetId(null);
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
          onChange={(event) => switchGalaxyZone(event.target.value as GalaxyZoneKey)}
        >
          {galaxyNavigation.map((zone) => (
            <option key={zone.key} value={zone.key}>
              {zone.label}
            </option>
          ))}
        </select>

        <p className="nav-label">星系图层</p>
        <nav aria-label="星系图层">
          {galaxyNavigation.map((zone) => (
            <button
              aria-label={zone.label}
              className={`nav-btn ${activeZone === zone.key ? "active" : ""}`}
              key={zone.key}
              onClick={() => {
                switchGalaxyZone(zone.key, { panel: zone.key === "privacy" ? "privacy" : null });
              }}
              type="button"
            >
              {zone.label}
            </button>
          ))}
        </nav>

        {isGalaxyScene ? (
          <>
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
          </>
        ) : null}
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
          {isGalaxyScene ? <div className="top-actions galaxy-hud">
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
          </div> : null}

          {isGalaxyScene ? (
            <div className="assistant-note">
              <Sparkles size={15} />
              <span>
                星图助手建议：{routeSteps[0]?.detail ?? "从一颗真实的家人星球开始，逐步点亮记忆、确认共鸣，再写成家书。"}
              </span>
            </div>
          ) : null}

          {isGalaxyScene ? (
            <RouteCard
              activeStep={activeRouteStep}
              collapsed={routeCollapsed}
              onRunStep={runRouteStep}
              onToggle={() => setRouteCollapsed((current) => !current)}
              steps={routeSteps}
            />
          ) : null}

          <div className="galaxy-canvas" style={galaxyStyle}>
            <ZoneScene
              activeZone={activeZone}
              resonanceCandidate={activeResonance}
              resonanceSourceMemory={resonanceSourceMemory}
              resonanceTargetMemory={resonanceTargetMemory}
              resonanceSourcePlanet={resonanceSourcePlanet}
              resonanceTargetPlanet={resonanceTargetPlanet}
              litMemories={litMemories}
              onGo={goToZone}
              onOpenConfirmedMemory={openConfirmedMemory}
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
              onOpenBookWorkshopFromPlanet={openBookWorkshopFromPlanet}
              onHidePlanet={hidePlanet}
              onOpenStarMapEditor={() => setStarMapEditorOpen(true)}
              onOpenPlanetLifecycle={openPlanetLifecycle}
              onRenamePlanet={renamePlanet}
              onSaveSelectedPlanetTheme={(theme) => {
                if (selectedPlanet) void persistPlanetChange(selectedPlanet, { theme });
              }}
              planetCoverSaving={planetCoverSaving}
              selectedPlanetCoverFile={selectedPlanetCoverFile}
              selectedPlanetCoverPreviewUrl={selectedPlanetCoverPreviewUrl}
              onSaveSelectedPlanetCover={() => void saveSelectedPlanetCover()}
              onSelectPlanetCover={selectPlanetCover}
              activeBook={activeBook}
              bookBodyDraft={bookBodyDraft}
              bookError={bookError}
              bookLoading={bookLoading}
              bookSaveError={bookSaveError}
              bookShares={bookShares}
              bookTitleDraft={bookTitleDraft}
              canCreateBook={
                hasConfirmedResonance
                && confirmedBookSources.length > 0
                && confirmedBookSources.length === confirmedResonanceSourceMemoryIds?.length
              }
              canOpenSavedBooks={canOpenSavedBooks}
              confirmedBookSources={confirmedBookSources}
              growingBooks={growingBooks}
              onCreateBook={generateLegacyBook}
              onCreateShare={createActiveBookShare}
              onOpenSavedBook={openSavedBook}
              bookEditorOpen={bookEditorOpen}
              onCloseBookEditor={() => setBookEditorOpen(false)}
              onOpenBookEditor={() => setBookEditorOpen(true)}
              onReturnToBookShelf={returnToBookShelf}
              onRevokeShare={revokeActiveBookShare}
              onSaveBook={saveActiveBook}
              setBookBodyDraft={setBookBodyDraft}
              setBookTitleDraft={setBookTitleDraft}
              setShareOptions={setShareOptions}
              shareError={shareError}
              shareLoading={shareLoading}
              shareOptions={shareOptions}
              setSelectedWorkshopBg={setSelectedWorkshopBg}
              setSelectedWorkshopMaterial={setSelectedWorkshopMaterial}
              setSelectedWorkshopZone={setSelectedWorkshopZone}
            />
          </div>

          {isGalaxyScene ? (
            <>
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
            </>
          ) : null}
          {isGalaxyScene ? (
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
                  onToggleLinkKind={toggleLinkKind}
                  planets={galaxyPlanets}
                  selectedPlanet={selectedPlanet}
                  visibleLinkKinds={visibleLinkKinds}
                />
              ) : null}
            </AnimatePresence>
          ) : null}
        </section>
      </section>

      <AnimatePresence>
        <SidePanel
          activePanel={activePanel}
          litMemories={litMemories}
          quickRecordContent={quickRecordContent}
          quickRecordFile={quickRecordFile}
          quickRecordSource={quickRecordSource}
          loading={memoryFlowLoading}
          memoryFlowError={memoryFlowError}
          memoryPrimaryActionLabel={memoryPrimaryActionLabel}
          memoryReview={memoryReview}
          quickRecordTarget={quickRecordTarget}
          reviewSummary={reviewSummary}
          reviewTitle={reviewTitle}
          selectedMemory={selectedMemory}
          selectedMemoryId={selectedMemoryId}
          resonanceCandidate={activeResonance}
          resonanceSourceMemory={resonanceSourceMemory}
          resonanceTargetMemory={resonanceTargetMemory}
          resonanceError={resonanceError}
          resonanceDecisionMessage={resonanceDecisionMessage}
          resonanceLoading={resonanceLoading}
          onClose={closeActivePanel}
          onGo={goToZone}
          onLightMemory={lightMemoryStar}
          onConfirmMemory={() => {
            void confirmMemoryStar();
          }}
          onQuickRecordChange={setQuickRecordContent}
          onQuickRecordFileChange={changeQuickRecordFile}
          onQuickRecordSourceChange={changeQuickRecordSource}
          onReviewSummaryChange={setReviewSummary}
          onReviewTitleChange={setReviewTitle}
          onRetryMemoryExtraction={() => {
            void retryMemoryExtraction();
          }}
          onScanResonance={scanResonanceStar}
          onDecideResonance={decideResonanceCandidate}
          onPersistPlanetChange={persistPlanetChange}
          onOpenPanel={openPanel}
          onSelectTheme={selectThemeFromNebula}
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
          memories={litMemories}
          planet={roamingPlanet}
          onBook={() => {
            if (!switchGalaxyZone("books")) return;
            setToast("已从星球漫游带入家书工坊");
          }}
          onClose={() => setRoamingPlanetId(null)}
          onConfigurePrivacy={() => configurePlanetPrivacy(roamingPlanet)}
          onQuickRecord={() => {
            setRoamingPlanetId(null);
            openPanel("quickRecord");
          }}
        />
      ) : null}
      <AnimatePresence>
        {toast ? (
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            aria-live="polite"
            className="toast show"
            exit={{ opacity: 0, y: -8 }}
            initial={{ opacity: 0, y: -8 }}
            onAnimationComplete={() => window.setTimeout(() => setToast(null), 1400)}
            role="status"
          >
            {toast}
          </motion.div>
        ) : null}
      </AnimatePresence>
      {isGalaxyScene && (immersiveMode || autoCruise) ? (
        <motion.button
          animate={{ opacity: 1, y: 0 }}
          className="immersive-pill"
          initial={{ opacity: 0, y: 12 }}
          onClick={exitImmersiveMode}
          transition={{ duration: 0.24 }}
          type="button"
        >
          退出沉浸
        </motion.button>
      ) : null}
    </main>
  );
}

function ZoneScene({
  activeZone,
  activeBook,
  bookEditorOpen,
  bookBodyDraft,
  bookError,
  bookLoading,
  bookSaveError,
  bookShares,
  bookTitleDraft,
  canCreateBook,
  canOpenSavedBooks,
  confirmedBookSources,
  growingBooks,
  resonanceCandidate,
  resonanceSourceMemory,
  resonanceTargetMemory,
  resonanceSourcePlanet,
  resonanceTargetPlanet,
  litMemories,
  closingPlanetId,
  onGo,
  onCreateBook,
  onCreateShare,
  onOpenConfirmedMemory,
  onOpenPanel,
  onOpenPlanet,
  onOpenSavedBook,
  onCloseBookEditor,
  onOpenBookEditor,
  onReturnToBookShelf,
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
  setShareOptions,
  shareError,
  shareLoading,
  shareOptions,
  onConfigurePlanetPrivacy,
  onEditPlanetTheme,
  onOpenBookWorkshopFromPlanet,
  onHidePlanet,
  onOpenStarMapEditor,
  onOpenPlanetLifecycle,
  onRenamePlanet,
  onRevokeShare,
  onSaveBook,
  onSaveSelectedPlanetTheme,
  onSaveSelectedPlanetCover,
  onSelectPlanetCover,
  planetCoverSaving,
  selectedPlanetCoverFile,
  selectedPlanetCoverPreviewUrl,
  setBookBodyDraft,
  setBookTitleDraft,
}: {
  activeZone: GalaxyZoneKey;
  activeBook: ActiveLegacyBook | null;
  bookEditorOpen: boolean;
  bookBodyDraft: string;
  bookError: string | null;
  bookLoading: boolean;
  bookSaveError: string | null;
  bookShares: LegacyBookShare[];
  bookTitleDraft: string;
  canCreateBook: boolean;
  canOpenSavedBooks: boolean;
  confirmedBookSources: Array<{ id: string; title: string }>;
  growingBooks: GrowingBookSummary[];
  resonanceCandidate: LegacyPendingResonance | null;
  resonanceSourceMemory: MemoryStar | null;
  resonanceTargetMemory: MemoryStar | null;
  resonanceSourcePlanet: Planet | null;
  resonanceTargetPlanet: Planet | null;
  litMemories: MemoryStar[];
  closingPlanetId: string | null;
  onGo: (zone: GalaxyZoneKey) => void;
  onCreateBook: () => void;
  onCreateShare: () => void;
  onOpenConfirmedMemory: (memoryId: string) => void;
  onOpenPanel: (key: PanelKey) => void;
  onOpenPlanet: (planetId: string | null) => void;
  onOpenSavedBook: (bookId: string) => void;
  onCloseBookEditor: () => void;
  onOpenBookEditor: () => void;
  onReturnToBookShelf: () => void;
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
  setBookBodyDraft: (value: string) => void;
  setBookTitleDraft: (value: string) => void;
  setSelectedWorkshopBg: (value: string) => void;
  setSelectedWorkshopMaterial: (value: string) => void;
  setSelectedWorkshopZone: (value: GalaxyZoneKey) => void;
  setShareOptions: (value: LegacyBookShareOptions) => void;
  shareError: string | null;
  shareLoading: boolean;
  shareOptions: LegacyBookShareOptions;
  onConfigurePlanetPrivacy: (planet: Planet) => void;
  onEditPlanetTheme: (planetId: string) => void;
  onOpenBookWorkshopFromPlanet: (planet: Planet) => void;
  onHidePlanet: (planetId: string) => void;
  onOpenStarMapEditor: () => void;
  onOpenPlanetLifecycle: (planetId: string) => void;
  onRenamePlanet: (planet: Planet) => void;
  onRevokeShare: (token: string) => void;
  onSaveBook: () => void;
  onSaveSelectedPlanetTheme: (theme: string) => void;
  onSaveSelectedPlanetCover: () => void;
  onSelectPlanetCover: (file: File | null) => void;
  planetCoverSaving: boolean;
  selectedPlanetCoverFile: File | null;
  selectedPlanetCoverPreviewUrl: string | null;
}) {
  if (activeZone === "privacy") {
    return (
      <>
        <ScopeRings />
        {planets.length > 0 ? planets.map((planet) => {
          const presentationType = getPlanetPresentationType(planet);
          return (
            <ScenePlanetButton
              badge={planetBadgeByType[presentationType]}
              className={planetClassByType[presentationType]}
              coverAssetId={planet.coverAssetId}
              key={planet.id}
              label={planet.name}
              left={`${planet.position.x}%`}
              onClick={() => onConfigurePlanetPrivacy(planet)}
              theme={planet.theme}
              top={`${planet.position.y}%`}
            />
          );
        }) : (
          <section className="scene-empty-state" role="status">
            先创建一颗家人星球，再为它设置可见范围。
          </section>
        )}
      </>
    );
  }

  if (activeZone === "memorial") {
    const memorialPlanets = planets.filter((planet) => getPlanetPresentationType(planet) === "memorial");
    return (
      <>
        <PlanetLinkField links={planetLinks} planets={memorialPlanets} />
        {memorialPlanets.length > 0 ? memorialPlanets.map((planet, index) => {
          const position = memorialScenePosition(index, memorialPlanets.length);
          return (
            <ScenePlanetButton
              badge="念"
              className={planetClassByType[getPlanetPresentationType(planet)]}
              coverAssetId={planet.coverAssetId}
              key={planet.id}
              label={planet.name}
              left={position.left}
              onClick={() => onOpenPlanet(planet.id)}
              theme={planet.theme}
              top={position.top}
            />
          );
        }) : (
          <section className="scene-empty-state" role="status">
            当前还没有纪念星
          </section>
        )}
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
        <PlanetThemeStudio
          coverSaving={planetCoverSaving}
          onPreviewZone={() => onGo(selectedWorkshopZone)}
          onSaveCover={onSaveSelectedPlanetCover}
          onSaveTheme={() => onSaveSelectedPlanetTheme(selectedWorkshopBg)}
          onSelectCover={onSelectPlanetCover}
          onSelectMaterial={setSelectedWorkshopMaterial}
          onSelectTheme={setSelectedWorkshopBg}
          onSelectZone={setSelectedWorkshopZone}
          previewCoverUrl={selectedPlanetCoverPreviewUrl}
          selectedCoverFile={selectedPlanetCoverFile}
          selectedMaterial={selectedWorkshopMaterial}
          selectedPlanet={selectedPlanet}
          selectedTheme={selectedWorkshopBg}
          selectedZone={selectedWorkshopZone}
        />
      </div>
    );
  }

  if (activeZone === "memories") {
    return (
      <>
        <div className="orbit memory-orbit" />
        {litMemories.length > 0 ? litMemories.map((memory, index) => (
          <MemoryButton
            key={memory.id}
            label={memory.title}
            left={`${32 + (index % 5) * 14}%`}
            onClick={() => onOpenConfirmedMemory(memory.id)}
            top={`${28 + Math.floor(index / 5) * 28}%`}
            variant={index % 2 === 0 ? "coral" : "blue"}
          />
        )) : (
          <section className="scene-empty-state" role="status">
            当前还没有已确认的记忆星
          </section>
        )}
        {resonanceCandidate ? (
          <SparkButton label="查看待确认共鸣" left="76%" onClick={() => onGo("resonance")} top="34%" />
        ) : null}
        <SceneHint
          subtitle="点击光点查看故事；新的记忆会自然进入轨道"
          title="记忆不是表单，是一颗颗被点亮的星"
        />
      </>
    );
  }

  if (activeZone === "resonance") {
    if (!resonanceCandidate) {
      return (
        <>
          <div className="orbit memory-orbit" />
          <div className="scene-empty-state" role="status">
            暂无待确认的共鸣候选。请从一颗已确认的记忆星发起扫描。
          </div>
          <SceneHint
            subtitle="AI 只会返回真实记忆之间的候选连接，是否形成星轨由家人决定"
            title="共鸣不是猜测，是等待确认的共同记忆"
          />
        </>
      );
    }

    const candidateLabel = resonanceCandidateLabel(resonanceCandidate, litMemories);
    return (
      <>
        <svg className="links" viewBox="0 0 1000 700" preserveAspectRatio="none" aria-hidden="true">
          <path className="link-public" d="M285 350 C420 250 580 250 715 350" />
          <path className="link-private" d="M285 350 C420 450 580 450 715 350" />
        </svg>
        {resonanceSourcePlanet ? (
          <ScenePlanetButton
            badge={planetBadgeByType[getPlanetPresentationType(resonanceSourcePlanet)]}
            className={planetClassByType[getPlanetPresentationType(resonanceSourcePlanet)]}
            coverAssetId={resonanceSourcePlanet.coverAssetId}
            label={resonanceSourcePlanet.name}
            left="28.5%"
            onClick={() => onOpenPlanet(resonanceSourcePlanet.id)}
            theme={resonanceSourcePlanet.theme}
            top="50%"
          />
        ) : null}
        {resonanceTargetPlanet ? (
          <ScenePlanetButton
            badge={planetBadgeByType[getPlanetPresentationType(resonanceTargetPlanet)]}
            className={planetClassByType[getPlanetPresentationType(resonanceTargetPlanet)]}
            coverAssetId={resonanceTargetPlanet.coverAssetId}
            label={resonanceTargetPlanet.name}
            left="71.5%"
            onClick={() => onOpenPlanet(resonanceTargetPlanet.id)}
            theme={resonanceTargetPlanet.theme}
            top="50%"
          />
        ) : null}
        <SparkButton
          label={candidateLabel}
          left="50%"
          onClick={() => onOpenPanel("resonance")}
          top="45%"
        />
        {resonanceSourceMemory ? (
          <MemoryButton
            label={resonanceSourceMemory.title}
            left="39%"
            onClick={() => onOpenConfirmedMemory(resonanceSourceMemory.id)}
            top="38%"
            variant="coral"
          />
        ) : null}
        {resonanceTargetMemory ? (
          <MemoryButton
            label={resonanceTargetMemory.title}
            left="61%"
            onClick={() => onOpenConfirmedMemory(resonanceTargetMemory.id)}
            top="38%"
            variant="blue"
          />
        ) : null}
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
    return (
      <div className={`bookmaker-stage${activeBook ? " reading" : ""}`}>
        {!activeBook ? (
          <>
            <header className="book-market-heading">
              <p className="panel-kicker">家书工坊 · 家庭书架</p>
              <h2>把写好的家书，摆回家人的星系</h2>
              <p>先看封面，再翻开阅读。当前主题为「{selectedTheme}」，所有书籍都从已保存的真实记忆长出。</p>
            </header>
            <section aria-label="家书书架" className="book-market-shelf">
              {growingBooks.map((book, index) => (
                <button
                  aria-label={`打开已保存家书：${book.title ?? "未命名家书"}`}
                  className={`book-cover-card cover-tone-${index % 4}`}
                  key={book.id}
                  onClick={() => onOpenSavedBook(book.id)}
                  type="button"
                >
                  <span className="book-cover-orbit" aria-hidden="true" />
                  <span className="book-cover-kicker">家书星球 · 家庭私藏</span>
                  <strong>{book.title ?? "未命名家书"}</strong>
                  <small>{book.memoryCount} 段被确认的记忆</small>
                  <span className="book-cover-open">翻开阅读</span>
                </button>
              ))}
              {canCreateBook ? (
                <button aria-label="生成这本家书" className="book-cover-card book-cover-new" disabled={bookLoading} onClick={onCreateBook} type="button">
                  <span className="book-cover-plus" aria-hidden="true">+</span>
                  <strong>{bookLoading ? "正在装订家书…" : "生成一本家书"}</strong>
                  <small>{confirmedBookSources.length} 段已确认共鸣记忆</small>
                  <span className="book-cover-open">从当前主题开始</span>
                </button>
              ) : null}
            </section>
            {!canOpenSavedBooks && !canCreateBook ? <p className="book-market-empty">请先确认一条共鸣星轨，家书才会拥有真实的来源。</p> : null}
            {bookError ? <p role="alert">{bookError}</p> : null}
          </>
        ) : (
          <section aria-label="真实家书详情" className="book-reader-shell">
            <header className="book-reader-heading">
              <div>
                <p className="panel-kicker">已保存家书 · 阅读中</p>
                <h2>{activeBook.title || "未命名家书"}</h2>
              </div>
              <div className="book-reader-actions">
                <button className="secondary" onClick={onReturnToBookShelf} type="button">返回书架</button>
                <button className="primary" onClick={onOpenBookEditor} type="button">编辑此书</button>
              </div>
            </header>
            <FamilyBookReader
              body={bookBodyDraft || activeBook.body}
              intro={activeBook.intro || "这封家书从已确认的家庭记忆中长出，留给以后每一次温柔的回望。"}
              key={activeBook.id}
              media={activeBook.media}
              sections={activeBook.sections}
              sourceLabels={activeBook.sourceLabels}
              title={bookTitleDraft || activeBook.title}
            />
            <AnimatePresence>
              {bookEditorOpen ? (
                <motion.section
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  aria-label="家书编辑与分享"
                  aria-modal="true"
                  className="book-editor-drawer"
                  exit={{ opacity: 0, scale: 0.98, y: 14 }}
                  initial={{ opacity: 0, scale: 0.98, y: 14 }}
                  role="dialog"
                  transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
                >
                  <div className="book-editor-heading">
                    <div><p className="panel-kicker">编辑与分享</p><h3>这本家书的私密工作台</h3></div>
                    <button aria-label="关闭家书编辑" className="secondary" onClick={onCloseBookEditor} type="button">完成阅读</button>
                  </div>
                  <label>
                    家书标题
                    <input aria-label="家书标题" onChange={(event) => setBookTitleDraft(event.target.value)} value={bookTitleDraft} />
                  </label>
                  <label>
                    家书正文
                    <textarea aria-label="家书正文" onChange={(event) => setBookBodyDraft(event.target.value)} value={bookBodyDraft} />
                  </label>
                  <div className="book-actions">
                    <button className="primary" disabled={bookLoading} onClick={onSaveBook} type="button">保存家书修改</button>
                  </div>
                  {bookSaveError ? <p role="alert">{bookSaveError}</p> : null}
                  {activeBook.sourceLabelList.length > 0 ? (
                    <div className="book-sections" aria-label="真实来源标签">
                      <strong>来源记忆</strong>
                      {activeBook.sourceLabelList.map((label) => <span className="book-source" key={label}>{label}</span>)}
                    </div>
                  ) : null}
                  <div className="book-sections" aria-label="分享面板">
                    <strong>分享范围</strong>
                    <label><input checked={shareOptions.showBody} onChange={(event) => setShareOptions({ ...shareOptions, showBody: event.target.checked })} type="checkbox" />显示家书正文</label>
                    <label><input checked={shareOptions.showSourceTitles} onChange={(event) => setShareOptions({ ...shareOptions, showSourceTitles: event.target.checked })} type="checkbox" />显示来源标题</label>
                    <label><input aria-label="分享原始文本" checked={shareOptions.showOriginalText} onChange={(event) => setShareOptions({ ...shareOptions, showOriginalText: event.target.checked })} type="checkbox" />分享原始文本</label>
                    <button className="secondary" disabled={shareLoading} onClick={onCreateShare} type="button">创建分享链接</button>
                    {shareError ? <p role="alert">{shareError}</p> : null}
                    {bookShares.map((share) => (
                      <div className="book-source" key={share.token}>
                        <span>{share.url}</span>
                        <button aria-label={`撤回分享：${share.token}`} className="secondary" disabled={shareLoading} onClick={() => onRevokeShare(share.token)} type="button">撤回</button>
                      </div>
                    ))}
                  </div>
                </motion.section>
              ) : null}
            </AnimatePresence>
          </section>
        )}
      </div>
    );
  }

  return (
    <>
      <PlanetLinkField links={planetLinks} planets={planets} />

      <div className="orbit family-orbit" />
      <div className="orbit memory-orbit" />

      {planets.length === 0 ? (
        <section className="scene-empty-state" aria-label="空家庭星系">
          <h2>先创建第一颗家人星球</h2>
          <p>从一个真实的家人开始，之后的记忆星、共鸣星轨和家书都会从这里生长。</p>
          <button className="primary" onClick={onOpenStarMapEditor} type="button">创建家人星球</button>
        </section>
      ) : null}

      {planets.map((planet) => (
        <GalaxyPlanetObject
          key={planet.id}
          onConfigurePrivacy={onConfigurePlanetPrivacy}
          onEditTheme={onEditPlanetTheme}
          onOpenBookWorkshop={onOpenBookWorkshopFromPlanet}
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
          onClick={() => onOpenConfirmedMemory(memory.id)}
          top={`${28 + Math.floor(index / 4) * 10}%`}
          variant="coral"
        />
      ))}

      {litMemories.length > 0 ? (
        <SparkButton label="查看真实共鸣候选" left="50%" onClick={() => onGo("resonance")} top="25%" />
      ) : null}

    </>
  );
}

function memorialScenePosition(index: number, count: number) {
  if (count === 1) return { left: "50%", top: "50%" };

  const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
  return {
    left: `${50 + Math.cos(angle) * 24}%`,
    top: `${50 + Math.sin(angle) * 18}%`,
  };
}

function ScenePlanetButton({
  badge,
  className,
  coverAssetId,
  label,
  left,
  onClick,
  theme,
  top,
}: {
  badge: string;
  className: string;
  coverAssetId?: string | null;
  label: string;
  left: string;
  onClick: () => void;
  theme: string;
  top: string;
}) {
  return (
    <button
      aria-label={label}
      className={`planet ${className}${coverAssetId ? " has-cover" : ""}`}
      data-theme={theme}
      onClick={onClick}
      style={{ left, top, ...planetThemeStyle(theme), ...planetCoverStyle(coverAssetId) }}
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
            data-link-id={link.id}
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
  onOpenBookWorkshop,
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
  onOpenBookWorkshop: (planet: Planet) => void;
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
  const style = { left: `${planet.position.x}%`, top: `${planet.position.y}%`, ...planetPresentationStyle(planet) };
  const presentationType = getPlanetPresentationType(planet);
  const showActionRing = selected || closing;

  return (
    <>
      <button
        aria-label={`进入${planet.name}漫游`}
        className={`${planetClassByType[presentationType]}${planet.coverAssetId ? " has-cover" : ""} ${selected ? "selected" : ""}`}
        data-theme={planet.theme}
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
              <button aria-label="进入家书工坊" className="orbit-action action-book" onClick={() => onOpenBookWorkshop(planet)} type="button">
                <BookOpen size={15} />
                <span>写成家书</span>
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
  steps,
}: {
  activeStep: number;
  collapsed: boolean;
  onRunStep: (index: number) => void;
  onToggle: () => void;
  steps: RouteStep[];
}) {
  return (
    <article className={`route-card ${collapsed ? "collapsed" : ""}`} id="routeCard">
      <h2>新手推荐航线</h2>
      <p>这不是强制流程，只是一条第一次进入星系时更容易看见产品价值的观星路线。</p>
      <div className="route-steps">
        {steps.map((step, index) => (
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
          {steps[0]?.action === "create" ? "开始创建" : "开始靠近"}
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
      onWheel={(event) => event.stopPropagation()}
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
        <p className="panel-readonly">显示筛选仅影响本次浏览，不会改写已保存的家庭关系。</p>
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
            <article
              className={`star-link-row ${link.status === "hidden" ? "muted" : ""}`}
              key={link.id}
            >
              <span>
                <strong>{link.label}</strong>
                <small>
                  {planetById.get(link.sourcePlanetId)} → {planetById.get(link.targetPlanetId)}
                </small>
              </span>
              <em>{planetLinkKindLabels[link.kind]}</em>
            </article>
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
  litMemories,
  quickRecordContent,
  quickRecordFile,
  quickRecordSource,
  loading,
  memoryFlowError,
  memoryPrimaryActionLabel,
  memoryReview,
  quickRecordTarget,
  reviewSummary,
  reviewTitle,
  selectedMemory,
  selectedMemoryId,
  resonanceCandidate,
  resonanceSourceMemory,
  resonanceTargetMemory,
  resonanceError,
  resonanceDecisionMessage,
  resonanceLoading,
  onClose,
  onGo,
  onLightMemory,
  onConfirmMemory,
  onQuickRecordChange,
  onQuickRecordFileChange,
  onQuickRecordSourceChange,
  onReviewSummaryChange,
  onReviewTitleChange,
  onRetryMemoryExtraction,
  onScanResonance,
  onDecideResonance,
  onPersistPlanetChange,
  onOpenPanel,
  onSelectTheme,
  selectedPlanet,
}: {
  activePanel: PanelKey | null;
  litMemories: MemoryStar[];
  quickRecordContent: string;
  quickRecordFile: File | null;
  quickRecordSource: QuickRecordSource;
  loading: boolean;
  memoryFlowError: string | null;
  memoryPrimaryActionLabel: string;
  memoryReview: LegacyMemoryResponse | null;
  quickRecordTarget: Planet | null;
  reviewSummary: string;
  reviewTitle: string;
  selectedMemory: MemoryStar | null;
  selectedMemoryId: string | null;
  resonanceCandidate: LegacyPendingResonance | null;
  resonanceSourceMemory: MemoryStar | null;
  resonanceTargetMemory: MemoryStar | null;
  resonanceError: string | null;
  resonanceDecisionMessage: string | null;
  resonanceLoading: boolean;
  onClose: () => void;
  onGo: (zone: GalaxyZoneKey) => void;
  onLightMemory: () => void;
  onConfirmMemory: () => void;
  onQuickRecordChange: (value: string) => void;
  onQuickRecordFileChange: (file: File | null) => void;
  onQuickRecordSourceChange: (source: QuickRecordSource) => void;
  onReviewSummaryChange: (value: string) => void;
  onReviewTitleChange: (value: string) => void;
  onRetryMemoryExtraction: () => void;
  onScanResonance: () => Promise<boolean>;
  onDecideResonance: (status: "confirmed" | "rejected") => Promise<boolean>;
  onPersistPlanetChange: (planet: Planet, changes: LegacyPlanetChanges) => Promise<boolean>;
  onOpenPanel: (key: PanelKey) => void;
  onSelectTheme: (theme: string) => void;
  selectedPlanet: Planet | null;
}) {
  if (!activePanel) return null;

  const sharedProps = { role: "complementary", "aria-label": "星图详情" };
  const lifecycleMemories = selectedPlanet
    ? litMemories.filter((memory) => memory.planetId === selectedPlanet.id)
    : [];

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

      {["scopePrivate", "scopeFamily", "scopePublic"].includes(activePanel) ? (
        <ScopePanel
          activePanel={activePanel}
          planet={selectedPlanet}
          onSaveVisibility={(visibility) => {
            if (selectedPlanet) void onPersistPlanetChange(selectedPlanet, { visibility });
          }}
        />
      ) : null}

      {activePanel === "memory1" ? (
        selectedMemoryId !== null ? (
          selectedMemory ? (
            <>
              <h2>{selectedMemory.title}</h2>
              <div className="tags">
                <span className="tag">{selectedMemory.visibility === "private" ? "私密记忆" : "家庭可见"}</span>
                {selectedMemory.occurredAt ? <span className="tag">{selectedMemory.occurredAt}</span> : null}
                {selectedMemory.location ? <span className="tag">{selectedMemory.location}</span> : null}
              </div>
              <p>{selectedMemory.summary.trim() || "这条已确认记忆暂未填写摘要。"}</p>
              <div className="ai-card">
                <strong>已确认记忆星：</strong>
                <p>
                  {`时间：${selectedMemory.occurredAt || "未填写"}。地点：${selectedMemory.location || "未填写"}。人物：${selectedMemory.people.join("、") || "未填写"}。情绪：${selectedMemory.emotions.join("、") || "暂无"}。`}
                </p>
              </div>
              {resonanceError ? (
                <div className="ai-card" role="alert">
                  <p>{resonanceError}</p>
                </div>
              ) : null}
              <div className="big-actions">
                <button
                  className="primary"
                  disabled={resonanceLoading}
                  onClick={async () => {
                    if (!(await onScanResonance())) return;
                    onGo("resonance");
                    onClose();
                  }}
                  type="button"
                >
                  {resonanceLoading ? "正在扫描共鸣…" : "沿共鸣星轨前进"}
                </button>
                <button className="secondary" onClick={() => onOpenPanel("quickRecord")} type="button">
                  补充另一个视角
                </button>
              </div>
            </>
          ) : (
            <>
              <h2>无可展示内容</h2>
              <p>这颗已确认记忆星当前没有可安全展示的内容，请刷新星图后重试。</p>
            </>
          )
        ) : (
          <>
            <h2>未找到这颗记忆星</h2>
            <p>请从星图中选择一颗已确认的记忆星后再查看详情。</p>
          </>
        )
      ) : null}

      {activePanel === "resonance" ? (
        resonanceCandidate ? (
          <>
            <h2>共鸣候选</h2>
            <div className="tags">
              <span className="tag public">待家人确认</span>
              <span className="tag">匹配度 {Math.round(resonanceCandidate.score * 100)}%</span>
            </div>
            <p>{resonanceCandidate.reason}</p>
            <div className="source-pair">
              <div className="source-card">
                <strong>{resonanceSourceMemory?.title ?? "来源记忆"}</strong>
                <p>{safeMemorySummary(resonanceSourceMemory)}</p>
              </div>
              <div className="source-card">
                <strong>{resonanceTargetMemory?.title ?? "目标记忆"}</strong>
                <p>{safeMemorySummary(resonanceTargetMemory)}</p>
              </div>
            </div>
            <h3>AI 给出的候选理由</h3>
            <div className="ai-card">
              <p>这是一条待确认的候选连接，不会在确认前进入家书工坊或画入家庭星图。</p>
            </div>
            {resonanceError ? (
              <div className="ai-card" role="alert">
                <p>{resonanceError}</p>
              </div>
            ) : null}
            <div className="big-actions">
              <button
                className="primary"
                disabled={resonanceLoading}
                onClick={() => {
                  void onDecideResonance("confirmed");
                }}
                type="button"
              >
                {resonanceLoading ? "确认中…" : "确认这条星轨"}
              </button>
              <button
                className="secondary"
                disabled={resonanceLoading}
                onClick={() => {
                  void onDecideResonance("rejected");
                }}
                type="button"
              >
                暂不确认 / 拒绝
              </button>
            </div>
          </>
        ) : (
          <>
            <h2>共鸣候选</h2>
            <p>{resonanceDecisionMessage ?? "当前没有待确认的共鸣候选。"}</p>
            {resonanceError ? (
              <div className="ai-card" role="alert">
                <p>{resonanceError}</p>
              </div>
            ) : null}
            {resonanceDecisionMessage === "已确认这条星轨，可进入家书工坊。" ? (
              <div className="big-actions">
                <button
                  className="primary"
                  onClick={() => {
                    onGo("books");
                    onClose();
                  }}
                  type="button"
                >
                  进入家书工坊
                </button>
              </div>
            ) : null}
          </>
        )
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
            {lifecycleMemories.length > 0 ? lifecycleMemories.map((memory) => (
              <article key={memory.id}>
                <i>{memory.occurredAt || "未标注时间"}</i>
                <strong>{memory.title}</strong>
                <span>{memory.summary.trim() || "这条已确认记忆暂未填写摘要。"}</span>
              </article>
            )) : (
              <p className="panel-readonly">当前还没有已确认的阶段记忆</p>
            )}
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
          <p>不用填完整表单。先留下一句话，AI 会整理为待确认记忆；只有你确认后才会进入轨道。</p>
          <p className="panel-readonly" aria-label="当前记忆目标">
            目标星球：{quickRecordTarget?.name ?? "未选择"}
          </p>
          {memoryReview ? (
            <>
              <div className="ai-card">
                <strong>AI 整理结果，等待你的确认</strong>
                <p>状态：{memoryReview.status}</p>
                {memoryReview.uncertainFields?.length ? (
                  <p>待确认字段：{memoryReview.uncertainFields.join("、")}</p>
                ) : null}
              </div>
              <label>
                标题
                <input
                  aria-label="记忆标题"
                  className="panel-input"
                  onChange={(event) => onReviewTitleChange(event.target.value)}
                  value={reviewTitle}
                />
              </label>
              <label>
                摘要
                <textarea
                  aria-label="记忆摘要"
                  className="panel-textarea"
                  onChange={(event) => onReviewSummaryChange(event.target.value)}
                  value={reviewSummary}
                />
              </label>
              <div className="big-actions">
                <button className="primary" disabled={loading} onClick={onConfirmMemory} type="button">
                  {loading ? "确认中…" : "确认点亮记忆星"}
                </button>
              </div>
            </>
          ) : (
            <>
              <label>
                选择记忆来源
                <select
                  aria-label="选择记忆来源"
                  className="panel-select"
                  onChange={(event) => onQuickRecordSourceChange(event.target.value as QuickRecordSource)}
                  value={quickRecordSource}
                >
                  <option value="text">写下一句话</option>
                  <option value="image">上传一张照片</option>
                  <option value="audio">上传一段语音</option>
                  <option value="document">上传一份日记或文件</option>
                </select>
              </label>
              {quickRecordSource === "text" ? (
                <textarea
                  aria-label="记忆内容"
                  className="panel-textarea"
                  onChange={(event) => onQuickRecordChange(event.target.value)}
                  value={quickRecordContent}
                />
              ) : (
                <label>
                  {quickRecordSource === "image" ? "上传图片" : quickRecordSource === "audio" ? "上传语音" : "上传文件"}
                  <input
                    accept={quickRecordSource === "image" ? "image/*" : quickRecordSource === "audio" ? "audio/*" : ".pdf,.doc,.docx,.txt,.md"}
                    aria-label={quickRecordSource === "image" ? "上传图片" : quickRecordSource === "audio" ? "上传语音" : "上传文件"}
                    className="panel-input"
                    onChange={(event) => onQuickRecordFileChange(event.target.files?.[0] ?? null)}
                    type="file"
                  />
                  <span className="panel-readonly">
                    {quickRecordFile ? `已选择：${quickRecordFile.name}` : "原始来源只用于本次授权整理，不会自动点亮或分享。"}
                  </span>
                </label>
              )}
              <div className="ai-card">
                <strong>整理预览</strong>
                <p>
                  {quickRecordSource === "text"
                    ? "AI 将尝试提取时间、地点、人物和事件；默认不公开，也不会自动确认或分享。"
                    : "会先保存这份真实来源，再在你明确授权后交给 AI 整理；只有确认后才会进入星系轨道。"}
                </p>
              </div>
              <div className="big-actions">
                <button className="primary" disabled={loading} onClick={onLightMemory} type="button">
                  {loading ? "AI 整理中…" : memoryPrimaryActionLabel}
                </button>
              </div>
            </>
          )}
          {memoryFlowError ? (
            <div className="ai-card" role="alert">
              <p>{memoryFlowError}</p>
              <button className="secondary" disabled={loading} onClick={onRetryMemoryExtraction} type="button">
                重试 AI 整理
              </button>
            </div>
          ) : null}
        </>
      ) : null}

    </motion.aside>
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
    public: "公开可见（不创建链接）",
  };
  const visibilityControls = planet ? (
    <section aria-label="星球可见范围" className="scope-visibility-actions">
      <p>当前可见范围：{visibilityLabel[planet.visibility]}</p>
      <p>这里保存的是星球的可见范围，不会生成外部访问链接；需要公开时，请在家书工坊创建可撤回链接。</p>
      <button className="secondary" onClick={() => onSaveVisibility("private")} type="button">
        设为私密核心
      </button>
      <button className="secondary" onClick={() => onSaveVisibility("family")} type="button">
        设为家庭可见
      </button>
      <button className="secondary" onClick={() => onSaveVisibility("public")} type="button">
        设为公开可见
      </button>
    </section>
  ) : null;

  if (activePanel === "scopePrivate") {
    return (
      <>
        <h2>私密核心</h2>
        <div className="tags">
          <span className="tag private">仅自己可见</span>
        </div>
        <p>适合个人日记、未整理的情绪、尚未确认的记忆。AI 整理与进入共鸣的授权都在记忆确认步骤逐条完成；私密原始素材始终不会被公开。</p>
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
        <p>适合家庭旅行、节日、生日和亲子成长。共同记忆识别与家书生成都以每条已确认记忆的授权为准。</p>
        {visibilityControls}
      </>
    );
  }

  return (
    <>
      <h2>公开分享轨道</h2>
      <div className="tags">
          <span className="tag public">可创建家书链接</span>
        </div>
        <p>公开链接只能在家书工坊中为已确认家书创建，之后也可随时撤回；原始素材始终不会公开。</p>
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

function PlanetRoamingOverlay({
  memories,
  planet,
  onBook,
  onClose,
  onConfigurePrivacy,
  onQuickRecord,
}: {
  memories: MemoryStar[];
  planet: Planet;
  onBook: () => void;
  onClose: () => void;
  onConfigurePrivacy: () => void;
  onQuickRecord: () => void;
}) {
  const presentationType = getPlanetPresentationType(planet);
  const planetMemories = memories.filter((memory) => memory.planetId === planet.id);
  const nodes: StoryNode[] = planetMemories.map((memory) => ({
    id: memory.id,
    planetId: memory.planetId,
    year: memory.occurredAt || "未标注时间",
    title: memory.title,
    summary: memory.summary || "这条已确认记忆暂未填写摘要。",
    sourceLabel: memory.location || "已确认记忆",
  }));
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
          <div
            className={`inner-planet-body ${presentationType}${planet.coverAssetId ? " has-cover" : ""}`}
            style={planetPresentationStyle(planet)}
          />
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
            <span aria-label={`星球 ${planet.name} 共鸣星轨 ${planet.stats.resonanceTracks} 条`}>
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
            {planetMemories.map((memory) => (
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
          onConfigurePrivacy={onConfigurePrivacy}
          onQuickRecord={() => {
            setStorySceneNodeId(null);
            onQuickRecord();
          }}
        />
      ) : null}
    </motion.section>
  );
}

function StorySceneOverlay({
  node,
  onAddToBook,
  onClose,
  onConfigurePrivacy,
  onQuickRecord,
}: {
  node: StoryNode;
  onAddToBook: () => void;
  onClose: () => void;
  onConfigurePrivacy: () => void;
  onQuickRecord: () => void;
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
        <span>记忆光粒</span>
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
        </div>
        <div className="big-actions">
          <button className="primary" onClick={onQuickRecord} type="button">
            补充一句话
          </button>
          <button className="secondary" onClick={onAddToBook} type="button">
            加入家书
          </button>
          <button className="secondary" onClick={onConfigurePrivacy} type="button">
            设权限
          </button>
        </div>
      </div>
    </motion.section>
  );
}
