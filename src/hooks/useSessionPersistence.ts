"use client";

/**
 * Session Persistence — Canonical persistence for Specimen OS.
 *
 * Consolidates what were previously two separate load paths and two separate
 * save paths into a single deterministic persistence lifecycle:
 *
 *   Load: loadSessionSnapshot() called as useState initializer (synchronous, SSR-safe).
 *   Save: useSessionSave() — single debounced effect gated on mounted flag.
 *
 * Persistence contract:
 *   - Exactly one module governs persistence for session state.
 *   - Persistence fires from a deterministic debounced effect, not inline mutations.
 *   - Hydration order: mounted flag gates save effect to prevent persisting empty state.
 *   - No stale closure: save effect captures current state via dependency array.
 *   - VFS is always included in the snapshot (previous Save Path 2 dropped it).
 */

import { useEffect, useRef } from "react";
import { loadSnapshot, saveSnapshot, SessionSnapshot, PersistedWindow, PersistedRecent } from "@/lib/persistence";
import { DEFAULT_VFS, VFSNode } from "@/lib/os-config";
import type { WindowState } from "@/components/ui/Win95Desktop";

/** Debounce interval for auto-save (ms). */
const SAVE_DEBOUNCE_MS = 500;

/**
 * Restores a persisted window record into a live WindowState.
 * Z-index is assigned sequentially from a base offset to maintain stable ordering.
 */
function restoreWindow(persistedWindow: PersistedWindow, index: number): WindowState {
  return {
    id: persistedWindow.id,
    type: persistedWindow.type,
    title: persistedWindow.title,
    icon: persistedWindow.icon,
    isOpen: true,
    isMinimized: persistedWindow.isMinimized,
    isMaximized: persistedWindow.isMaximized ?? false,
    zIndex: 100 + index,
    constitution: persistedWindow.constitution,
    data: persistedWindow.data,
    position: persistedWindow.position,
    width: persistedWindow.width,
    height: persistedWindow.height,
    openedAt: persistedWindow.openedAt,
    activity: (persistedWindow.dirty || persistedWindow.subtitle)
      ? { dirty: persistedWindow.dirty ?? false, subtitle: persistedWindow.subtitle }
      : undefined,
  };
}

/**
 * Serializes a live WindowState into its persisted form.
 * Strips volatile runtime state (playback, transient activity fields).
 */
function serializeWindow(window: WindowState): PersistedWindow {
  return {
    id: window.id,
    type: window.type,
    title: window.title,
    icon: window.icon,
    isMinimized: window.isMinimized,
    isMaximized: window.isMaximized,
    constitution: window.constitution,
    position: window.position,
    width: window.width,
    height: window.height,
    data: window.data,
    dirty: window.activity?.dirty === true ? true : undefined,
    subtitle: window.activity?.subtitle,
    openedAt: window.openedAt,
  };
}

export interface SessionInitialState {
  windows: WindowState[];
  recents: PersistedRecent[];
  vfs: VFSNode[];
  maxZIndex: number;
}

/**
 * Loads the session snapshot synchronously from localStorage.
 * Designed to be called from a useState lazy initializer to avoid
 * hydration mismatch and double-render issues.
 *
 * Returns the initial state for windows, recents, VFS, and maxZIndex.
 * If no snapshot exists, returns defaults.
 */
export function loadSessionSnapshot(): SessionInitialState {
  if (typeof window === "undefined") {
    return {
      windows: [],
      recents: [],
      vfs: DEFAULT_VFS,
      maxZIndex: 100,
    };
  }

  const snapshot = loadSnapshot();
  if (!snapshot) {
    return {
      windows: [],
      recents: [],
      vfs: DEFAULT_VFS,
      maxZIndex: 100,
    };
  }

  const restoredWindows = snapshot.windows.map(restoreWindow);
  return {
    windows: restoredWindows,
    recents: snapshot.recents ?? [],
    vfs: snapshot.vfsNodes ?? DEFAULT_VFS,
    maxZIndex: 100 + snapshot.windows.length + 1,
  };
}

/**
 * Canonical save hook. Debounces writes to localStorage.
 *
 * Must be called after state is initialized. The `mounted` flag gates
 * the save effect to prevent writing empty/default state before the
 * initial load has been consumed by React.
 *
 * Dependencies: [windows, recents, vfs, mounted]
 *   - All four are in the dependency array to ensure every mutation triggers save.
 *   - Previous Save Path 2 omitted `vfs` and `recents`, causing VFS mutations
 *     to be silently dropped on the next reload.
 */
export function useSessionSave(liveState: {
  windows: WindowState[];
  vfs: VFSNode[];
  recents: PersistedRecent[];
  mounted: boolean;
}): void {
  const { windows, vfs, recents, mounted } = liveState;

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!mounted) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const snapshot: SessionSnapshot = {
        version: 1,
        vfsNodes: vfs,
        windows: windows.map(serializeWindow),
        recents,
      };
      saveSnapshot(snapshot);
    }, SAVE_DEBOUNCE_MS);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [windows, recents, vfs, mounted]);
}
