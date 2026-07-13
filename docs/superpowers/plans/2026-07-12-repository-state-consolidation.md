# Repository State Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the approved demo additions, establish one authoritative current-state document, remove obsolete Vercel/KV guidance, and safely retire fully merged Git branches, worktrees, and stashes.

**Architecture:** Make two behavior-preserving application changes under TDD, then consolidate documentation around `产品开发文档/当前项目状态.md`. Treat Git cleanup as a gated maintenance phase after content audit, full verification, review, and integration so no user work is deleted before it has a committed destination.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, Testing Library, Prisma 7, Docker Compose, Git, PowerShell.

---

## File map

- Modify `src/shared/mock/galaxy-data.test.ts`: protect referential integrity and the approved inheritance/growth demo fixtures.
- Modify `src/shared/mock/galaxy-data.ts`: add five memories, two resonance tracks, and one book draft.
- Modify `src/features/galaxy/galaxy-loop-stitch.test.tsx`: prove a newly lit memory appears in the main galaxy, not only the memory zone.
- Modify `src/features/galaxy/galaxy-workspace.tsx`: render runtime-lit memories in the main galaxy scene.
- Create `产品开发文档/当前项目状态.md`: single authoritative project-state document.
- Modify `README.md`: point to the authoritative state document, remove stale branch wording, and keep deployment/operation content only.
- Modify `产品开发文档/2026-07-04-当前进展快照.md`: mark as a historical snapshot and link the authoritative document.
- Modify `产品开发文档/2026-07-04-部署与数据库方案.md`: add the authoritative state link to the existing superseded banner.
- Modify `docs/superpowers/specs/2026-07-12-local-docker-deployment-design.md`: mark infrastructure implementation complete while keeping real Resend acceptance pending.
- Do not add `产品开发文档/当前develop可演示能力清单.md`; migrate its still-valid demo route into `当前项目状态.md`.
- Do not modify `.env.docker`, `.env.local`, `.env.example`, `src/server/store/shared-books.ts`, or any secret value.

### Task 1: Audit every uncommitted and stashed change

**Files:**
- Inspect only: root worktree, `stash@{0}`, merged branches, and registered worktrees
- Do not modify or commit files in this task

- [ ] **Step 1: Capture the root worktree inventory**

Run from `D:\work\jiashu`:

```powershell
git status --short
git diff --stat
git diff -- README.md src/features/galaxy/galaxy-workspace.tsx src/shared/mock/galaxy-data.ts
```

Expected: the root worktree contains the approved demo additions, the stale README Vercel/KV block, and the untracked `产品开发文档/当前develop可演示能力清单.md`.

- [ ] **Step 2: Inspect the stash relative to its own base**

Run:

```powershell
git show --stat --oneline 'stash@{0}'
git diff 'stash@{0}^1' 'stash@{0}' -- .env.example README.md src/features/galaxy/galaxy-workspace.tsx src/server/store/shared-books.ts src/shared/mock/galaxy-data.ts
git ls-tree -r --name-only 'stash@{0}^3'
```

Expected:

- useful unique content is limited to the approved demo fixtures and main-galaxy runtime light rendering;
- `.env.example`, README, and `src/server/store/shared-books.ts` contain the superseded KV/Vercel/local-JSON path;
- the untracked stash parent contains `产品开发文档/当前develop可演示能力清单.md`;
- no secret-bearing `.env.docker` or `.env.local` file appears.

- [ ] **Step 3: Prove the old feature branches are merged**

Run:

```powershell
git branch --merged develop
git rev-list --count develop..feature/bootstrap-next-app
git rev-list --count develop..feature/launch-foundation-phase1-auth-persistence
git rev-list --count develop..feature/prototype-parity-ui
git worktree list --porcelain
```

Expected: all three counts are `0`; the launch-foundation branch still owns its registered worktree.

- [ ] **Step 4: Record the audit decision in the task notes**

Record exactly this decision in the execution report, not in a repository file:

```text
KEEP: five demo memories, two demo resonances, one demo book, runtime-lit main-galaxy buttons, accurate OpenAI Mock fallback wording, current demo route.
DROP: Vercel recommendation, KV_REST variables, Upstash storage path, local JSON primary storage, cloud/RDS current-direction wording, duplicate capability-list document.
DEFER: Resend credentials/E2E, domain persistence, GalaxyWorkspace refactor.
```

Expected: no files changed and no Git references deleted.

### Task 2: Add referentially complete demo fixtures with TDD

**Files:**
- Modify: `src/shared/mock/galaxy-data.test.ts`
- Modify: `src/shared/mock/galaxy-data.ts`

- [ ] **Step 1: Write the failing fixture-integrity test**

Append this test inside the existing `describe("galaxy mock data", ...)` block in `src/shared/mock/galaxy-data.test.ts`:

```typescript
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

    expect(expectedMemoryIds.every((memoryId) => memoryIds.has(memoryId))).toBe(true);
    expect(memoryStars.every((memory) => planetIds.has(memory.planetId))).toBe(true);

    const inheritanceTrack = resonanceTracks.find(
      (track) => track.id === "resonance-2008-kitchen",
    );
    const growthTrack = resonanceTracks.find(
      (track) => track.id === "resonance-2022-child-stage",
    );
    const inheritanceBook = bookDrafts.find(
      (draft) => draft.id === "book-2008-inheritance",
    );

    expect(inheritanceTrack?.sourceMemoryIds.every((id) => memoryIds.has(id))).toBe(true);
    expect(growthTrack?.sourceMemoryIds.every((id) => memoryIds.has(id))).toBe(true);
    expect(inheritanceBook?.sourceMemoryIds.every((id) => memoryIds.has(id))).toBe(true);
  });
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx pnpm vitest run src/shared/mock/galaxy-data.test.ts
```

Expected: FAIL because the expected memory, resonance, and book IDs are absent.

- [ ] **Step 3: Add the five memory fixtures**

Insert these objects at the end of `memoryStars` in `src/shared/mock/galaxy-data.ts`:

```typescript
  {
    id: "memory-1998-mom",
    planetId: "mock-mom",
    title: "第一次抱着我回家",
    occurredAt: "1998 年冬天",
    location: "老家小院",
    people: ["妈妈", "我", "外婆"],
    emotions: ["紧张", "温柔", "责任感"],
    visibility: "family",
    summary: "妈妈一直记得那天雪很薄，外婆把门口的风挡了又挡。",
  },
  {
    id: "memory-2008-grandma",
    planetId: "mock-grandma",
    title: "外婆的年夜菜谱",
    occurredAt: "2008 年除夕前夜",
    location: "老家厨房",
    people: ["外婆", "妈妈", "我"],
    emotions: ["忙碌", "熟悉", "传承"],
    visibility: "family",
    summary: "外婆一边教妈妈调馅，一边说做饭也是把家留住的办法。",
  },
  {
    id: "memory-2008-mom-kitchen",
    planetId: "mock-mom",
    title: "跟着外婆学包饺子",
    occurredAt: "2008 年除夕前夜",
    location: "老家厨房",
    people: ["妈妈", "外婆", "我"],
    emotions: ["怀念", "专注", "亲近"],
    visibility: "family",
    summary: "妈妈说那晚外婆只教了一次，她后来每年都照着做。",
  },
  {
    id: "memory-2022-child",
    planetId: "mock-child",
    title: "第一次上台念诗",
    occurredAt: "2022 年夏天",
    location: "幼儿园礼堂",
    people: ["孩子", "我", "妈妈"],
    emotions: ["紧张", "骄傲", "发光"],
    visibility: "family",
    summary: "孩子抓着话筒停顿了一秒，还是把最后一句完整念了出来。",
  },
  {
    id: "memory-2022-me-child",
    planetId: "mock-me",
    title: "孩子抬头找我们的那一秒",
    occurredAt: "2022 年夏天",
    location: "幼儿园礼堂",
    people: ["孩子", "我", "妈妈"],
    emotions: ["心疼", "欣慰", "骄傲"],
    visibility: "family",
    summary: "他念到一半抬头看我们，我们一起点头，那一下像在给他递勇气。",
  },
```

- [ ] **Step 4: Add the two resonance fixtures**

Insert these objects at the end of `resonanceTracks`:

```typescript
  {
    id: "resonance-2008-kitchen",
    title: "外婆菜谱传承共鸣",
    sourceMemoryIds: ["memory-2008-grandma", "memory-2008-mom-kitchen"],
    score: 0.89,
    status: "candidate",
    reason: "同一晚的厨房记忆在两颗星球中形成了明确传承关系，适合生成纪念与传承页。",
  },
  {
    id: "resonance-2022-child-stage",
    title: "成长舞台共鸣候选",
    sourceMemoryIds: ["memory-2022-child", "memory-2022-me-child"],
    score: 0.86,
    status: "candidate",
    reason: "同一成长瞬间被孩子与家长分别记住，适合生成亲子成长页。",
  },
```

- [ ] **Step 5: Add the inheritance book fixture**

Insert this object at the end of `bookDrafts`:

```typescript
  {
    id: "book-2008-inheritance",
    title: "外婆留在厨房里的光",
    sourceRange: "memorial",
    themeTemplateKey: "parent_story",
    sourceMemoryIds: ["memory-2008-grandma", "memory-2008-mom-kitchen"],
    intro: "这页家书不只写一道菜谱，而是写一代人如何把家的味道和做法留给下一代。",
    chapters: [
      {
        title: "那晚的老家厨房",
        sourceMemoryIds: ["memory-2008-grandma", "memory-2008-mom-kitchen"],
      },
      {
        title: "外婆如何教，妈妈如何记住",
        sourceMemoryIds: ["memory-2008-mom-kitchen"],
      },
    ],
  },
```

- [ ] **Step 6: Run the focused test and verify GREEN**

Run:

```powershell
npx pnpm vitest run src/shared/mock/galaxy-data.test.ts
```

Expected: 1 test file and 3 tests pass.

- [ ] **Step 7: Commit the fixture batch**

```powershell
git add src/shared/mock/galaxy-data.test.ts src/shared/mock/galaxy-data.ts
git diff --cached --check
if ($LASTEXITCODE -ne 0) { throw 'Fixture batch diff-check failed.' }
git commit -m "feat: enrich galaxy demo fixtures"
```

### Task 3: Render newly lit memories in the main galaxy with TDD

**Files:**
- Modify: `src/features/galaxy/galaxy-loop-stitch.test.tsx`
- Modify: `src/features/galaxy/galaxy-workspace.tsx`

- [ ] **Step 1: Extend the loop test with the missing main-galaxy assertion**

In the test named `在星系内点亮记忆时调用 /api/ai/extract 并渲染真实抽取结果`, add this block after the existing assertion for `缝合测试记忆星` and before the localStorage assertions:

```typescript
    fireEvent.click(screen.getByRole("button", { name: "我的星系" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "新点亮：缝合测试记忆星" }),
      ).toBeInTheDocument();
    });
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx pnpm vitest run src/features/galaxy/galaxy-loop-stitch.test.tsx
```

Expected: FAIL because the main galaxy scene does not render a button named `新点亮：缝合测试记忆星`.

- [ ] **Step 3: Add the minimal main-galaxy rendering**

In the final/main-galaxy branch of `ZoneScene`, immediately after the `planets.map(...)` block and before the fixed Spring Festival memory, add:

```tsx
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
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```powershell
npx pnpm vitest run src/features/galaxy/galaxy-loop-stitch.test.tsx src/features/galaxy/galaxy-workspace.test.tsx
```

Expected: both files pass; the existing React `act(...)` warning may remain unchanged, but no new warning or error is introduced.

- [ ] **Step 5: Commit the runtime-light batch**

```powershell
git add src/features/galaxy/galaxy-loop-stitch.test.tsx src/features/galaxy/galaxy-workspace.tsx
git diff --cached --check
if ($LASTEXITCODE -ne 0) { throw 'Runtime-light batch diff-check failed.' }
git commit -m "feat: show lit memories in main galaxy"
```

### Task 4: Establish the authoritative project-state document

**Files:**
- Create: `产品开发文档/当前项目状态.md`
- Modify: `README.md`
- Modify: `产品开发文档/2026-07-04-当前进展快照.md`
- Modify: `产品开发文档/2026-07-04-部署与数据库方案.md`
- Modify: `docs/superpowers/specs/2026-07-12-local-docker-deployment-design.md`
- Verify absent: `产品开发文档/当前develop可演示能力清单.md`

- [ ] **Step 1: Create the authoritative document**

Create `产品开发文档/当前项目状态.md` with this structure and facts:

```markdown
# 家书星球当前项目状态

**更新时间**：2026-07-12

**权威性**：本文档是家书星球当前工程、部署、产品能力与后续工作的唯一现状入口。README 负责运行和运维说明；带日期的旧进展文档只作为历史快照。

## 1. 主线与分支

- `develop`：当前集成主线，本地与 `origin/develop` 同步后开展本阶段工作。
- `main`、`master`、`test`：仍位于早期发布基线，尚未接收当前 MVP。
- 已完全合并的旧 `feature/*` 分支在本阶段验证完成后清理。

## 2. 当前部署

- 完全本地 Docker Compose：Nginx、Next.js standalone App、一次性 Prisma Migration、PostgreSQL。
- Nginx 是唯一宿主机入口，只绑定 `127.0.0.1:80`；App 和 PostgreSQL 不发布宿主机端口。
- PostgreSQL 使用 named volume；备份写入宿主机 `backups`，README 提供校验和恢复流程。
- OpenAI 可选联网，未配置时回落 Mock；Resend 仍用于 Magic Link 邮件并需要联网。
- 当前部署不使用云服务器、云 RDS、Vercel KV 或本地 JSON 主存储，也不支持 LAN/TLS。

## 3. 已完成工程能力

- Next.js 16 App Router、TypeScript、React 19。
- Auth.js + Resend 登录入口和受保护路由。
- Prisma 7 + PostgreSQL，包含用户、星系、星球、分享和认证相关模型。
- Prisma baseline migration、既有数据库采纳门禁、升级、备份和恢复手册。
- `/api/health/live` 与 `/api/health/ready`。
- 非 root App/Migration 镜像、有限日志、内部后端网络和 loopback-only Nginx。

## 4. 当前可演示路径

1. 访问 `/galaxy` 并浏览家庭星系与星球。
2. 点亮一句家庭记忆，调用 `/api/ai/extract` 并生成记忆星。
3. 进入共鸣星轨并确认候选连接。
4. 在家书工坊生成草稿。
5. 完成分享前确认并发布 `/share/[token]`。
6. 在另一浏览器打开分享页，检查正文与来源信息的展示边界。

## 5. 真实、Mock 与外部服务边界

### 真实工程路径

- Auth.js 路由保护和登录流程。
- PostgreSQL/Prisma 用户、星系和分享主存储。
- 登录用户发布家书和公开 token 分享页面。
- Docker 启动、迁移、健康检查、持久化、备份和恢复。

### Mock/演示路径

- 大部分星系初始内容、家庭成员、记忆、共鸣和家书样例。
- 共鸣扫描仍以规则和演示逻辑为主，未接向量检索。
- 星系内记忆、共鸣、家书闭环仍混合 localStorage、前端状态和 API 演示路径。
- 图片和语音尚未产品化。

### 外部服务

- OpenAI：可选；未配置时应用仍可演示。
- Resend：真实 Magic Link 必需；缺少有效凭证时不能完成真实登录验收。

## 6. 最近验证

- Prisma Client 生成成功。
- 22 个测试文件、75 项测试通过。
- lint 和 Next.js 生产构建通过。
- Compose 配置有效；PostgreSQL、App、Nginx healthy。
- live、ready 和首页返回 200。
- 空卷迁移、迁移幂等、命名卷持久化和真实备份恢复演练已通过。

## 7. 当前阻塞与技术债

- 缺少可用的 Resend API Key、已验证发件人和收件邮箱，真实 Magic Link 与认证态发布/分享验收待完成。
- `galaxy-workspace.tsx` 体积过大，UI、状态和演示流程耦合。
- memory、resonance、book 尚未完全迁移到数据库与服务层。
- 测试中已有 React `act(...)` 警告需要在后续重构时消除。

## 8. 下一步顺序

1. 配置真实 Resend 凭证，完成登录、发布和跨浏览器分享验收。
2. 将记忆、共鸣、家书流程逐步迁移到数据库和服务层。
3. 在行为测试保护下拆分 `galaxy-workspace.tsx`。
4. 验收稳定后将 `develop` 推进到 `test`，再决定正式发布分支。

## 9. 关联文档

- 运行与运维：[`README.md`](../README.md)
- 当前本地 Docker 设计：[`docs/superpowers/specs/2026-07-12-local-docker-deployment-design.md`](../docs/superpowers/specs/2026-07-12-local-docker-deployment-design.md)
- 历史进展快照：[`2026-07-04-当前进展快照.md`](./2026-07-04-当前进展快照.md)
- 已替代的云部署方案：[`2026-07-04-部署与数据库方案.md`](./2026-07-04-部署与数据库方案.md)
```

- [ ] **Step 2: Make README operational and point to the authority**

In `README.md`:

1. Replace `当前工程化首阶段分支：feature/bootstrap-next-app。` with:

```markdown
当前集成主线为 `develop`。项目能力、真实/Mock 边界和后续顺序以 [`产品开发文档/当前项目状态.md`](产品开发文档/当前项目状态.md) 为准。
```

2. Replace the final technology bullet with:

```markdown
- PostgreSQL + Prisma 持久化；支持按需接入真实 OpenAI，未启用时回落 Mock
```

3. Do not add any `Vercel`, `KV_REST`, `Upstash`, or local-JSON-primary section.

- [ ] **Step 3: Mark the dated progress snapshot historical**

Immediately after the title in `产品开发文档/2026-07-04-当前进展快照.md`, add:

```markdown
> **历史快照：已被替代。** 本文记录 2026-07-04 当时的工程状态，不是当前操作或规划依据。当前状态统一见 [`当前项目状态.md`](./当前项目状态.md)。
```

Do not rewrite its historical body.

- [ ] **Step 4: Strengthen the superseded deployment banner**

Replace the existing banner in `产品开发文档/2026-07-04-部署与数据库方案.md` with:

```markdown
> **历史方案：已被替代。** 自 2026-07-12 起，部署方案已改为完全本地 Docker Compose，不再使用云服务器或 RDS。当前项目事实见 [`当前项目状态.md`](./当前项目状态.md)，当前部署设计见 [`docs/superpowers/specs/2026-07-12-local-docker-deployment-design.md`](../docs/superpowers/specs/2026-07-12-local-docker-deployment-design.md)；本文仅作为历史记录保留。
```

- [ ] **Step 5: Update Docker design status**

In `docs/superpowers/specs/2026-07-12-local-docker-deployment-design.md`, replace:

```markdown
**状态**：已批准，实施中
```

with:

```markdown
**状态**：基础设施实施完成；真实 Resend 登录与认证态业务验收待办
```

- [ ] **Step 6: Verify the duplicate capability list remains absent**

Run:

```powershell
if (Test-Path '产品开发文档\当前develop可演示能力清单.md') {
  throw 'Duplicate capability list must not be committed.'
}
```

Expected: no output and exit code 0.

- [ ] **Step 7: Check current-document consistency**

Run:

```powershell
$currentFiles = @('README.md', '产品开发文档\当前项目状态.md', 'docs\superpowers\specs\2026-07-12-local-docker-deployment-design.md')
$forbidden = '推荐部署到\s*\*\*Vercel|KV_REST_API|Upstash|本地 \.local-data/shared-books\.json|国内云厂商云服务器.*当前|云 RDS.*当前'
$matches = Select-String -Path $currentFiles -Pattern $forbidden
# “不再把云服务器或云 RDS 描述为当前部署方向”是否定旧方案，不是把旧方案当作当前部署建议。
$actionableMatches = @($matches | Where-Object {
  $_.Line -notmatch '不再把云服务器或云 RDS 描述为当前部署方向'
})
if ($actionableMatches.Count -gt 0) { $actionableMatches | Format-Table; throw 'Current documentation contains superseded deployment guidance.' }

$historyBanner = Select-String -Path '产品开发文档\2026-07-04-当前进展快照.md' -Pattern '历史快照：已被替代'
$dockerStatus = Select-String -Path 'docs\superpowers\specs\2026-07-12-local-docker-deployment-design.md' -Pattern '基础设施实施完成；真实 Resend 登录与认证态业务验收待办'
if (-not $historyBanner -or -not $dockerStatus) { throw 'Historical or Docker status marker is missing.' }
```

Expected: no forbidden matches and exit code 0.

- [ ] **Step 8: Commit the documentation batch**

```powershell
git add README.md '产品开发文档/当前项目状态.md' '产品开发文档/2026-07-04-当前进展快照.md' '产品开发文档/2026-07-04-部署与数据库方案.md'
git add -f 'docs/superpowers/specs/2026-07-12-local-docker-deployment-design.md'
git diff --cached --check
if ($LASTEXITCODE -ne 0) { throw 'Documentation batch diff-check failed.' }
git commit -m "docs: establish authoritative project status"
```

### Task 5: Run full verification and final content audit

**Files:**
- Verify all files changed by Tasks 2-4
- Do not change Git references until every check passes

- [ ] **Step 1: Verify generated client and application quality**

Run sequentially:

```powershell
npx pnpm prisma generate
if ($LASTEXITCODE -ne 0) { throw 'Prisma generate failed.' }
npx pnpm test
if ($LASTEXITCODE -ne 0) { throw 'Tests failed.' }
npx pnpm lint
if ($LASTEXITCODE -ne 0) { throw 'Lint failed.' }
npx pnpm build
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
```

Expected: Prisma generation passes; 22 test files and 75 tests pass; lint and build pass. Record actual counts if they differ because an additional legitimate test was added.

- [ ] **Step 2: Verify Compose and live services**

The isolated worktree does not contain the ignored secret file. Use the root worktree's existing `.env.docker` without copying it into Git:

```powershell
docker compose --env-file 'D:\work\jiashu\.env.docker' config --quiet
if ($LASTEXITCODE -ne 0) { throw 'Compose config failed.' }

docker compose --env-file 'D:\work\jiashu\.env.docker' -p jiashu ps
if ($LASTEXITCODE -ne 0) { throw 'Compose status failed.' }

$live = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1/api/health/live'
$ready = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1/api/health/ready'
$root = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1/'
if ($live.StatusCode -ne 200 -or $ready.StatusCode -ne 200 -or $root.StatusCode -ne 200) {
  throw 'One or more health endpoints failed.'
}
```

Expected: PostgreSQL, App, and Nginx are healthy; all three HTTP responses are 200.

- [ ] **Step 3: Compare the committed destination with root work and stash**

Run from `D:\work\jiashu`:

```powershell
git diff docs/repository-state-consolidation -- src/shared/mock/galaxy-data.ts src/features/galaxy/galaxy-workspace.tsx
git diff 'stash@{0}^1' 'stash@{0}' -- src/shared/mock/galaxy-data.ts src/features/galaxy/galaxy-workspace.tsx
git diff 'stash@{0}^1' 'stash@{0}' -- .env.example README.md src/server/store/shared-books.ts
```

Expected:

- the implementation branch contains the approved demo fixtures and main-galaxy rendering;
- stash-only `.env.example`, README, and shared-book changes are the rejected KV/Vercel/local-JSON path;
- no valid content lacks a committed destination.

- [ ] **Step 4: Run final repository checks**

Run from the implementation worktree:

```powershell
git diff --check develop...HEAD
if ($LASTEXITCODE -ne 0) { throw 'Final diff-check failed.' }
git status --short
git log --oneline develop..HEAD
```

Expected: diff-check passes, worktree is clean, and the branch contains the design commit plus the fixture, main-galaxy, and documentation commits.

- [ ] **Step 5: Request final spec and quality review**

Review against:

- `docs/superpowers/specs/2026-07-12-repository-state-consolidation-design.md`;
- no Critical or Important findings;
- explicit confirmation that stash content is fully accounted for and no current document revives the old deployment strategy.

Expected: approved before integration or Git cleanup.

### Task 6: Integrate, then clean merged Git references and stashes

**Files and state:**
- Root worktree: `D:\work\jiashu`
- Feature worktree: `D:\work\jiashu\.worktrees\repository-state-consolidation`
- Branch to integrate: `docs/repository-state-consolidation`
- This task runs only after Task 5 passes and the branch-finishing workflow selects local merge or an equivalent approved integration path.

- [ ] **Step 1: Preserve the root worktree one final time**

Run from `D:\work\jiashu`:

```powershell
git stash push --include-untracked -m 'pre-repository-consolidation-root-safety-copy'
if ($LASTEXITCODE -ne 0) { throw 'Unable to preserve the root worktree.' }
git stash list --format='%gd %H %s'
```

Expected: exactly two relevant safety stashes are visible: the new root safety copy and `codex-preserve-user-work-before-local-docker-merge`.

- [ ] **Step 2: Update and integrate develop safely**

```powershell
git fetch origin
if ($LASTEXITCODE -ne 0) { throw 'Fetch failed.' }
$syncCounts = (git rev-list --left-right --count origin/develop...develop).Trim() -split '\s+'
if ($syncCounts.Count -ne 2 -or $syncCounts[0] -ne '0' -or $syncCounts[1] -ne '0') {
  throw "Local and remote develop diverged before integration: $($syncCounts -join ' ')"
}
```

Expected before merge: `0 0`. If remote is ahead, stop and integrate its commits before continuing.

Then run:

```powershell
git merge --no-ff docs/repository-state-consolidation -m 'merge: consolidate repository state'
if ($LASTEXITCODE -ne 0) { throw 'Local integration failed.' }
npx pnpm prisma generate
if ($LASTEXITCODE -ne 0) { throw 'Merged Prisma generate failed.' }
npx pnpm exec vitest run --exclude '.worktrees/**'
if ($LASTEXITCODE -ne 0) { throw 'Merged tests failed.' }
```

Expected: merge succeeds and 22 files / 75 tests pass in the root tree.

- [ ] **Step 3: Re-audit both safety stashes before deletion**

```powershell
$stashes = git stash list --format='%gd`t%H`t%s'
$stashes
if (($stashes | Measure-Object).Count -ne 2) { throw 'Unexpected stash count; do not delete any stash.' }
git diff 'stash@{0}^1' 'stash@{0}' -- README.md src/features/galaxy/galaxy-workspace.tsx src/shared/mock/galaxy-data.ts
git ls-tree -r --name-only 'stash@{0}^3'
git diff 'stash@{1}^1' 'stash@{1}' -- .env.example README.md src/features/galaxy/galaxy-workspace.tsx src/server/store/shared-books.ts src/shared/mock/galaxy-data.ts
```

Expected: all approved demo content now exists in `develop`; remaining stash-only content is duplicate or explicitly rejected. If any unique valid content appears, stop without dropping either stash.

- [ ] **Step 4: Drop only the two audited stashes**

```powershell
git stash drop 'stash@{0}'
if ($LASTEXITCODE -ne 0) { throw 'Failed to drop root safety stash.' }
git stash drop 'stash@{0}'
if ($LASTEXITCODE -ne 0) { throw 'Failed to drop legacy safety stash.' }
if (git stash list) { throw 'Unexpected stash remains.' }
```

Expected: stash list is empty.

- [ ] **Step 5: Remove the old launch worktree with path safety checks**

Run:

```powershell
$registered = git worktree list --porcelain
if ($registered -notmatch [regex]::Escape('D:/work/jiashu/.worktrees/launch-foundation-phase1-auth-persistence')) {
  throw 'Expected old worktree is not registered at the approved path.'
}
git worktree remove 'D:\work\jiashu\.worktrees\launch-foundation-phase1-auth-persistence'
if ($LASTEXITCODE -ne 0) { throw 'Old launch worktree removal failed; do not force-delete an unverified path.' }
```

Expected: old launch worktree registration and directory are removed. If Windows reports an in-use path, record it and stop physical cleanup; do not delete outside `.worktrees`.

- [ ] **Step 6: Remove the previously unregistered Docker-worktree residue if unlocked**

The old local-Docker worktree is no longer registered, but Windows previously left `.next` and `node_modules` behind. Remove only that verified residue:

```powershell
$worktreeRoot = (Resolve-Path -LiteralPath 'D:\work\jiashu\.worktrees').Path
$residualPath = 'D:\work\jiashu\.worktrees\local-docker-deployment-design'
$registered = git worktree list --porcelain
if ($registered -match [regex]::Escape('local-docker-deployment-design')) {
  throw 'Residual path is unexpectedly registered as a worktree; do not delete it as cache.'
}

if (Test-Path -LiteralPath $residualPath) {
  $resolved = (Resolve-Path -LiteralPath $residualPath).Path
  $prefix = $worktreeRoot.TrimEnd('\') + '\'
  if (-not $resolved.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Residual path is outside the approved worktree root: $resolved"
  }

  $children = @(Get-ChildItem -Force -LiteralPath $resolved | Select-Object -ExpandProperty Name)
  $unexpected = @($children | Where-Object { $_ -notin @('.next', 'node_modules') })
  if ($unexpected.Count -gt 0) {
    throw "Residual path contains unexpected entries: $($unexpected -join ', ')"
  }

  try {
    Remove-Item -LiteralPath ('\\?\' + $resolved) -Recurse -Force -ErrorAction Stop
  } catch {
    Write-Warning "Windows still holds the verified cache directory: $resolved"
  }
}
```

Expected: the residual cache directory is deleted. If an external process still holds it, the exact verified path is reported and no other directory is touched.

- [ ] **Step 7: Delete only fully merged local branches**

```powershell
$branches = @(
  'feature/bootstrap-next-app',
  'feature/launch-foundation-phase1-auth-persistence',
  'feature/prototype-parity-ui'
)
foreach ($branch in $branches) {
  $uniqueCount = [int](git rev-list --count "develop..$branch")
  if ($uniqueCount -ne 0) { throw "$branch has $uniqueCount unmerged commits; refusing deletion." }
  git branch -d $branch
  if ($LASTEXITCODE -ne 0) { throw "Failed to delete $branch." }
}
```

Expected: all three local branches are deleted without force.

- [ ] **Step 8: Delete the merged remote bootstrap branch**

```powershell
git fetch origin
$remoteUniqueCount = [int](git rev-list --count 'origin/develop..origin/feature/bootstrap-next-app')
if ($remoteUniqueCount -ne 0) { throw 'Remote bootstrap branch has unmerged commits; refusing deletion.' }
git push origin --delete feature/bootstrap-next-app
if ($LASTEXITCODE -ne 0) { throw 'Remote feature branch deletion failed.' }
```

Expected: `origin/feature/bootstrap-next-app` is deleted; `origin/develop`, `origin/main`, `origin/master`, and `origin/test` remain.

- [ ] **Step 9: Push the integrated develop and verify final state**

```powershell
git push origin develop
if ($LASTEXITCODE -ne 0) { throw 'Develop push failed.' }
git fetch origin --prune
if ($LASTEXITCODE -ne 0) { throw 'Final fetch failed.' }

$head = git rev-parse HEAD
$remote = git rev-parse origin/develop
if ($head -ne $remote) { throw 'Local and remote develop are not synchronized.' }

git branch -vv
git branch -r
git worktree list
git stash list
git status --short
```

Expected:

- local and remote `develop` resolve to the same commit;
- only `develop`, `main`, `master`, and `test` remain as retained long-lived local branches, plus the temporary implementation branch until its finishing workflow removes it;
- no old remote feature branch remains;
- stash list is empty;
- root worktree is clean;
- the implementation worktree/branch is cleaned by `finishing-a-development-branch` after merged-result verification.
