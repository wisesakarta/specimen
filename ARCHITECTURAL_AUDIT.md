# Architectural Audit — Specimen OS
### Deep Systems Engineering Decomposition
### Revision 2.0 — 2026-05-09

---

## 1. God Component Decomposition: `Win95Desktop.tsx`

**File:** `src/components/ui/Win95Desktop.tsx` (1040 lines, 40.7 KB)

This component is the single largest architectural risk in the system. It concentrates seven distinct subsystem responsibilities into one render function, creating an architectural gravity well that prevents isolated reasoning about any single concern.

### 1.1 Responsibility Inventory

| Responsibility | Lines (approx) | State Variables Owned | Functions Owned |
|---|---|---|---|
| VFS State | 143, 170-179, 523-524 | `vfs` | `updateNodeInTree`, `setVfs` |
| Window Lifecycle | 326-460 | `windows`, `activeWindowId` | `openWindow`, `closeWindow`, `minimizeWindow`, `toggleMinimize`, `toggleMaximize`, `focusWindow` |
| Z-Index Scheduling | 147-148, 221-244, 430-460 | `maxZIndex`, `specimenZIndex` | `normalizeZIndexes`, `focusWindow` |
| Session Persistence | 192-308 | `mounted`, `saveTimerRef` | `restoreWindow`, `loadSnapshot`/`saveSnapshot` calls, `updateRecents` |
| Specimen App Bridge | 118-128, 714-750 | `isSpecimenOpen` (prop), `isSpecimenMinimized`, `specimenZIndex` | Inline `Children.map`/`cloneElement` |
| Boot/Shutdown Lifecycle | 151-158, 932-957 | `bootStatus`, `isShuttingDown`, `shutdownMode`, `isShutdownDialogOpen` | `handleBootComplete` |
| Shell Chrome (Taskbar, Start Menu, Tray, Branding) | 754-917 | `isStartMenuOpen`, `currentTime`, `isMobile` | `formatTime`, inline render logic |

### 1.2 State Topology Map

```
Win95Desktop useState inventory (17 variables):
├── vfs: VFSNode[]                    ← VFS subsystem
├── windows: WindowState[]            ← Window Manager
├── recents: PersistedRecent[]        ← Session Persistence
├── activeWindowId: string | null     ← Focus Manager
├── maxZIndex: number                 ← Z-Index Scheduler
├── specimenZIndex: number            ← Specimen Bridge (special-case z-index)
├── isSpecimenMinimized: boolean      ← Specimen Bridge (special-case minimize)
├── currentTime: Date | null          ← System Tray Clock
├── bootStatus: "booting" | "ready"   ← Boot Lifecycle
├── isShuttingDown: boolean           ← Shutdown Lifecycle
├── shutdownMode: "shutdown"|"restart"← Shutdown Lifecycle
├── isShutdownDialogOpen: boolean     ← Shutdown Dialog
├── mounted: boolean                  ← Hydration Guard
├── isStartMenuOpen: boolean          ← Start Menu
├── isMobile: boolean                 ← Responsive Guard
├── desktopRef: RefObject             ← Drag Constraints
└── saveTimerRef: RefObject           ← Persistence Debounce
```

**Diagnosis:** Every `setWindows` call triggers a re-render of the entire Desktop, including the Taskbar, Start Menu, Boot/Shutdown overlays, VFS icon grid, and all window containers. There is zero render isolation.

### 1.3 Specific Coupling Violations

**1.3.1 Specimen Special-Casing (Lines 118-128, 393-395, 407-414, 454-455, 714-750)**

The Specimen Analyzer application is not managed through the `windows[]` array like every other citizen. It uses dedicated state (`isSpecimenMinimized`, `specimenZIndex`) and dedicated branches in `focusWindow`, `minimizeWindow`, and `toggleMinimize`. This creates a parallel governance path that doubles the complexity of every window management function.

**1.3.2 Dual Persistence (Lines 164-190 and 246-308)**

Session persistence is implemented twice. The `useEffect` at line 164 loads the snapshot on mount, but a second `useEffect` at line 246 also loads it, with slightly different restoration logic (the second one assigns `zIndex: 100 + i`). Both write snapshots via separate `useEffect` blocks (lines 192-219 and 280-308).

**1.3.3 Z-Index Normalization Brute Force (Lines 221-244)**

`normalizeZIndexes` collects all windows plus the Specimen special-case, sorts them, and reassigns sequential z-indexes starting from 100. This is called inside `focusWindow` when `nextZ > 800`. This means focus operations have non-deterministic cost: O(1) normally, O(n log n) when threshold is hit. The threshold is arbitrary.

**1.3.4 Inline Application Dispatch (Lines 675-707)**

The render function directly dispatches application components inline:
```
{win.type === "EXPLORER" && (() => { ... return <Explorer ... /> })()}
{win.type === "BROWSER" && <WebBrowser />}
```
This hardcodes application awareness into the shell. Adding a new managed application requires modifying the God component's render body.

### 1.4 Proposed Extraction Topology

```
Win95Desktop.tsx (pure view shell, ~200 lines)
├── useWindowManager()        ← windows[], openWindow, closeWindow, minimize, maximize, focus
├── useZIndexScheduler()      ← maxZIndex, normalizeZIndexes, focusZ
├── useSessionPersistence()   ← load/save snapshot, recents, debounced auto-save
├── useVFS()                  ← vfs[], updateNodeInTree, handleOpenNode
├── useBootLifecycle()        ← bootStatus, isShuttingDown, shutdownMode
├── useSpecimenBridge()       ← isSpecimenMinimized, specimenZIndex (or unify into windows[])
├── TaskbarShell              ← Start Menu, Pills, System Tray (component)
└── ManagedAppDispatch        ← Maps AppType → Component (eliminates inline switch)
```

---

## 2. Dependency Flow Analysis

### 2.1 Dependency Topology

```
page.tsx
├── Win95Desktop (God component)
│   ├── Win95Atmosphere         (environmental overlay)
│   ├── Win95BootSequence       (lifecycle)
│   │   ├── Win95Atmosphere     (duplicated mount)
│   │   └── Win95ProgressBar
│   ├── Win95ShutdownSequence   (lifecycle)
│   ├── Win95ShutdownDialog     (dialog)
│   ├── Win95SearchInput        (Specimen bridge)
│   ├── Win95Notification       (toast)
│   │   └── Win95Window         (reused as dialog chrome)
│   ├── Win95DesktopIcon        (VFS surface)
│   ├── Win95Window             (canonical chrome) ← used for ALL windowed apps
│   │   └── Win95Icon
│   ├── SovereignRuntimeHost    (dispatch layer)
│   │   ├── WebampPlayer        (sovereign/full)
│   │   ├── MonacoEditorApp     (sovereign/vessel)
│   │   ├── JSPaintApp          (sovereign/vessel)
│   │   └── Notepad             (sovereign/vessel)
│   ├── Explorer                (managed, receives VFS + runtime snapshots)
│   └── WebBrowser              (managed)
├── Win95AnalysisDashboard      (passed as children)
│   ├── Win95Window
│   ├── Win95ProgressBar
│   └── Win95StatusBar/Panel
└── (state: scraping, downloading, notices)
```

### 2.2 Architectural Gravity Wells

**Gravity Well 1: `Win95Desktop` as Import Sink**

`Win95Desktop` imports 14 distinct modules. Every new application, dialog, or shell feature requires adding imports and render branches here. This is the single point of failure for the entire UI.

**Gravity Well 2: `page.tsx` ↔ `Win95Desktop` State Boundary Violation**

`page.tsx` owns scraping/download state (`isAnalyzing`, `isDownloading`, `scrapeResult`, `activityLog`, `downloadProgress`) and passes fragments of this into `Win95Desktop` via props (`isAnalyzing`, `isDownloading`, `isSearchVisible`, `notice`). `Win95Desktop` then conditionally renders `Win95SearchInput` based on these props. The `Win95AnalysisDashboard` is passed as `children` and receives `isActive` and `onMinimize` via `cloneElement` injection (lines 739-747). This creates a bidirectional data flow that is invisible from either file's interface alone.

**Gravity Well 3: Explorer Runtime Projection**

Explorer receives `runtimeSnapshots` (lines 676-689) — a derived projection of all other windows' state. This means Explorer has read access to the entire window manager's state, creating a tight coupling between the file manager and the process scheduler.

### 2.3 Circular Risk Assessment

No hard circular imports exist. However, there is a logical circularity:
- `Win95Desktop` renders `Explorer`
- `Explorer` receives `onFocusWindow` callback that mutates `Win95Desktop`'s `windows[]` state
- `Explorer` receives `onOpenNode` callback that calls `openWindow` inside `Win95Desktop`
- These callbacks create re-entrant state mutations during Explorer's render cycle

---

## 3. Cognitive Entropy Mapping

### 3.1 Per-Subsystem Cognitive Load

| Subsystem | File(s) | Severity | Primary Entropy Source |
|---|---|---|---|
| Window Manager | `Win95Desktop.tsx` L326-460 | **Critical** | 7 functions with overlapping concerns; `focusWindow` has 3 code paths including normalization |
| Specimen Bridge | `Win95Desktop.tsx` L393-414, 714-750 | **High** | Parallel governance path; `cloneElement` injection; invisible prop threading |
| Session Persistence | `Win95Desktop.tsx` L164-308 | **High** | Dual load paths; dual save paths; no single source of truth |
| Explorer Navigation | `Explorer.tsx` L27-96 | **Medium** | `ExplorerView` union type requires serialize/deserialize pipeline; 6 helper functions for tree traversal |
| Z-Index Scheduling | `Win95Desktop.tsx` L221-244, 430-460 | **Medium** | Non-deterministic normalization trigger; Specimen special-case |
| Notepad Menu System | `Notepad/index.tsx` L194-428 | **Medium** | 4 menu dropdowns rendered inline with JSX style blocks; `menu-item` class defined via `<style jsx>` |
| `WindowState` Interface | `Win95Desktop.tsx` L95-113 | **Medium** | `playback?: AudioPlaybackState` and `activity?: RuntimeActivityState` leak sovereign app concerns into shell state |

### 3.2 Hidden Side Effects

| Location | Side Effect | Visibility |
|---|---|---|
| `Win95Desktop` L274 | `setInterval` for clock — triggers re-render every 1 second | Hidden inside `useEffect` |
| `Win95Desktop` L280-308 | Debounced `localStorage.setItem` on every `windows` change | Hidden inside `useEffect` |
| `Win95Desktop` L523-524 | VFS tree mutation inside sovereign `onDataChange` callback | Inline lambda, not traceable from VFS module |
| `WebampPlayer` L135 | `document.getElementById("webamp")` — DOM query outside React tree | Hidden inside async `run()` |
| `WebampPlayer` L156-161 | `navigator.mediaSession.metadata` mutation | Hidden inside `onTrackDidChange` |
| `MonacoEditor` L9-25 | `loader.init().then(monaco.editor.defineTheme(...))` — global Monaco state mutation at module load | Module-level side effect |
| `JSPaintApp` L43-66 | `setInterval` polling `iframe.contentDocument.title` every 1000ms | Hidden inside `useEffect` |
| `Win95ElasticGrid` L86 | Returns `null` — entire component is dead code but still mounted in layout | Component exists in render tree with all hooks active |

### 3.3 Naming Entropy Violations

| File | Identifier | Violation |
|---|---|---|
| `Win95Desktop.tsx` L39 | `data` in `(w.data as { content?: string })` | Opaque; should be `runtimeSnapshot` or `persistedPayload` |
| `Win95Desktop.tsx` L265 | `data: pw.data as any` | Unsafe cast; type information destroyed |
| `page.tsx` L35 | `scrapeResult: any` | Core application state typed as `any` |
| `page.tsx` L193 | `event: any` | Stream event parsed without validation |
| `os-config.ts` L52 | `metadata?: any` | VFS node metadata untyped |
| `WindowState` L107 | `data?: any` | Window payload untyped; every consumer must cast |
| `Notepad` L14 | `initialData?: any` | Sovereign runtime contract uses `any` |
| `Explorer.tsx` L55 | `base = ... { kind: v.kind as any }` | TypeScript escape hatch in serialization |

---

## 4. Runtime Materiality Audit

### 4.1 Animation Timing Consistency

| Component | Animation | Duration | Easing | Win95 Compliance |
|---|---|---|---|---|
| `Win95Window` open | opacity + scale + filter | 150ms | `[0.2, 0, 0, 1]` | **Violation** — Win95 windows appear instantly (0ms). Scale animation is non-authentic. |
| `Win95Window` close | opacity + scale + filter | 80ms | `linear` | **Acceptable** — fast enough to feel mechanical |
| `Win95Notification` | opacity | 50ms | `linear` | **Compliant** — instant appearance |
| `Win95BootSequence` progress | opacity | 3000ms | `easeInOut` | **Violation** — boot should feel mechanical, not smooth |
| `Win95Atmosphere` pulse | opacity oscillation | 12000ms | `linear` | **Acceptable** — sub-perceptual environmental layer |
| `TaskbarPill` enter | opacity + x | 50ms | `linear` | **Compliant** |
| Start Menu | opacity + y | 100ms | `linear` | **Marginal** — Win95 Start Menu has no animation; it appears instantly |
| `MonacoEditor` status dot | opacity pulse | 4000ms | `linear` | **Violation** — Win95 has no pulsing status indicators |
| `JSPaintApp` visibility | filter + backgroundColor | 300ms | `easeOut` | **Violation** — sovereign apps should not animate their visibility state |
| `Win95AnalysisDashboard` enter | opacity + x offset | 150ms | `easeOut` | **Violation** — slide-in motion is not Win95-native |

### 4.2 Spatial Sovereignty

**Window Positioning:** Managed windows use `top: "12%", left: "20%"` as base offset (line 664-665), then apply `x`/`y` via Framer Motion `animate`. This means position is split across CSS (`top`/`left`) and motion values (`x`/`y`), creating a dual-coordinate system.

**Maximize Behavior:** Maximized windows use `width: "100%", height: "calc(100% - 28px)"` (line 669) with `inset: 0`. The `28px` is a hardcoded taskbar height. If taskbar height changes, every maximize calculation breaks.

**Drag Constraints:** `dragConstraints={desktopRef}` constrains drag to the desktop div, but `desktopRef` is the `flex-1 relative overflow-hidden` container (line 476), which excludes the taskbar. This is correct but implicit.

### 4.3 Focus Choreography

Focus is managed via `activeWindowId` string comparison. The `focusWindow` function (lines 430-460) has three distinct code paths:
1. Early return if already focused and at max z-index
2. Normalization path when z-index exceeds 800
3. Standard increment path

Path 2 contains a subtle bug: after `normalizeZIndexes` mutates state, the function continues to use the pre-normalization `windows` array (line 446), because `normalizeZIndexes` calls `setWindows` which is async. The subsequent `setWindows` on line 446 will overwrite the normalization.

---

## 5. UI Primitive Sovereignty Audit

### 5.1 Bevel Implementation Inventory

| Location | Bevel Method | Canonical? |
|---|---|---|
| `globals.css` `--bevel-raised` | CSS custom property | **Source of truth** |
| `globals.css` `--bevel-sunken` | CSS custom property | **Source of truth** |
| `Win95Window.tsx` L139-144 | Inline `boxShadow` with 4-layer inset | **Violation** — duplicates `--bevel-raised` with slightly different syntax |
| `Win95AnalysisDashboard` L128 | `boxShadow: "var(--bevel-sunken)"` | **Compliant** |
| `Notepad` L354-366 | `shadow-[var(--bevel-sunken)]` via Tailwind | **Compliant** |
| `TaskbarPill` L979-980 | Inline `boxShadow: "var(--bevel-raised)"` / `"var(--bevel-pressed)"` | **Compliant** |
| `StartMenuItem` L834 | Inline `boxShadow` switching | **Compliant** |

**Critical Finding:** `Win95Window.tsx` — the canonical window primitive — does NOT use `--bevel-raised`. It inlines a 4-layer box-shadow (lines 139-144) that replicates the token but is not referenced from it. If `--bevel-raised` is updated in `globals.css`, `Win95Window` will not reflect the change.

### 5.2 Hardcoded Values

| File | Line | Value | Should Be |
|---|---|---|---|
| `Win95Window.tsx` | 68 | `duration: 0.15` | `0` (Win95 instant) |
| `Win95Desktop.tsx` | 669 | `calc(100% - 28px)` | `calc(100% - var(--win-taskbar-height))` |
| `Win95Desktop.tsx` | 762 | `bottom-8` (Tailwind = 32px) | Should match taskbar height token |
| `Win95AnalysisDashboard` | 55 | `bottom: 28` | Should match taskbar height token |
| `Win95Notification` L29 | `background: "#000080"` | `var(--win-title-active)` |
| `Win95Notification` L46 | `background: "#c00000"` | Should be a token |
| `Win95Notification` L64 | `background: "#007000"` | Should be a token |
| `MonacoEditor` L16 | `"#000015"` | Should reference design token |
| `JSPaintApp` L85 | `backgroundColor: "#c0c0c0"` | `var(--win-face)` |
| `JSPaintApp` L88 | `backgroundColor: "#808080"` | `var(--win-shadow)` |
| `Win95Desktop.tsx` L772 | `background: "linear-gradient(to bottom, #808080, #000080)"` | Should use tokens |

### 5.3 Menu System Duplication

Menus are implemented in three separate locations with no shared primitive:

1. **`Win95Window.tsx`** exports `Win95MenuBar` and `Win95MenuItem` (lines 332-361)
2. **`Win95AnalysisDashboard.tsx`** defines local `MenuBtn` component (lines 257-266)
3. **`Notepad/index.tsx`** defines inline menu dropdowns with `<style jsx>` for `.menu-item` class (lines 402-427)

Each has different hover behavior, different sizing, and different state management. There is no canonical menu primitive.

---

## 6. Dead Code and Structural Waste

| Item | File | Evidence |
|---|---|---|
| `Win95ElasticGrid` | `Win95ElasticGrid.tsx` | Returns `null` (line 86). All hooks still execute. Mounted in `layout.tsx`. |
| `GridContext` | `context/GridContext.tsx` | Only consumer is `Win95ElasticGrid` which is dead. `GridProvider` wraps entire app tree for nothing. |
| `SmartFormState` | `page.tsx` L9-14 | Interface defined, state initialized (L29), but `smartForm` is only read for `licenseId`/`licenseProof` fields. `outputFolder` and `source` are never used. |
| `Lenis` smooth scroll | `page.tsx` L47-68 | Smooth scroll library imported and initialized in a fixed-viewport OS environment where no scrolling occurs. |
| `INITIAL_WINDOWS` | `os-config.ts` L292 | Exported empty array, never imported anywhere. |
| `theme` state | `page.tsx` L37 | Theme state loaded from localStorage but never applied to any component. |

---

## 7. Refactor Risk Matrix

| Refactor | Severity | Entropy | Regression Risk | Complexity | Blast Radius | Legitimacy Gain | Materiality Risk |
|---|---|---|---|---|---|---|---|
| Extract `useWindowManager` from Desktop | Critical | Critical | Medium | Medium | High (all windows) | High | None |
| Unify Specimen into `windows[]` | High | High | Medium | Low | Medium (taskbar, focus) | High | None |
| Eliminate dual persistence | High | High | High | Low | Medium (session restore) | Medium | None |
| Extract `TaskbarShell` component | Medium | Medium | Low | Low | Low (isolated) | Medium | None |
| Canonical menu primitive | Medium | Medium | Low | Medium | Medium (3 files) | Low | Low |
| Remove dead code (ElasticGrid, Lenis) | Low | Low | None | Trivial | None | Low | None |
| Token-ify hardcoded colors | Medium | Medium | Low | Low | Wide (many files) | Low | Medium |
| Fix `Win95Window` bevel to use token | Medium | Low | Low | Trivial | Low | Medium | Low |
| Fix `focusWindow` normalization bug | High | Medium | Medium | Low | Low | High | None |
| Typed `WindowState.data` | Medium | High | Medium | Medium | Wide | Medium | None |

---

## 8. `WindowState` Interface Decomposition

Current interface (lines 95-113):

```typescript
export interface WindowState {
  id: string;                          // Identity
  type: AppType;                       // Identity
  title: string;                       // Identity
  icon: string;                        // Identity
  isOpen: boolean;                     // Lifecycle
  isMinimized: boolean;                // Lifecycle
  isMaximized: boolean;                // Spatial
  zIndex: number;                      // Spatial
  constitution: RuntimeConstitution;   // Runtime Contract
  playback?: AudioPlaybackState;       // SOVEREIGNTY VIOLATION — app-specific
  activity?: RuntimeActivityState;     // SOVEREIGNTY VIOLATION — app-specific
  data?: any;                          // SOVEREIGNTY VIOLATION — untyped
  position?: { x: number; y: number }; // Spatial
  width?: number | string;             // Spatial
  height?: number | string;            // Spatial
  openedAt?: number;                   // Session Metadata
}
```

**Problem:** `playback` is only relevant to `WEBAMP`. `activity` is only relevant to content-producing apps. Both are stored in the shell's state array, meaning every `setWindows` call serializes audio playback metadata for all windows, and the taskbar must filter for `playback?.isPlaying` on every render.

**Proposed decomposition:**

```typescript
interface WindowIdentity { id: string; type: AppType; title: string; icon: string; }
interface WindowLifecycle { isOpen: boolean; isMinimized: boolean; constitution: RuntimeConstitution; }
interface WindowSpatial { isMaximized: boolean; zIndex: number; position?: Vec2; width?: Dimension; height?: Dimension; }
interface WindowMetadata { openedAt?: number; }
// App-emitted state stored in a separate Map<string, RuntimeEmission>, not in WindowState
```
