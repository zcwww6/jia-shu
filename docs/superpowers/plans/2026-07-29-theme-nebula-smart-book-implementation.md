# 主题星云与智能家书 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Make theme nebulae distinct family-story curator spaces, turn approved document memories into editable illustrated books, and repair the planet-cover experience without weakening privacy or immersion.

**Architecture:** Keep GalaxyWorkspace as orchestration owner, extract presentational theme data and curator scene into focused galaxy modules, and reuse the existing /api/memories, /api/assets and /api/books services. Extend the reader’s existing Framer Motion implementation rather than adding a page-flip dependency. Seed assets through protected storage so the production media path itself proves the demo.

**Tech Stack:** Next.js 16, React 19, TypeScript, Framer Motion, Vitest, Prisma/PostgreSQL, Sharp, Mammoth, PDF.js, Docker Compose.

---

## File structure

- Create: \`src/features/galaxy/theme-nebula-data.ts\` — the four themes’ story, palette, source hints and book-range mapping.
- Create: \`src/features/galaxy/theme-nebula-curator.tsx\` — scene-local selected theme, memory chips and explicit actions.
- Test: \`src/features/galaxy/theme-nebula-curator.test.tsx\`.
- Modify: \`src/features/galaxy/galaxy-workspace.tsx\` — orchestration, confirmation return and direct book generation from opted-in memories.
- Modify: \`src/features/galaxy/planet-theme-studio.tsx\` — reliable ref-backed file picker.
- Modify: \`src/features/books/family-book-reader.tsx\` and \`.module.css\` — page labels, motion and keyboard support.
- Modify: \`src/server/media/asset-validation.ts\` — server/client AVIF capability alignment.
- Modify: \`scripts/seed-legacy-demo-data.ts\` plus its test — protected demo image assets and covers.

### Task 1: Define the regression contract

**Files:**
- Modify: \`src/features/galaxy/galaxy-workspace.test.tsx\`
- Modify: \`src/features/galaxy/legacy-memory-flow.test.tsx\`
- Modify: \`src/features/books/family-book-reader.test.tsx\`

- [ ] **Step 1: Write the theme no-auto-navigation test**

~~~tsx
fireEvent.click(screen.getByRole("button", { name: "亲子成长" }));
expect(screen.getByRole("heading", { name: "亲子成长星云" })).toBeInTheDocument();
expect(screen.queryByRole("heading", { name: /把写好的家书/ })).not.toBeInTheDocument();
expect(screen.getByRole("button", { name: "开始装订亲子成长家书" })).toBeEnabled();
~~~

- [ ] **Step 2: Lock the document type and confirmation return**

~~~tsx
expect(screen.getByLabelText("上传文件")).toHaveAttribute("accept", ".pdf,.docx,.txt,.md");
fireEvent.click(screen.getByRole("button", { name: "确认点亮记忆星" }));
await waitFor(() => expect(screen.getByText("已加入当前主题的装订清单")).toBeInTheDocument());
~~~

- [ ] **Step 3: Replace reader labels in its current test**

~~~tsx
expect(screen.getByRole("button", { name: "上一页" })).toBeDisabled();
fireEvent.click(screen.getByRole("button", { name: "下一页" }));
await waitFor(() => expect(screen.getByTestId("visible-family-book-spread")).toHaveAttribute("data-spread-index", "1"));
~~~

- [ ] **Step 4: Prove each new test fails**

Run: \`pnpm vitest run src/features/galaxy/galaxy-workspace.test.tsx src/features/galaxy/legacy-memory-flow.test.tsx src/features/books/family-book-reader.test.tsx\`

Expected: missing curator controls, old document accept value and old page controls fail.

- [ ] **Step 5: Commit the contract**

~~~bash
git add src/features/galaxy/galaxy-workspace.test.tsx src/features/galaxy/legacy-memory-flow.test.tsx src/features/books/family-book-reader.test.tsx
git commit -m "test: define curator and reader interactions"
~~~

### Task 2: Implement data-driven curator scenes

**Files:**
- Create: \`src/features/galaxy/theme-nebula-data.ts\`
- Create: \`src/features/galaxy/theme-nebula-curator.tsx\`
- Create: \`src/features/galaxy/theme-nebula-curator.test.tsx\`
- Modify: \`src/app/globals.css\`

- [ ] **Step 1: Add the four strongly typed narratives**

~~~ts
export type ThemeNebula = {
  key: string;
  title: string;
  promise: string;
  sourceHints: [string, string, string];
  intelligentNote: string;
  sourceRange: "single_planet" | "family_galaxy" | "memorial";
};

export const themeNebulae: ThemeNebula[] = [{
  key: "亲子成长",
  title: "亲子成长星云",
  promise: "把每一次长大，留成未来也能认出的光。",
  sourceHints: ["第一次与里程碑", "成长照片", "写给未来的话"],
  intelligentNote: "智能编排会先寻找时间线，再把家人的不同视角并排放进书里。",
  sourceRange: "single_planet",
}, /* 父母人生、纪念星册、旅行星云 */];
~~~

- [ ] **Step 2: Build semantically labelled selection and action controls**

~~~tsx
<button aria-pressed={selectedTheme === theme.key} onClick={() => onSelectTheme(theme.key)} type="button">
  <span>{theme.title}</span><small>{theme.promise}</small>
</button>
<button aria-label="上传一份家庭文档" onClick={onUploadDocument} type="button">上传一份家庭文档</button>
<button aria-label={\`开始装订\${selectedTheme}家书\`} disabled={selectedMemoryIds.length === 0} onClick={onStartBinding} type="button">
  开始装订家书
</button>
~~~

- [ ] **Step 3: Test selection and memory-chip callbacks**

~~~tsx
fireEvent.click(screen.getByRole("button", { name: "父母人生" }));
expect(screen.getByText("年轻时的 TA、成家、工作、没说出口的话。")).toBeVisible();
fireEvent.click(screen.getByRole("checkbox", { name: "装订来源：雨夜送学" }));
expect(onSourceIdsChange).toHaveBeenLastCalledWith(["memory-1"]);
~~~

- [ ] **Step 4: Add spatial, responsive and reduced-motion styles**

~~~css
.theme-curator { min-height: min(72dvh, 760px); }
.theme-curator-card:focus-visible { outline: 3px solid #ffe0a0; outline-offset: 4px; }
@media (prefers-reduced-motion: reduce) { .theme-curator-orbit { animation: none; } }
~~~

- [ ] **Step 5: Run and commit**

Run: \`pnpm vitest run src/features/galaxy/theme-nebula-curator.test.tsx\`
Expected: PASS.

~~~bash
git add src/features/galaxy/theme-nebula-data.ts src/features/galaxy/theme-nebula-curator.tsx src/features/galaxy/theme-nebula-curator.test.tsx src/app/globals.css
git commit -m "feat: add narrative theme nebula curator"
~~~

### Task 3: Connect curator sources to real services

**Files:**
- Modify: \`src/features/galaxy/galaxy-workspace.tsx\`
- Modify: \`src/features/galaxy/galaxy-workspace.test.tsx\`
- Modify: \`src/features/galaxy/legacy-memory-flow.test.tsx\`

- [ ] **Step 1: Replace direct workshop switching**

~~~ts
function selectThemeFromNebula(theme: string) {
  setSelectedTheme(theme);
  setToast(\`已展开「\${theme}」的策展台\`);
}
~~~

- [ ] **Step 2: Add client-scoped curated source state and post-confirm return**

~~~ts
const [curatedMemoryIds, setCuratedMemoryIds] = useState<string[]>([]);
setCuratedMemoryIds((ids) => [...new Set([...ids, confirmed.id])]);
setActiveZone("themes");
setToast("记忆已确认，并加入当前主题的装订清单");
~~~

- [ ] **Step 3: Refactor generation to accept explicit approved source IDs**

~~~ts
async function generateLegacyBook(sourceMemoryIds: string[], sourceRange: LegacyBookSourceRange) {
  const input = {
    sourceMemoryIds,
    sourceRange,
    themeTemplateKey: themeTemplateKeyByLabel[selectedTheme] ?? selectedTheme,
    visibility: bookVisibility,
  };
  return createLegacyBook(input, bookGenerationRequestKey(JSON.stringify(input)));
}
~~~

- [ ] **Step 4: Preserve resonance as a source-selection shortcut**

~~~tsx
<ThemeNebulaCurator
  selectedMemoryIds={curatedMemoryIds}
  onUseResonanceSources={() => setCuratedMemoryIds(confirmedBookSources.map((source) => source.id))}
/>
~~~

- [ ] **Step 5: Replace all user-visible feature labels**

~~~tsx
<p>智能整理只会提出候选，故事是否成立仍由家人确认。</p>
<button type="button">发送给智能整理</button>
~~~

- [ ] **Step 6: Run and commit**

Run: \`pnpm vitest run src/features/galaxy/galaxy-workspace.test.tsx src/features/galaxy/legacy-memory-flow.test.tsx src/features/galaxy/galaxy-workspace.book-persistence.test.tsx\`
Expected: PASS, including book creation from a confirmed opted-in document memory.

~~~bash
git add src/features/galaxy/galaxy-workspace.tsx src/features/galaxy/galaxy-workspace.test.tsx src/features/galaxy/legacy-memory-flow.test.tsx
git commit -m "feat: bind confirmed theme memories into real books"
~~~

### Task 4: Repair the cover picker and align formats

**Files:**
- Modify: \`src/features/galaxy/planet-theme-studio.tsx\`
- Create: \`src/features/galaxy/planet-theme-studio.test.tsx\`
- Modify: \`src/server/media/asset-validation.ts\`
- Modify: \`src/server/media/asset-validation.test.ts\`

- [ ] **Step 1: Write an explicit picker invocation test**

~~~tsx
fireEvent.click(screen.getByRole("button", { name: "给星球贴一张照片" }));
expect(fileInput.click).toHaveBeenCalledTimes(1);
~~~

- [ ] **Step 2: Use a ref-backed button rather than a clipped-label transfer**

~~~tsx
const coverInputRef = useRef<HTMLInputElement>(null);
<button aria-label="给星球贴一张照片" className="workshop-upload-trigger" onClick={() => coverInputRef.current?.click()} type="button">...</button>
<input accept="image/jpeg,image/png,image/webp,image/avif" aria-label="上传星球封面" className="sr-only" onChange={onFileChange} ref={coverInputRef} type="file" />
~~~

- [ ] **Step 3: Align AVIF validation**

~~~ts
const SUPPORTED_MIME_TYPES = new Set([..., "image/avif"]);
const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
~~~

- [ ] **Step 4: Run and commit**

Run: \`pnpm vitest run src/features/galaxy/planet-theme-studio.test.tsx src/features/galaxy/galaxy-workspace.test.tsx src/server/media/asset-validation.test.ts\`
Expected: PASS.

~~~bash
git add src/features/galaxy/planet-theme-studio.tsx src/features/galaxy/planet-theme-studio.test.tsx src/server/media/asset-validation.ts src/server/media/asset-validation.test.ts
git commit -m "fix: make planet cover selection reliable"
~~~

### Task 5: Add directional accessible page turns

**Files:**
- Modify: \`src/features/books/family-book-reader.tsx\`
- Modify: \`src/features/books/family-book-reader.module.css\`
- Modify: \`src/features/books/family-book-reader.test.tsx\`

- [ ] **Step 1: Track direction and reduced motion**

~~~tsx
const reduceMotion = useReducedMotion();
const [turnDirection, setTurnDirection] = useState<"forward" | "backward">("forward");
function turnTo(next: number) {
  setTurnDirection(next > activeSpread ? "forward" : "backward");
  setActiveSpread(next);
}
~~~

- [ ] **Step 2: Add direction-aware Motion variants**

~~~tsx
const enter = reduceMotion ? { opacity: 0 } : { opacity: 0, x: turnDirection === "forward" ? 34 : -34, rotateY: turnDirection === "forward" ? 12 : -12 };
const exit = reduceMotion ? { opacity: 0 } : { opacity: 0, x: turnDirection === "forward" ? -34 : 34, rotateY: turnDirection === "forward" ? -12 : 12 };
<motion.div animate={{ opacity: 1, x: 0, rotateY: 0 }} exit={exit} initial={enter} transition={{ duration: reduceMotion ? 0.16 : 0.34 }} />
~~~

- [ ] **Step 3: Provide page labels and keyboard interaction**

~~~tsx
<article aria-label="家书纪念册预览" aria-roledescription="可翻页家书" onKeyDown={onReaderKeyDown} tabIndex={0}>
  <button aria-label="上一页" disabled={activeSpread === 0} onClick={() => turnTo(activeSpread - 1)} type="button">上一页</button>
  <span aria-live="polite">第 {activeSpread + 1} / {spreadCount} 页</span>
  <button aria-label="下一页" disabled={activeSpread === spreadCount - 1} onClick={() => turnTo(activeSpread + 1)} type="button">下一页</button>
</article>
~~~

- [ ] **Step 4: Test keyboard path, then run and commit**

~~~tsx
fireEvent.keyDown(screen.getByRole("article", { name: "家书纪念册预览" }), { key: "ArrowRight" });
await waitFor(() => expect(screen.getByText("第 2 / 3 页")).toBeInTheDocument());
~~~

Run: \`pnpm vitest run src/features/books/family-book-reader.test.tsx\`
Expected: PASS.

~~~bash
git add src/features/books/family-book-reader.tsx src/features/books/family-book-reader.module.css src/features/books/family-book-reader.test.tsx
git commit -m "feat: add directional family-book page turns"
~~~

### Task 6: Seed protected image-backed demonstration data

**Files:**
- Create: \`scripts/demo-media/kitchen-light.webp\`
- Create: \`scripts/demo-media/rainy-drive.webp\`
- Create: \`scripts/demo-media/starlight-drawing.webp\`
- Create: \`scripts/demo-media/osmanthus-recipe.webp\`
- Modify: \`scripts/seed-legacy-demo-data.ts\`
- Modify: \`scripts/seed-legacy-demo-data.test.ts\`

- [ ] **Step 1: Add deterministic media metadata**

~~~ts
const demoMedia = [{
  file: "kitchen-light.webp",
  memoryKey: "memory-kitchen-light",
  planetKey: "mom",
  caption: "厨房的灯为晚归的人留着。",
  width: 1600,
  height: 1200,
}];
~~~

- [ ] **Step 2: Copy to protected storage and write scoped image rows**

~~~ts
await runCommand("docker", ["cp", localFile, \`\${target.appContainer}:\${storagePath}\`]);
INSERT INTO "MemoryAsset" (...) VALUES (..., 'image'::"AssetKind", 'image/webp', ...);
UPDATE "Planet" SET "coverAssetId" = assetId WHERE "id" = planetId AND "userId" = userId;
~~~

- [ ] **Step 3: Verify idempotent result counts**

~~~ts
const expected = { planets: 4, confirmedMemories: 8, imageAssets: 4, planetCovers: 4, readyBooks: 1 };
~~~

- [ ] **Step 4: Run and commit**

Run: \`pnpm vitest run scripts/seed-legacy-demo-data.test.ts && pnpm tsx scripts/seed-legacy-demo-data.ts --dry-run\`
Expected: PASS and dry-run JSON includes imageAssets.

~~~bash
git add scripts/demo-media scripts/seed-legacy-demo-data.ts scripts/seed-legacy-demo-data.test.ts
git commit -m "feat: seed illustrated family galaxy demo"
~~~

### Task 7: Full verification and delivery

**Files:**
- Modify only failing regression tests from Tasks 1–6.

- [ ] **Step 1: Run the focused suite**

Run: \`pnpm vitest run src/features/galaxy/theme-nebula-curator.test.tsx src/features/galaxy/galaxy-workspace.test.tsx src/features/galaxy/legacy-memory-flow.test.tsx src/features/books/family-book-reader.test.tsx src/server/media/asset-validation.test.ts scripts/seed-legacy-demo-data.test.ts\`
Expected: PASS.

- [ ] **Step 2: Run quality gates**

Run: \`pnpm lint && pnpm test && pnpm build\`
Expected: all commands exit 0.

- [ ] **Step 3: Rebuild and seed Docker**

Run: \`docker compose up -d --build && pnpm tsx scripts/seed-legacy-demo-data.ts\`
Expected: services healthy and seed JSON verifies image assets and covers.

- [ ] **Step 4: Browser acceptance while logged in**

Check: four distinct curator states; no automatic theme-to-book navigation; document selection; confirmation before binding; real book generation; picture pages; page-keyboard behavior; cover preview/save; mobile width and reduced motion.

- [ ] **Step 5: Deliver cleanly**

~~~bash
git add src scripts docs/superpowers
git commit -m "feat: complete theme curator and illustrated smart books"
git status --short
git push origin develop
~~~
