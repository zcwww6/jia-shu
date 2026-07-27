# Legacy Planet Settings Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the old v7.3 star-ring management actions persist to the authenticated Planet record without replacing the immersive roaming UI.

**Architecture:** `GalaxyWorkspace` maps the legacy visual `Planet` to the authenticated Planet PATCH API. The client replaces its planet only after a successful server response, retaining the server-returned version for optimistic concurrency. Link-kind filters stay local because they are a view preference; name, theme, visibility and life state are business state and must persist.

**Tech Stack:** Next.js App Router, React, TypeScript, Prisma, Zod, Vitest and Testing Library.

---

### Task 1: Protect the authenticated Planet PATCH adapter

**Files:**
- Modify: `src/features/galaxy/legacy-galaxy-api.ts`
- Test: `src/features/galaxy/legacy-galaxy-api.test.ts`

- [ ] **Step 1: Write the failing adapter test**

```ts
it("sends a versioned theme update", async () => {
  await updateLegacyPlanet({ id: "planet-1", version: 2, theme: "旅行星云" });
  expect(fetchMock).toHaveBeenCalledWith("/api/planets/planet-1", expect.objectContaining({
    method: "PATCH",
    headers: expect.objectContaining({ "If-Match-Version": "2" }),
    body: JSON.stringify({ version: 2, theme: "旅行星云" }),
  }));
});
```

- [ ] **Step 2: Run the test and observe the expected RED result**

Run: `corepack pnpm vitest run src/features/galaxy/legacy-galaxy-api.test.ts`

Expected: FAIL until the version header and exact PATCH payload exist.

- [ ] **Step 3: Keep the adapter minimal**

```ts
export function updateLegacyPlanet(input: LegacyPlanetUpdate) {
  const { id, version, ...changes } = input;
  return requestJson<LegacyManagedPlanet>(`/api/planets/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "If-Match-Version": String(version) },
    body: JSON.stringify({ version, ...changes }),
  });
}
```

- [ ] **Step 4: Run the adapter test and observe GREEN**

Run: `corepack pnpm vitest run src/features/galaxy/legacy-galaxy-api.test.ts`

Expected: PASS.

### Task 2: Implement one server-confirmed workspace update path

**Files:**
- Modify: `src/features/galaxy/galaxy-workspace.tsx`
- Test: `src/features/galaxy/galaxy-workspace.test.tsx`

- [ ] **Step 1: Write the failing success and rejection tests**

```tsx
it("updates the visible theme only after the API returns a new version", async () => {
  render(<GalaxyWorkspace initialPlanets={[persistedMom]} />);
  await saveTheme("旅行星云");
  expect(fetchMock).toHaveBeenCalledWith("/api/planets/server-mom", expect.any(Object));
  expect(screen.getByText("旅行星云")).toBeInTheDocument();
});

it("keeps the existing theme if the API rejects the update", async () => {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ message: "版本已更新" }), { status: 409 }));
  render(<GalaxyWorkspace initialPlanets={[persistedMom]} />);
  await saveTheme("旅行星云");
  expect(screen.getByText("暖橘星环")).toBeInTheDocument();
  expect(screen.getByText("版本已更新")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused workspace test and observe RED**

Run: `corepack pnpm vitest run src/features/galaxy/galaxy-workspace.test.tsx`

Expected: FAIL because current handlers only open contextual panels.

- [ ] **Step 3: Add the shared response-mapping helper**

```ts
async function persistPlanetChange(planet: Planet, changes: Omit<LegacyPlanetUpdate, "id" | "version">) {
  if (planet.version === undefined) {
    setToast("演示星球不能保存设置；请先创建真实家人星球");
    return null;
  }
  const saved = await updateLegacyPlanet({ id: planet.id, version: planet.version, ...changes });
  const visual = toVisualPlanet(saved, planet);
  setGalaxyPlanets((items) => items.map((item) => item.id === visual.id ? visual : item));
  return visual;
}
```

- [ ] **Step 4: Use the helper for each persisted star-ring action**

```tsx
<button onClick={() => void onSaveTheme("旅行星云")} type="button">保存到这颗星球</button>
<button onClick={() => void onSetVisibility("family")} type="button">家庭可见</button>
<button onClick={() => void onSetLifeState("memorial")} type="button">设为纪念星</button>
```

The rename dialog must submit `{ name }`; theme submits `{ theme }`; visibility submits `{ visibility }`; lifecycle submits `{ lifeState }`. Every handler displays an API error and never pre-emptively mutates the planet.

- [ ] **Step 5: Run focused tests and observe GREEN**

Run: `corepack pnpm vitest run src/features/galaxy/galaxy-workspace.test.tsx`

Expected: PASS for success, version replacement and failure rollback.

### Task 3: Explicitly keep star-map filters view-only

**Files:**
- Modify: `src/features/galaxy/galaxy-workspace.test.tsx`
- Modify: `src/features/galaxy/galaxy-workspace.tsx`

- [ ] **Step 1: Write the failing no-network test**

```tsx
it("filters displayed links without persisting a link-kind preference", () => {
  render(<GalaxyWorkspace initialLinks={[familyLink]} />);
  fireEvent.click(screen.getByRole("button", { name: "家庭线" }));
  expect(screen.queryByTestId("planet-link-family-1")).not.toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the test and observe RED if a data mutation occurs**

Run: `corepack pnpm vitest run src/features/galaxy/galaxy-workspace.test.tsx`

Expected: FAIL only if the view filter triggers persistence or fails to hide its link.

- [ ] **Step 3: Keep the current local filter reducer**

```ts
setVisibleLinkKinds((current) => current.includes(kind)
  ? current.filter((item) => item !== kind)
  : [...current, kind]);
```

- [ ] **Step 4: Re-run the focused test and observe GREEN**

Run: `corepack pnpm vitest run src/features/galaxy/galaxy-workspace.test.tsx`

Expected: PASS with no request.

### Task 4: Verify and commit one coherent batch

**Files:**
- Modify: `src/features/galaxy/galaxy-workspace.tsx`
- Modify: `src/features/galaxy/galaxy-workspace.test.tsx`
- Modify: `src/features/galaxy/legacy-galaxy-api.ts`
- Modify: `src/features/galaxy/legacy-galaxy-api.test.ts`

- [ ] **Step 1: Run lint, full tests and build**

Run: `corepack pnpm lint; corepack pnpm test; corepack pnpm build`

Expected: each command exits 0.

- [ ] **Step 2: Commit only the plan and this implementation batch**

```powershell
git add docs/superpowers/plans/2026-07-28-legacy-planet-settings-persistence.md src/features/galaxy/galaxy-workspace.tsx src/features/galaxy/galaxy-workspace.test.tsx src/features/galaxy/legacy-galaxy-api.ts src/features/galaxy/legacy-galaxy-api.test.ts
git commit -m "feat: persist legacy planet settings"
```
