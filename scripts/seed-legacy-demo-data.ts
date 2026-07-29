import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

type Options = {
  appContainer?: string;
  baseUrl: string;
  container: string;
  dryRun: boolean;
  galaxyId?: string;
  userId?: string;
};

type DatabaseTarget = {
  container: string;
  database: string;
  user: string;
};

type MediaTarget = {
  container: string;
  root: string;
};

type GalaxyScope = {
  galaxyId: string;
  galaxyName: string;
  latestActiveSession: string | null;
  updatedAt: string;
  userId: string;
};

type PlanetSeed = {
  id: string;
  lifeState: "active" | "memorial";
  name: string;
  position: { x: number; y: number };
  role: string;
  summary: string;
  theme: string;
  type: "parent" | "child" | "other";
};

type MemorySeed = {
  id: string;
  locationLabel: string;
  occurredAt: string;
  occurredAtLabel: string;
  people: string[];
  planetId: string;
  sourceText: string;
  summary: string;
  tags: string[];
  title: string;
};

type RelationshipSeed = {
  id: string;
  label: string;
  relationshipType: "child" | "partner";
  sourcePlanetId: string;
  targetPlanetId: string;
};

type ResonanceSeed = {
  id: string;
  reason: string;
  score: number;
  sourceMemoryId: string;
  targetMemoryId: string;
};

type DemoMediaSource = {
  fileName: string;
  label: "kitchen-light" | "rainy-drive" | "starlight-drawing" | "osmanthus-recipe";
  memoryLabel: "memory-kitchen-light" | "memory-rainy-school-run" | "memory-family-portrait" | "memory-grandma-recipe";
  originalName: string;
  planetLabel: "planet-mom" | "planet-dad" | "planet-child" | "planet-grandma-memorial";
};

type DemoAssetSeed = {
  bytes: Uint8Array;
  height: number;
  id: string;
  kind: "image" | "planet_cover";
  memoryId: string | null;
  mimeType: "image/webp";
  normalizedBytes: Uint8Array;
  normalizedStorageKey: string;
  originalName: string;
  planetId: string;
  sha256: string;
  sizeBytes: number;
  sourceFileName: string;
  storageKey: string;
  thumbnailBytes: Uint8Array;
  thumbnailStorageKey: string;
  visibility: "family" | "private";
  width: number;
};

type DemoDataset = {
  assets: DemoAssetSeed[];
  book: {
    body: string;
    draft: Record<string, unknown>;
    id: string;
    sections: Array<{ body: string; sourceMemoryIds: string[]; title: string }>;
    title: string;
  };
  memories: MemorySeed[];
  planets: PlanetSeed[];
  relationships: RelationshipSeed[];
  resonances: ResonanceSeed[];
  share: {
    id: string;
    token: string;
  };
};

const DEMO_MARKER = "legacy-family-demo-v1";
const DEMO_MEDIA_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), "demo-media");
const DEMO_MEDIA_SOURCES: readonly DemoMediaSource[] = [
  { label: "kitchen-light", fileName: "kitchen-light.webp", originalName: "雨夜厨房的灯.webp", memoryLabel: "memory-kitchen-light", planetLabel: "planet-mom" },
  { label: "rainy-drive", fileName: "rainy-drive.webp", originalName: "雨夜送学的车灯.webp", memoryLabel: "memory-rainy-school-run", planetLabel: "planet-dad" },
  { label: "starlight-drawing", fileName: "starlight-drawing.webp", originalName: "星空里的全家福.webp", memoryLabel: "memory-family-portrait", planetLabel: "planet-child" },
  { label: "osmanthus-recipe", fileName: "osmanthus-recipe.webp", originalName: "外婆的桂花糕.webp", memoryLabel: "memory-grandma-recipe", planetLabel: "planet-grandma-memorial" },
];

async function main() {
  const options = readOptions(process.argv.slice(2));

  if (options.dryRun) {
    console.log(JSON.stringify({
      status: "dry-run",
      marker: DEMO_MARKER,
      story: "林晚晴、沈知秋、林小满与外婆的纪念星",
      intended: { planets: 4, memories: 8, relationships: 4, confirmedResonances: 3, books: 1, activeShares: 1, imageAssets: 4, planetCovers: 4, storedMediaFiles: 24 },
      media: {
        assetIdDerivation: `stableId(${DEMO_MARKER}:<userId>:asset-image-<source>) / stableId(${DEMO_MARKER}:<userId>:asset-cover-<source>)`,
        dimensions: { width: 1600, height: 1200 },
        mimeType: "image/webp",
        sourceImages: DEMO_MEDIA_SOURCES.map((source) => source.fileName),
      },
      note: "不会连接数据库，也不会修改任何数据。",
    }, null, 2));
    return;
  }

  assertExplicitWriteScope(options);
  const target = await readDatabaseTarget(options.container);
  const scope = chooseScope(await listGalaxyScopes(target), options);
  const dataset = await createDemoDataset(scope);
  const mediaTarget = await readMediaTarget(options, target.container);

  await runPsql(target, buildSeedSql(scope, dataset));
  await copyDemoMedia(mediaTarget, dataset);
  const verification = await verifySeed(target, scope, dataset);
  await verifyStoredMedia(mediaTarget, dataset);

  console.log(JSON.stringify({
    status: "seeded",
    marker: DEMO_MARKER,
    galaxyName: scope.galaxyName,
    story: "林晚晴、沈知秋、林小满与外婆的纪念星",
    verification: { ...verification, storedMediaFiles: dataset.assets.length * 3 },
    shareUrl: `${options.baseUrl}/share/${dataset.share.token}`,
    note: "本次仅追加固定标记的虚构演示故事；已有真实星球、记忆和家书均未改动。",
  }, null, 2));
}

function readOptions(args: string[]): Options {
  const options: Options = {
    baseUrl: "http://localhost",
    container: "jiashu-postgres-1",
    dryRun: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (value === "--container" || value === "--app-container" || value === "--user-id" || value === "--galaxy-id" || value === "--base-url") {
      const next = args[index + 1];
      if (!next || next.startsWith("--")) throw new Error(`${value} 需要一个值。`);
      index += 1;
      if (value === "--container") options.container = next;
      if (value === "--app-container") options.appContainer = next;
      if (value === "--user-id") options.userId = next;
      if (value === "--galaxy-id") options.galaxyId = next;
      if (value === "--base-url") options.baseUrl = next.replace(/\/$/, "");
      continue;
    }

    if (value === "--help" || value === "-h") {
      console.log("用法：npx tsx scripts/seed-legacy-demo-data.ts --user-id <id> --galaxy-id <id> [--container <postgres-name>] [--app-container <app-name>] [--base-url <url>]；仅查看计划可使用 --dry-run。 ");
      process.exit(0);
    }

    throw new Error(`不支持的参数：${value}`);
  }

  return options;
}

async function readDatabaseTarget(container: string): Promise<DatabaseTarget> {
  const variables = await readContainerEnvironment(container);
  const user = variables.get("POSTGRES_USER");
  const database = variables.get("POSTGRES_DB");

  if (!user || !database) throw new Error(`容器 ${container} 未提供 POSTGRES_USER 或 POSTGRES_DB。`);
  return { container, user, database };
}

function assertExplicitWriteScope(options: Options) {
  if (!options.userId || !options.galaxyId) {
    throw new Error("写入演示数据必须同时提供 --user-id 与 --galaxy-id；不指定范围时请使用 --dry-run。 ");
  }
}

async function readMediaTarget(options: Options, databaseContainer: string): Promise<MediaTarget> {
  const container = options.appContainer ?? await findComposeAppContainer(databaseContainer);
  const variables = await readContainerEnvironment(container);
  const root = validateMediaRoot(variables.get("MEDIA_STORAGE_ROOT"));
  return { container, root };
}

async function readContainerEnvironment(container: string) {
  const inspected = await runCommand("docker", ["inspect", "-f", "{{range .Config.Env}}{{println .}}{{end}}", container]);
  return new Map(inspected.stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => {
    const separator = line.indexOf("=");
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
}

async function findComposeAppContainer(databaseContainer: string) {
  const inspected = await runCommand("docker", [
    "inspect",
    "-f",
    "{{index .Config.Labels \"com.docker.compose.project\"}}",
    databaseContainer,
  ]);
  const project = inspected.stdout.trim();

  if (!project) {
    throw new Error(`容器 ${databaseContainer} 未标记 Compose 项目；请通过 --app-container 明确指定应用容器。`);
  }

  const listed = await runCommand("docker", [
    "ps",
    "--filter", `label=com.docker.compose.project=${project}`,
    "--filter", "label=com.docker.compose.service=app",
    "--format", "{{.Names}}",
  ]);
  const containers = listed.stdout.trim().split(/\r?\n/).filter(Boolean);

  if (containers.length !== 1) {
    throw new Error(`Compose 项目 ${project} 未找到唯一运行中的 app 容器；请通过 --app-container 明确指定。`);
  }

  return containers[0]!;
}

function validateMediaRoot(value: string | undefined) {
  const root = value?.replace(/\/+$/, "");
  if (!root || !/^\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/.test(root)) {
    throw new Error("应用容器的 MEDIA_STORAGE_ROOT 必须是安全的绝对 POSIX 路径。 ");
  }
  return root;
}

async function listGalaxyScopes(target: DatabaseTarget): Promise<GalaxyScope[]> {
  const output = await runPsql(target, `
    SELECT COALESCE(json_agg(scope), '[]'::json)::text
    FROM (
      SELECT
        galaxy."id" AS "galaxyId",
        galaxy."userId" AS "userId",
        galaxy."name" AS "galaxyName",
        galaxy."updatedAt" AS "updatedAt",
        (
          SELECT MAX(session."expires")
          FROM "Session" AS session
          WHERE session."userId" = galaxy."userId"
            AND session."expires" > CURRENT_TIMESTAMP
        ) AS "latestActiveSession"
      FROM "Galaxy" AS galaxy
      ORDER BY "latestActiveSession" DESC NULLS LAST, galaxy."updatedAt" DESC
    ) AS scope;
  `);

  return JSON.parse(output.trim()) as GalaxyScope[];
}

function chooseScope(scopes: GalaxyScope[], options: Options): GalaxyScope {
  const matches = scopes.filter((scope) =>
    (!options.userId || scope.userId === options.userId)
    && (!options.galaxyId || scope.galaxyId === options.galaxyId),
  );

  if (matches.length !== 1) {
    throw new Error("没有找到唯一目标星系；请检查 --user-id 与 --galaxy-id 是否匹配。 ");
  }

  return matches[0];
}

async function createDemoDataset(scope: GalaxyScope): Promise<DemoDataset> {
  const id = (label: string) => stableId(`${scope.userId}:${label}`);
  const mom = id("planet-mom");
  const dad = id("planet-dad");
  const child = id("planet-child");
  const grandma = id("planet-grandma-memorial");

  const memories: MemorySeed[] = [
    {
      id: id("memory-reunion-dinner"),
      planetId: mom,
      title: "桂花香里的团圆饭",
      summary: "晚晴把外婆留下的搪瓷碗摆上桌，发现一家人最想念的不是哪一道菜，而是彼此都在。",
      sourceText: "除夕傍晚，林晚晴在厨房煨最后一锅汤。沈知秋把窗上的雾擦开，林小满踮脚把桂花糕端到桌上。外婆常用的那只搪瓷碗也被摆在中间，没有人说想念，却都在盛汤时轻轻碰了碰它。晚晴忽然明白，团圆不是把人凑齐，而是每个人都愿意把回家的路留亮。",
      tags: ["演示数据", "团圆饭", "家的味道"],
      occurredAt: "2025-01-28T18:30:00.000Z",
      occurredAtLabel: "2025 年除夕傍晚",
      locationLabel: "家里的厨房与餐桌",
      people: ["林晚晴", "沈知秋", "林小满", "外婆"],
    },
    {
      id: id("memory-kitchen-light"),
      planetId: mom,
      title: "雨夜厨房的灯",
      summary: "晚晴在女儿晚归的雨夜一直留着厨房灯，那盏灯后来成了全家默认的安心信号。",
      sourceText: "那天雨下得很急，林小满参加完学校排练还没有到家。林晚晴没有坐在客厅等，只把厨房的小灯打开，慢慢热着一碗番茄面。门锁响的时候，小满浑身带着水汽，说：妈妈，我远远看到这盏灯，就知道你没有生气。晚晴笑着把毛巾递过去，心里却悄悄记住：原来等一个人回家，也可以不带一点责备。",
      tags: ["演示数据", "雨夜", "母女"],
      occurredAt: "2025-04-16T13:20:00.000Z",
      occurredAtLabel: "2025 年春天的一场雨夜",
      locationLabel: "家里的厨房",
      people: ["林晚晴", "林小满"],
    },
    {
      id: id("memory-rainy-school-run"),
      planetId: dad,
      title: "雨夜送学的车灯",
      summary: "知秋绕远路送女儿去排练，车灯穿过雨幕，也照亮了父女间不必说出口的支持。",
      sourceText: "学校临时通知要补一次合唱排练，外面正下着大雨。沈知秋没有问值不值得，只拿起伞和车钥匙。他绕开积水最深的路，把车停在教学楼屋檐下。林小满下车前小声说，爸爸，今天其实有点想放弃。知秋看着她说，那就先进去唱完这一首，想不想继续，回家路上再决定。那晚回程很安静，后座却一直传来她轻轻哼歌的声音。",
      tags: ["演示数据", "雨夜送学", "父女"],
      occurredAt: "2025-04-16T12:45:00.000Z",
      occurredAtLabel: "2025 年春天的一场雨夜",
      locationLabel: "去往学校的路上",
      people: ["沈知秋", "林小满"],
    },
    {
      id: id("memory-graduation-wind"),
      planetId: dad,
      title: "把名字写进风里",
      summary: "女儿毕业那天，知秋把一句没有说出口的骄傲写在卡片背面，放进她的书包。",
      sourceText: "毕业典礼散场后，人群很快散去。沈知秋站在操场边等林小满和同学拍完最后一张照片。他没有像别人那样举着花束喊名字，只把一张写着“去见更大的世界，家永远在原地等你”的卡片塞进她书包侧袋。晚上小满才发现那张卡片，给他发来一张模糊的月亮照片。知秋把照片设成了手机壁纸，很多天都没有换。",
      tags: ["演示数据", "成长", "毕业"],
      occurredAt: "2025-06-25T09:30:00.000Z",
      occurredAtLabel: "2025 年毕业季",
      locationLabel: "学校操场",
      people: ["沈知秋", "林小满"],
    },
    {
      id: id("memory-family-portrait"),
      planetId: child,
      title: "星空里的全家福",
      summary: "小满把家人画成四颗不同颜色的星，说每颗星都在用自己的光照着彼此。",
      sourceText: "美术课要画“我最想守护的地方”，林小满没有画房子，而是画了一片深蓝色的星空。妈妈是一颗暖金色的星，爸爸是蓝白色的星，自己是一颗会拖尾的小星星，外婆则是最远的一点紫光。老师问她为什么外婆离得那么远，小满说：因为她去了很远的地方，可是她的光还会照到我们。那张画后来一直贴在餐桌旁。",
      tags: ["演示数据", "全家福", "星空"],
      occurredAt: "2025-05-09T08:00:00.000Z",
      occurredAtLabel: "2025 年初夏",
      locationLabel: "学校美术教室",
      people: ["林小满", "林晚晴", "沈知秋", "外婆"],
    },
    {
      id: id("memory-star-for-grandma"),
      planetId: child,
      title: "给外婆的那颗星",
      summary: "小满在生日愿望里为外婆留了一颗星，并决定把她的故事一段段记下来。",
      sourceText: "生日吹蜡烛前，林小满闭了很久眼。大家问她许了什么愿，她说不能说。后来她把愿望写进日记：希望外婆在天上也有一颗不熄的星，希望自己长大后还能做出她教的桂花糕。她还在最后写了一句，等我会做了，就请爸爸妈妈一起尝。晚晴读到这页时没有打扰，只在日记边上画了一颗小小的紫色五角星。",
      tags: ["演示数据", "纪念星", "生日愿望"],
      occurredAt: "2025-09-12T11:10:00.000Z",
      occurredAtLabel: "2025 年生日当天",
      locationLabel: "家里的餐桌",
      people: ["林小满", "林晚晴", "沈知秋", "外婆"],
    },
    {
      id: id("memory-grandma-recipe"),
      planetId: grandma,
      title: "外婆的桂花糕",
      summary: "一张写满油渍的菜谱，把外婆不肯说出口的疼爱留在了家人的味觉里。",
      sourceText: "外婆的菜谱夹在旧书里，纸角已经卷起，上面写着“糖少一点，小满怕腻”。林晚晴看到这句话时愣了很久。原来外婆记得的从来不只是配方，还记得每个人的口味和心事。那年除夕，晚晴照着菜谱做了第一锅桂花糕，蒸汽散开的时候，沈知秋说味道和以前很像，林小满却认真地补了一句：不，是外婆回来了。",
      tags: ["演示数据", "外婆的菜谱", "传承"],
      occurredAt: "2025-01-28T16:20:00.000Z",
      occurredAtLabel: "2025 年除夕下午",
      locationLabel: "外婆留下的旧书与家里的厨房",
      people: ["外婆", "林晚晴", "沈知秋", "林小满"],
    },
    {
      id: id("memory-enamel-bowl"),
      planetId: grandma,
      title: "不舍得丢的搪瓷碗",
      summary: "那只旧碗不是纪念品，而是一家人仍愿意把日子过得热气腾腾的提醒。",
      sourceText: "搬家时，林晚晴问要不要把那只掉了瓷的搪瓷碗收起来。沈知秋摇摇头，说它还可以盛汤。于是碗没有被放进柜顶，而是在每一次团圆饭里继续出现。林小满总喜欢用它喝最后一口汤，说这样像是替外婆把今天也尝了一遍。大家后来都不再把它叫旧碗，只叫“外婆那只碗”。",
      tags: ["演示数据", "纪念星", "日常"],
      occurredAt: "2025-03-02T10:40:00.000Z",
      occurredAtLabel: "2025 年早春搬家后",
      locationLabel: "新家的餐桌",
      people: ["林晚晴", "沈知秋", "林小满", "外婆"],
    },
  ];

  const sourceMemoryIds = memories.map((memory) => memory.id);
  const bookId = id("book-home-light");
  const bookTitle = "写给未来的家书：灯火一直在";
  const sections = [
    {
      title: "把一盏灯留给回家的人",
      body: "我们后来才懂得，家最温柔的地方不是永远有人等候，而是无论晚归、犹豫还是疲惫，门后的那盏灯都不追问。它只告诉我们：你可以先回来，剩下的事慢慢说。",
      sourceMemoryIds: [id("memory-kitchen-light"), id("memory-rainy-school-run")],
    },
    {
      title: "把想念做成一块桂花糕",
      body: "外婆没有留下很大的道理，只在菜谱边上写下谁怕甜、谁爱热汤。我们照着这些细小的字继续做饭，才发现想念不是停在过去，而是让每一个普通的晚上都多一点香气。",
      sourceMemoryIds: [id("memory-grandma-recipe"), id("memory-enamel-bowl"), id("memory-reunion-dinner")],
    },
    {
      title: "去见更大的世界，也记得抬头",
      body: "小满终会走向比我们更远的地方。愿她记得，家不是把她留住的绳子，而是一片始终亮着的星空；她可以大胆往前走，累了就抬头，我们一直都在。",
      sourceMemoryIds: [id("memory-family-portrait"), id("memory-star-for-grandma"), id("memory-graduation-wind")],
    },
  ];
  const draft = {
    id: bookId,
    title: bookTitle,
    sourceRange: "family_galaxy",
    themeTemplateKey: "family_reunion",
    sourceMemoryIds,
    intro: "这封家书写给未来的我们：愿每一次回望，都还能看见彼此点亮的那盏灯。",
    chapters: sections.map((section) => ({ title: section.title, sourceMemoryIds: section.sourceMemoryIds })),
  };
  const assets = await createDemoAssets({
    id,
    scope,
  });

  return {
    assets,
    planets: [
      { id: mom, name: "林晚晴", type: "parent", lifeState: "active", role: "妈妈 · 家庭记录者", theme: "桂花与暖灯", summary: "她把平常的晚饭、等候与拥抱都记成一家人的回家路。", position: { x: 31, y: 44 } },
      { id: dad, name: "沈知秋", type: "parent", lifeState: "active", role: "爸爸 · 守望者", theme: "雨夜车灯", summary: "他不擅长把爱说得很响，却总在需要时把路照亮。", position: { x: 65, y: 39 } },
      { id: child, name: "林小满", type: "child", lifeState: "active", role: "女儿 · 小小星航员", theme: "深蓝星图", summary: "她相信每个家人都是一颗星，并认真记住每一束光。", position: { x: 56, y: 68 } },
      { id: grandma, name: "外婆的纪念星", type: "other", lifeState: "memorial", role: "纪念星 · 传承者", theme: "雾紫回声", summary: "她留下的菜谱、旧碗与称呼，仍在把一家人的日子轻轻连起。", position: { x: 78, y: 72 } },
    ],
    memories,
    relationships: [
      { id: id("relation-mom-child"), sourcePlanetId: mom, targetPlanetId: child, relationshipType: "child", label: "母女星轨" },
      { id: id("relation-dad-child"), sourcePlanetId: dad, targetPlanetId: child, relationshipType: "child", label: "父女星轨" },
      { id: id("relation-mom-dad"), sourcePlanetId: mom, targetPlanetId: dad, relationshipType: "partner", label: "并肩星轨" },
      { id: id("relation-grandma-mom"), sourcePlanetId: grandma, targetPlanetId: mom, relationshipType: "child", label: "传承星轨" },
    ],
    resonances: [
      { id: id("resonance-light"), sourceMemoryId: id("memory-kitchen-light"), targetMemoryId: id("memory-rainy-school-run"), score: 0.96, reason: "同一场雨夜里，厨房的灯与车灯分别守住了小满出发和归来的路。" },
      { id: id("resonance-starlight"), sourceMemoryId: id("memory-family-portrait"), targetMemoryId: id("memory-star-for-grandma"), score: 0.94, reason: "两段记忆都把外婆放进星空，让纪念成为继续向前的勇气。" },
      { id: id("resonance-inheritance"), sourceMemoryId: id("memory-grandma-recipe"), targetMemoryId: id("memory-reunion-dinner"), score: 0.93, reason: "菜谱里的叮咛在团圆饭里被重新尝见，家的味道完成了一次温柔传承。" },
    ],
    book: {
      id: bookId,
      title: bookTitle,
      draft,
      body: "写给未来的我们：\n\n愿我们一直记得，那些看似平常的瞬间曾怎样托住彼此。是一碗热汤、一盏厨房灯、雨夜里没有催促的一段车程，也是外婆菜谱边上那句“糖少一点”。\n\n我们会慢慢长大，也会去更远的地方。但请相信，家从不是把谁留在原地的地方；家是一片愿意彼此照亮的星空。等哪天我们走得累了，就回头看看，那里永远有一颗星为你亮着。\n\n愿灯火一直在，愿我们一直是彼此的家。",
      sections,
    },
    share: { id: id("share-home-light"), token: `jiashu-demo-${createHash("sha256").update(`${scope.userId}:${DEMO_MARKER}`).digest("hex").slice(0, 28)}` },
  };
}

async function createDemoAssets(input: {
  id: (label: string) => string;
  scope: GalaxyScope;
}): Promise<DemoAssetSeed[]> {
  const assets: DemoAssetSeed[] = [];

  for (const source of DEMO_MEDIA_SOURCES) {
    const filePath = join(DEMO_MEDIA_DIRECTORY, source.fileName);
    const bytes = new Uint8Array(await readFile(filePath));
    const metadata = await sharp(bytes).metadata();

    if (metadata.format !== "webp" || metadata.width !== 1600 || metadata.height !== 1200) {
      throw new Error(`演示图片 ${source.fileName} 必须是 1600×1200 的 WebP。`);
    }

    const normalizedBytes = new Uint8Array(await sharp(bytes).rotate().webp({ quality: 90, effort: 6 }).toBuffer());
    const thumbnailBytes = new Uint8Array(await sharp(bytes)
      .rotate()
      .resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer());
    const memoryId = input.id(source.memoryLabel);
    const planetId = input.id(source.planetLabel);
    const imageAssetId = input.id(`asset-image-${source.label}`);
    const coverAssetId = input.id(`asset-cover-${source.label}`);

    for (const asset of [
      { id: imageAssetId, kind: "image" as const, memoryId, visibility: "family" as const },
      { id: coverAssetId, kind: "planet_cover" as const, memoryId: null, visibility: "private" as const },
    ]) {
      assets.push({
        bytes,
        height: metadata.height,
        id: asset.id,
        kind: asset.kind,
        memoryId: asset.memoryId,
        mimeType: "image/webp",
        normalizedBytes,
        normalizedStorageKey: createDerivativeStorageKey(input.scope.userId, asset.id, "webp", "normalized"),
        originalName: source.originalName,
        planetId,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        sizeBytes: bytes.byteLength,
        sourceFileName: source.fileName,
        storageKey: createStorageKey(input.scope.userId, asset.id, "webp"),
        thumbnailBytes,
        thumbnailStorageKey: createDerivativeStorageKey(input.scope.userId, asset.id, "jpg", "thumbnail"),
        visibility: asset.visibility,
        width: metadata.width,
      });
    }
  }

  return assets;
}

function stableId(value: string) {
  return `c${createHash("sha256").update(`${DEMO_MARKER}:${value}`).digest("hex").slice(0, 24)}`;
}

function createStorageKey(userId: string, assetId: string, extension: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(userId) || !/^[A-Za-z0-9_-]+$/.test(assetId) || !/^[A-Za-z0-9]+$/.test(extension)) {
    throw new Error("演示媒体生成了不安全的存储键。 ");
  }
  return `${userId}/${assetId.slice(0, 2)}/${assetId}.${extension}`;
}

function createDerivativeStorageKey(
  userId: string,
  assetId: string,
  extension: string,
  variant: "normalized" | "thumbnail",
) {
  return createStorageKey(userId, `${assetId}_${variant}`, extension);
}

function containerMediaPath(target: MediaTarget, key: string) {
  if (!/^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/.test(key)) {
    throw new Error("演示媒体生成了不安全的容器存储键。 ");
  }
  return `${target.root}/${key}`;
}

function quotePosixShell(value: string) {
  return `'${value.replace(/'/g, "'\\\"'\\\"'")}'`;
}

async function copyDemoMedia(target: MediaTarget, dataset: DemoDataset) {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "jiashu-demo-media-"));

  try {
    for (const asset of dataset.assets) {
      const normalizedPath = join(temporaryDirectory, `${asset.id}_normalized.webp`);
      const thumbnailPath = join(temporaryDirectory, `${asset.id}_thumbnail.jpg`);
      await writeFile(normalizedPath, asset.normalizedBytes);
      await writeFile(thumbnailPath, asset.thumbnailBytes);

      const files = [
        { key: asset.storageKey, source: join(DEMO_MEDIA_DIRECTORY, asset.sourceFileName) },
        { key: asset.normalizedStorageKey, source: normalizedPath },
        { key: asset.thumbnailStorageKey, source: thumbnailPath },
      ];

      for (const file of files) {
        const destination = containerMediaPath(target, file.key);
        const directory = destination.slice(0, destination.lastIndexOf("/"));
        await runCommand("docker", ["exec", target.container, "sh", "-c", `mkdir -p -- ${quotePosixShell(directory)}`]);
        await runCommand("docker", ["cp", file.source, `${target.container}:${destination}`]);
      }
    }
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

async function verifyStoredMedia(target: MediaTarget, dataset: DemoDataset) {
  const keys = dataset.assets.flatMap((asset) => [
    asset.storageKey,
    asset.normalizedStorageKey,
    asset.thumbnailStorageKey,
  ]);
  const checks = keys
    .map((key) => `test -s ${quotePosixShell(containerMediaPath(target, key))}`)
    .join(" && ");
  await runCommand("docker", ["exec", target.container, "sh", "-c", `set -eu; ${checks}`]);
}

function buildSeedSql(scope: GalaxyScope, dataset: DemoDataset) {
  const now = "CURRENT_TIMESTAMP";
  const scopeGuard = `
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM "Galaxy" WHERE "id" = ${sql(scope.galaxyId)} AND "userId" = ${sql(scope.userId)}
      ) THEN
        RAISE EXCEPTION 'The selected galaxy scope no longer exists.';
      END IF;
    END $$;
  `;
  const planets = dataset.planets.map((planet) => `(
    ${sql(planet.id)}, ${sql(scope.galaxyId)}, ${sql(scope.userId)}, ${sql(planet.name)},
    ${sql(planet.type)}::"PlanetType", ${sql(planet.lifeState)}::"PlanetLifeState", 'family'::"Visibility",
    ${sql(planet.role)}, ${sql(planet.theme)}, ${sql(planet.summary)}, ${planet.position.x}, ${planet.position.y}, 1, ${now}, ${now}
  )`).join(",\n");
  const relationships = dataset.relationships.map((relationship) => `(
    ${sql(relationship.id)}, ${sql(scope.userId)}, ${sql(scope.galaxyId)}, ${sql(relationship.sourcePlanetId)}, ${sql(relationship.targetPlanetId)},
    ${sql(relationship.relationshipType)}::"PlanetRelationshipKind", ${sql(relationship.label)}, 'family'::"ContentVisibility", ${now}, 1, ${now}, ${now}
  )`).join(",\n");
  const memories = dataset.memories.map((memory) => `(
    ${sql(memory.id)}, ${sql(scope.userId)}, ${sql(scope.galaxyId)}, ${sql(memory.planetId)}, ${sql(memory.sourceText)}, ${sql(memory.title)},
    ${sql(memory.summary)}, ${json(memory.tags)}, '[]'::jsonb, ${sql(memory.occurredAtLabel)}, ${sql(memory.occurredAt)}::timestamp,
    ${sql(memory.locationLabel)}, ${json(memory.people)}, 'family'::"ContentVisibility", true, true, 'confirmed'::"MemoryStatus", ${now}, 1, ${now}, ${now}
  )`).join(",\n");
  const assets = dataset.assets.map((asset) => `(
    ${sql(asset.id)}, ${sql(scope.userId)}, ${sql(scope.galaxyId)}, ${sql(asset.planetId)}, ${asset.memoryId ? sql(asset.memoryId) : "NULL"},
    ${sql(asset.kind)}::"MemoryAssetKind", ${sql(asset.visibility)}::"ContentVisibility", ${sql(asset.storageKey)}, ${sql(asset.mimeType)}, ${asset.sizeBytes},
    ${sql(asset.sha256)}, ${sql(asset.originalName)}, ${asset.width}, ${asset.height}, ${sql(asset.thumbnailStorageKey)}, ${sql(asset.normalizedStorageKey)},
    'ready'::"AssetProcessingStatus", 1, ${now}, ${now}
  )`).join(",\n");
  const planetCovers = dataset.assets.filter((asset) => asset.kind === "planet_cover").map((asset) => `(
    ${sql(asset.planetId)}, ${sql(asset.id)}
  )`).join(",\n");
  const resonances = dataset.resonances.map((resonance) => `(
    ${sql(resonance.id)}, ${sql(scope.userId)}, ${sql(scope.galaxyId)}, ${sql(resonance.sourceMemoryId)}, ${sql(resonance.targetMemoryId)},
    ${resonance.score}, ${sql(resonance.reason)}, 'confirmed'::"ResonanceStatus", ${now}, 1, ${now}, ${now}
  )`).join(",\n");
  const book = dataset.book;
  const bookMemoryRows = dataset.memories.map((memory, index) => `(
    ${sql(stableId(`${scope.userId}:book-memory-${memory.id}`))}, ${sql(scope.userId)}, ${sql(scope.galaxyId)}, ${sql(book.id)}, ${sql(memory.id)},
    ${sql(`chapter-${Math.min(index, 2) + 1}`)}, ${index}, 1, ${now}, ${now}
  )`).join(",\n");
  const sharedSections = book.sections.map((section) => ({
    ...section,
    sourceLabels: section.sourceMemoryIds.map((memoryId) => dataset.memories.find((memory) => memory.id === memoryId)?.title ?? "已确认记忆"),
  }));

  return `
    BEGIN;
    ${scopeGuard}
    INSERT INTO "Planet" (
      "id", "galaxyId", "userId", "name", "type", "lifeState", "visibility", "role", "theme", "summary", "positionX", "positionY", "version", "createdAt", "updatedAt"
    ) VALUES ${planets}
    ON CONFLICT DO NOTHING;

    INSERT INTO "PlanetRelationship" (
      "id", "userId", "galaxyId", "sourcePlanetId", "targetPlanetId", "relationshipType", "label", "visibility", "confirmedAt", "version", "createdAt", "updatedAt"
    ) VALUES ${relationships}
    ON CONFLICT DO NOTHING;

    INSERT INTO "Memory" (
      "id", "userId", "galaxyId", "planetId", "sourceText", "title", "summary", "tags", "uncertainFields", "occurredAtLabel", "occurredAt", "locationLabel", "people", "visibility", "allowResonance", "allowBook", "status", "confirmedAt", "version", "createdAt", "updatedAt"
    ) VALUES ${memories}
    ON CONFLICT DO NOTHING;

    INSERT INTO "MemoryAsset" (
      "id", "userId", "galaxyId", "planetId", "memoryId", "kind", "visibility", "storageKey", "mimeType", "sizeBytes", "sha256", "originalName", "width", "height", "thumbnailStorageKey", "normalizedStorageKey", "status", "version", "createdAt", "updatedAt"
    ) VALUES ${assets}
    ON CONFLICT DO NOTHING;

    UPDATE "Planet" AS planet
    SET "coverAssetId" = cover."assetId", "updatedAt" = ${now}
    FROM (VALUES ${planetCovers}) AS cover("planetId", "assetId")
    WHERE planet."id" = cover."planetId"
      AND planet."userId" = ${sql(scope.userId)}
      AND planet."galaxyId" = ${sql(scope.galaxyId)}
      AND (planet."coverAssetId" IS NULL OR planet."coverAssetId" = cover."assetId");

    INSERT INTO "ResonanceCandidate" (
      "id", "userId", "galaxyId", "sourceMemoryId", "targetMemoryId", "score", "reason", "status", "confirmedAt", "version", "createdAt", "updatedAt"
    ) VALUES ${resonances}
    ON CONFLICT DO NOTHING;

    INSERT INTO "Book" (
      "id", "userId", "galaxyId", "title", "sourceRange", "themeTemplateKey", "draft", "body", "sections", "visibility", "status", "version", "createdAt", "updatedAt"
    ) VALUES (
      ${sql(book.id)}, ${sql(scope.userId)}, ${sql(scope.galaxyId)}, ${sql(book.title)}, 'family_galaxy', 'family_reunion',
      ${json(book.draft)}, ${sql(book.body)}, ${json(book.sections)}, 'family'::"ContentVisibility", 'ready'::"BookStatus", 1, ${now}, ${now}
    ) ON CONFLICT DO NOTHING;

    INSERT INTO "BookMemory" (
      "id", "userId", "galaxyId", "bookId", "memoryId", "chapterKey", "sortOrder", "version", "createdAt", "updatedAt"
    ) VALUES ${bookMemoryRows}
    ON CONFLICT DO NOTHING;

    INSERT INTO "SharedBook" (
      "id", "userId", "galaxyId", "bookId", "legacySnapshot", "token", "draft", "body", "sections", "share", "createdAt", "updatedAt"
    ) VALUES (
      ${sql(dataset.share.id)}, ${sql(scope.userId)}, ${sql(scope.galaxyId)}, ${sql(book.id)}, false, ${sql(dataset.share.token)},
      ${json(book.draft)}, ${sql(book.body)}, ${json(sharedSections)}, ${json({ showBody: true, showSourceTitles: true, showOriginalText: false })}, ${now}, ${now}
    ) ON CONFLICT DO NOTHING;
    COMMIT;
  `;
}

async function verifySeed(target: DatabaseTarget, scope: GalaxyScope, dataset: DemoDataset) {
  const ids = {
    imageAssets: dataset.assets.filter((asset) => asset.kind === "image").map((asset) => asset.id),
    planetCovers: dataset.assets.filter((asset) => asset.kind === "planet_cover").map((asset) => asset.id),
    planets: dataset.planets.map((item) => item.id),
    memories: dataset.memories.map((item) => item.id),
    resonances: dataset.resonances.map((item) => item.id),
  };
  const output = await runPsql(target, `
    SELECT json_build_object(
      'planets', (SELECT COUNT(*) FROM "Planet" WHERE "userId" = ${sql(scope.userId)} AND "galaxyId" = ${sql(scope.galaxyId)} AND "id" IN (${ids.planets.map(sql).join(", ")}) AND "deletedAt" IS NULL),
      'confirmedMemories', (SELECT COUNT(*) FROM "Memory" WHERE "userId" = ${sql(scope.userId)} AND "galaxyId" = ${sql(scope.galaxyId)} AND "id" IN (${ids.memories.map(sql).join(", ")}) AND "status" = 'confirmed' AND "deletedAt" IS NULL),
      'relationships', (SELECT COUNT(*) FROM "PlanetRelationship" WHERE "userId" = ${sql(scope.userId)} AND "galaxyId" = ${sql(scope.galaxyId)} AND "id" IN (${dataset.relationships.map((item) => sql(item.id)).join(", ")}) AND "deletedAt" IS NULL),
      'confirmedResonances', (SELECT COUNT(*) FROM "ResonanceCandidate" WHERE "userId" = ${sql(scope.userId)} AND "galaxyId" = ${sql(scope.galaxyId)} AND "id" IN (${ids.resonances.map(sql).join(", ")}) AND "status" = 'confirmed' AND "deletedAt" IS NULL),
      'readyBooks', (SELECT COUNT(*) FROM "Book" WHERE "userId" = ${sql(scope.userId)} AND "galaxyId" = ${sql(scope.galaxyId)} AND "id" = ${sql(dataset.book.id)} AND "status" = 'ready' AND "deletedAt" IS NULL),
      'activeShares', (SELECT COUNT(*) FROM "SharedBook" WHERE "userId" = ${sql(scope.userId)} AND "galaxyId" = ${sql(scope.galaxyId)} AND "bookId" = ${sql(dataset.book.id)} AND "token" = ${sql(dataset.share.token)} AND "revokedAt" IS NULL),
      'imageAssets', (SELECT COUNT(*) FROM "MemoryAsset" WHERE "userId" = ${sql(scope.userId)} AND "galaxyId" = ${sql(scope.galaxyId)} AND "id" IN (${ids.imageAssets.map(sql).join(", ")}) AND "kind" = 'image' AND "visibility" = 'family' AND "memoryId" IS NOT NULL AND "status" = 'ready' AND "deletedAt" IS NULL),
      'planetCovers', (
        SELECT COUNT(*)
        FROM "Planet" AS planet
        JOIN "MemoryAsset" AS asset ON asset."id" = planet."coverAssetId" AND asset."userId" = planet."userId" AND asset."galaxyId" = planet."galaxyId"
        WHERE planet."userId" = ${sql(scope.userId)}
          AND planet."galaxyId" = ${sql(scope.galaxyId)}
          AND asset."id" IN (${ids.planetCovers.map(sql).join(", ")})
          AND asset."kind" = 'planet_cover'
          AND asset."visibility" = 'private'
          AND asset."status" = 'ready'
          AND asset."deletedAt" IS NULL
          AND planet."deletedAt" IS NULL
      )
    )::text;
  `);
  const result = JSON.parse(output.trim()) as Record<string, number>;
  const expected = { planets: 4, confirmedMemories: 8, relationships: 4, confirmedResonances: 3, readyBooks: 1, activeShares: 1, imageAssets: 4, planetCovers: 4 };

  for (const [key, value] of Object.entries(expected)) {
    if (result[key] !== value) throw new Error(`演示数据写入后校验失败：${key} 应为 ${value}，实际为 ${result[key]}。`);
  }

  return result;
}

function sql(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function json(value: unknown) {
  return `${sql(JSON.stringify(value))}::jsonb`;
}

async function runPsql(target: DatabaseTarget, input: string) {
  const result = await runCommand("docker", [
    "exec", "-i", target.container,
    "psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1",
    "-U", target.user, "-d", target.database,
  ], input);
  return result.stdout;
}

function runCommand(command: string, args: string[], input?: string) {
  return new Promise<{ stderr: string; stdout: string }>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "pipe" });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} ${args[0] ?? ""} 执行失败（退出码 ${code}）：${stderr.trim()}`));
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
