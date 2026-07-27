# Legacy Memory Light Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace galaxy quick-record Mock/localStorage behavior with a real text-memory draft, consented AI job, review and confirmation cycle that belongs to one persisted family planet.

**Architecture:** The browser keeps only unsubmitted input and the current review UI. `POST /api/memories` creates a draft, `POST /api/memories/:id/ai-jobs` records consent, the worker turns it into `needs_confirmation`, and only `POST /api/memories/:id/confirm` allows a memory star to glow. `getHomeData` rehydrates confirmed memory stars after refresh.

**Tech Stack:** Next.js App Router, React, TypeScript, Prisma, Docker Compose worker, Vitest and Testing Library.

---

### Task 1: Build the persisted-memory browser adapter

**Files:**
- Create: `src/features/galaxy/legacy-memory-api.ts`
- Test: `src/features/galaxy/legacy-memory-api.test.ts`

- [ ] **Step 1: Write the failing request-contract tests**

```ts
await createTextMemory({ planetId: "planet-1", sourceText: "除夕一起吃饭", visibility: "family" });
expect(fetchMock).toHaveBeenCalledWith("/api/memories", expect.objectContaining({
  method: "POST", headers: expect.objectContaining({ "Idempotency-Key": expect.any(String) }),
}));
await startMemoryExtraction("memory-1");
expect(fetchMock).toHaveBeenCalledWith("/api/memories/memory-1/ai-jobs", expect.objectContaining({
  body: JSON.stringify({ consent: true, purpose: "memory_extraction" }),
}));
```

- [ ] **Step 2: Run the adapter tests to observe RED**

Run: `corepack pnpm vitest run src/features/galaxy/legacy-memory-api.test.ts`

Expected: FAIL because no dedicated persisted-memory adapter exists.

- [ ] **Step 3: Implement only the authenticated API calls**

```ts
export async function createTextMemory(input: CreateTextMemoryInput): Promise<MemoryDraft> { /* POST /api/memories */ }
export async function startMemoryExtraction(memoryId: string): Promise<AiJob> { /* POST consent-bound job */ }
export async function getAiJob(jobId: string): Promise<AiJob> { /* GET job */ }
export async function getMemoryReview(memoryId: string): Promise<MemoryReview> { /* GET review */ }
export async function confirmMemory(input: ConfirmMemoryInput): Promise<ConfirmedMemory> { /* POST versioned confirm */ }
```

- [ ] **Step 4: Re-run adapter tests to observe GREEN**

Run: `corepack pnpm vitest run src/features/galaxy/legacy-memory-api.test.ts`

Expected: PASS, including error-body propagation.

### Task 2: Give quick-record a real target, AI review and explicit confirmation

**Files:**
- Modify: `src/features/galaxy/galaxy-workspace.tsx`
- Test: `src/features/galaxy/galaxy-workspace.test.tsx`

- [ ] **Step 1: Write the failing selected-planet interaction test**

```tsx
await openQuickRecordFor("server-mom");
await submitText("新家里的第一个除夕");
expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/memories", expect.objectContaining({ method: "POST" }));
expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/memories/memory-1/ai-jobs", expect.objectContaining({ method: "POST" }));
expect(await screen.findByRole("button", { name: "确认点亮记忆星" })).toBeEnabled();
```

- [ ] **Step 2: Run the focused test to observe RED**

Run: `corepack pnpm vitest run src/features/galaxy/galaxy-workspace.test.tsx`

Expected: FAIL because `lightMemoryStar` calls `/api/ai/extract` and writes localStorage.

- [ ] **Step 3: Implement the minimal real state machine**

```text
select persisted Planet -> create draft -> start consented job
-> poll queued/processing -> fetch needs_confirmation review
-> render editable review fields -> explicit confirm
```

The generic entry falls back only to the administrator's persisted self planet. AI failure keeps the real draft and exposes retry. No Mock response or automatic confirmation is allowed.

- [ ] **Step 4: Light a star only after confirmation**

```ts
const confirmed = await confirmMemory({ memoryId: review.id, version: review.version, title, summary });
setConfirmedMemoryStars((stars) => [...stars, toMemoryStar(confirmed)]);
```

No `writeGalaxyExtractResult`, `appendLitMemory`, or business `localStorage` write remains in this path.

- [ ] **Step 5: Verify success, AI failure and confirmation-only illumination**

Run: `corepack pnpm vitest run src/features/galaxy/galaxy-workspace.test.tsx`

Expected: PASS for selected planet ID, explicit consent, job result, error recovery and confirmation.

### Task 3: Rehydrate confirmed stars from the server after refresh

**Files:**
- Modify: `src/server/db/galaxy-repo.ts`
- Modify: `src/server/services/home.service.ts`
- Modify: `src/app/galaxy/page.tsx`
- Modify: `src/features/galaxy/galaxy-workspace.tsx`
- Test: `src/server/services/home.service.test.ts`
- Test: `src/app/galaxy/page.test.tsx`

- [ ] **Step 1: Write the failing read-model test**

```ts
expect(await getHomeData("user-1", deps)).toMatchObject({
  confirmedMemories: [{ id: "memory-1", planetId: "planet-1", title: "除夕合照" }],
});
```

- [ ] **Step 2: Run it to observe RED**

Run: `corepack pnpm vitest run src/server/services/home.service.test.ts src/app/galaxy/page.test.tsx`

Expected: FAIL because the existing projection only aggregates memory counts.

- [ ] **Step 3: Project only confirmed display fields**

```ts
confirmedMemories: memories.filter((memory) => memory.status === "confirmed").map((memory) => ({
  id: memory.id, planetId: memory.planetId, title: memory.title ?? "未命名记忆",
  summary: memory.summary ?? "", occurredAtLabel: memory.occurredAtLabel,
}))
```

Never project source text, raw assets, drafts or AI job data onto the galaxy page.

- [ ] **Step 4: Pass the projection into `GalaxyWorkspace`**

`initialConfirmedMemories` initializes the real star list. Local storage remains allowed only for unsubmitted input and view preferences.

- [ ] **Step 5: Verify the rehydration slice**

Run: `corepack pnpm vitest run src/server/services/home.service.test.ts src/app/galaxy/page.test.tsx src/features/galaxy/galaxy-workspace.test.tsx`

Expected: PASS; reload has no dependency on browser business storage.

### Task 4: Verify and commit this text-memory slice

**Files:**
- Modify: files from Tasks 1-3 only

- [ ] **Step 1: Validate worker Compose configuration**

Run: `docker compose --env-file .env.docker config --quiet`

Expected: exit code 0 and worker has the same database and AI environment as app.

- [ ] **Step 2: Run full verification**

Run: `corepack pnpm lint; corepack pnpm test; corepack pnpm build`

Expected: each command exits 0.

- [ ] **Step 3: Commit the slice**

Run: `git add src/features/galaxy src/server/db/galaxy-repo.ts src/server/services/home.service.ts src/app/galaxy/page.tsx; git commit -m "feat: persist legacy text memory flow"`

Expected: one focused commit with the memory flow and its tests.
