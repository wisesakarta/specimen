# Refactor Roadmap — Specimen OS
### Operational Engineering Blueprint
### Revision 2.0 — 2026-05-09

---

## Execution Principles

Every refactor in this document must satisfy at least one:
- **Reduce blast radius** — isolate failure domains
- **Improve locality** — understand a subsystem without reading the God component
- **Improve determinism** — eliminate non-deterministic state transitions
- **Reinforce sovereignty** — harden shell/citizen contract boundaries

No refactor may:
- Alter Win95 material identity
- Introduce abstraction without measurable complexity reduction
- Modify working sovereign runtime behavior

---

## Phase 0: Dead Code Elimination

**Risk:** None | **Complexity:** Trivial | **Blast Radius:** None

| Action | File | Detail |
|---|---|---|
| Remove `Win95ElasticGrid` | `Win95ElasticGrid.tsx` | Returns `null`. All hooks execute for nothing. |
| Remove `GridContext` / `GridProvider` | `context/GridContext.tsx` | Only consumer is the dead ElasticGrid. |
| Remove `GridProvider` from layout | `layout.tsx` L17, L24 | Wraps entire app for a dead component. |
| Remove `Lenis` smooth scroll | `page.tsx` L47-68 | No scrolling occurs in a fixed-viewport OS. |
| Remove `INITIAL_WINDOWS` export | `os-config.ts` L292 | Exported empty array, never imported. |
| Remove `theme` state | `page.tsx` L37, L40-44 | Loaded from localStorage, never applied. |
| Remove unused `SmartFormState` fields | `page.tsx` L10-13 | `outputFolder`, `source` never read. |

**Verification:** `npx tsc --noEmit` must pass. No visual change.

---

## Phase 1: Persistence Deduplication

**Risk:** High | **Complexity:** Low | **Blast Radius:** Medium (session restore)

**Problem:** Two separate `useEffect` blocks load snapshots (lines 164-190 and 246-276). Two separate `useEffect` blocks save snapshots (lines 192-219 and 280-308). Restoration logic differs between them.

**Action:**
1. Extract `useSessionPersistence(windows, vfs, recents, mounted)` hook
2. Single `loadSnapshot()` call on mount, single `saveSnapshot()` debounced effect
3. Eliminate `restoreWindow()` standalone function — fold into hook
4. Remove duplicate snapshot effects from `Win95Desktop`

**Extraction target:** `src/hooks/useSessionPersistence.ts`

**Contract:**
```typescript
function useSessionPersistence(deps: {
  windows: WindowState[];
  vfs: VFSNode[];
  recents: PersistedRecent[];
  mounted: boolean;
}): {
  initialWindows: WindowState[];
  initialRecents: PersistedRecent[];
  initialVfs: VFSNode[];
}
```

---

## Phase 2: Window Manager Extraction

**Risk:** Medium | **Complexity:** Medium | **Blast Radius:** High (all windows)

**Problem:** 7 window management functions are defined inline in Win95Desktop, each accessing and mutating the same `windows[]` state with overlapping logic.

**Action:**
1. Extract `useWindowManager()` hook containing:
   - `windows`, `activeWindowId` state
   - `openWindow`, `closeWindow`, `minimizeWindow`, `toggleMinimize`, `toggleMaximize`, `focusWindow`
   - `updateRecents`
2. Z-index scheduling stays inside this hook (it is inseparable from focus logic)
3. Fix the `focusWindow` normalization bug: after `normalizeZIndexes` calls `setWindows`, the subsequent `setWindows` on line 446 overwrites it. Use functional updater: `setWindows(prev => ...)`.

**Extraction target:** `src/hooks/useWindowManager.ts`

**Contract:**
```typescript
function useWindowManager(opts: { onRecentsChange: (r: PersistedRecent[]) => void }): {
  windows: WindowState[];
  activeWindowId: string | null;
  openWindow: (id: string, type: AppType, title: string, icon: string, data?: any) => void;
  closeWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  toggleMinimize: (id: string) => void;
  toggleMaximize: (id: string) => void;
  focusWindow: (id: string) => void;
  updateWindowState: (id: string, patch: Partial<WindowState>) => void;
}
```

---

## Phase 3: Specimen Bridge Unification

**Risk:** Medium | **Complexity:** Low | **Blast Radius:** Medium (taskbar, focus)

**Problem:** Specimen Analyzer uses parallel governance (`isSpecimenMinimized`, `specimenZIndex`) instead of being a member of `windows[]`. This doubles the code path in `focusWindow`, `minimizeWindow`, and `toggleMinimize`.

**Action:**
1. When Specimen opens, insert it into `windows[]` with `id: SPECIMEN_ID, type: "SPECIMEN"`
2. Remove `isSpecimenMinimized` and `specimenZIndex` state variables
3. Remove all `if (id === SPECIMEN_ID)` branches from window management functions
4. Render Specimen content via the standard managed-citizen render path
5. Remove `Children.map`/`cloneElement` injection (lines 739-747)

**Result:** Specimen becomes a standard citizen. All window management functions lose their special-case branches.

---

## Phase 4: Managed App Dispatch Registry

**Risk:** Low | **Complexity:** Low | **Blast Radius:** Low

**Problem:** Adding a new managed application requires modifying the render body of `Win95Desktop` with inline conditional rendering (lines 675-707).

**Action:**
1. Create `src/lib/app-registry.ts` with a `ManagedAppRegistry` map:
```typescript
const MANAGED_REGISTRY: Record<AppType, React.ComponentType<ManagedAppProps>> = {
  EXPLORER: Explorer,
  BROWSER: WebBrowser,
  // Future: add here without touching Win95Desktop
};
```
2. Replace inline dispatch in Win95Desktop with:
```typescript
const AppComponent = MANAGED_REGISTRY[win.type];
if (AppComponent) return <AppComponent {...props} />;
```
3. Sovereign dispatch already exists via `SovereignRuntimeHost` — no change needed.

---

## Phase 5: Win95Window Bevel Canonicalization

**Risk:** Low | **Complexity:** Trivial | **Blast Radius:** Low

**Problem:** `Win95Window.tsx` lines 139-144 inline a 4-layer box-shadow instead of using `--bevel-raised`.

**Action:**
1. Replace inline `boxShadow` in `Win95Window` with `boxShadow: "var(--bevel-raised)"`
2. Verify visual parity
3. Audit all other inline shadow definitions against `globals.css` tokens

---

## Phase 6: Hardcoded Value Token Migration

**Risk:** Low | **Complexity:** Low | **Blast Radius:** Wide (many files)

**Action:**
1. Define `--win-taskbar-height: 28px` in `globals.css`
2. Replace `calc(100% - 28px)` in `Win95Desktop` L669 with `calc(100% - var(--win-taskbar-height))`
3. Replace `bottom: 28` in `Win95AnalysisDashboard` L55
4. Replace hardcoded hex colors in `Win95Notification` icon components with tokens
5. Replace `"#c0c0c0"` in `JSPaintApp` L85 with `var(--win-face)`
6. Replace Start Menu gradient hex values with token references

---

## Phase 7: Canonical Menu Primitive

**Risk:** Low | **Complexity:** Medium | **Blast Radius:** Medium (3 files)

**Problem:** Menu dropdowns are implemented three different ways across `Win95Window`, `Win95AnalysisDashboard`, and `Notepad`.

**Action:**
1. Create `src/components/ui/Win95Menu.tsx` with:
   - `Win95MenuBar` (already exists in Win95Window — extract and enhance)
   - `Win95MenuDropdown` (trigger + positioned dropdown)
   - `Win95MenuAction` (clickable item with optional shortcut display)
   - `Win95MenuSeparator`
2. Refactor Notepad to use canonical menu components
3. Remove local `MenuBtn` from `Win95AnalysisDashboard`
4. Remove `<style jsx>` block from Notepad

---

## Phase 8: `WindowState` Type Hardening

**Risk:** Medium | **Complexity:** Medium | **Blast Radius:** Wide

**Problem:** `data?: any`, `playback?: AudioPlaybackState`, and `activity?: RuntimeActivityState` on `WindowState` violate type safety and sovereignty boundaries.

**Action:**
1. Replace `data?: any` with `data?: unknown` and enforce typed access at consumption points
2. Move `playback` and `activity` into a separate `Map<string, RuntimeEmission>` managed by the window manager hook, not stored inline on `WindowState`
3. Taskbar reads from the emissions map, not from window state
4. Persistence serializes emissions separately

---

## Phase 9: Animation Timing Normalization

**Risk:** Low | **Complexity:** Low | **Blast Radius:** Low | **Materiality Risk:** Medium

**Action (per materiality audit findings):**

| Component | Current | Target | Rationale |
|---|---|---|---|
| `Win95Window` open | 150ms, scale 0.995→1 | 0ms opacity, no scale | Win95 windows appear instantly |
| `Win95BootSequence` | 3s easeInOut fade | Mechanical step transitions | Boot should feel procedural, not smooth |
| Start Menu | 100ms opacity+y | 0ms instant appear | Win95 Start Menu has no animation |
| `MonacoEditor` status dot | 4s pulse | Static indicator or remove | Win95 has no pulsing indicators |
| `JSPaintApp` visibility | 300ms filter transition | Instant display toggle | Sovereign apps must not animate visibility |
| `Win95AnalysisDashboard` | 150ms slide-in | Instant appear | Win95 windows do not slide |

---

## Execution Order

```
Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 5 → Phase 6 → Phase 4 → Phase 7 → Phase 8 → Phase 9
```

**Rationale:** Dead code removal first (risk-free). Persistence deduplication second (reduces cognitive load for Phase 2). Window manager extraction third (largest structural improvement). Specimen unification fourth (depends on extracted window manager). Bevel and token fixes are independent and low-risk. App dispatch registry, menu primitive, and type hardening can follow in any order. Animation normalization last (materiality changes require visual verification).

**Gate:** `npx tsc --noEmit` must pass after every phase. No phase may begin until the previous phase's gate clears.
