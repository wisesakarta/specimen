/**
 * Specimen Session Persistence
 *
 * Lightweight session continuity for the Specimen operating substrate.
 *
 * Persistence law:
 *   - The shell persists only what it observes and governs.
 *   - Runtimes push declarative snapshots (Monaco content) — the shell
 *     stores and returns them opaquely. Content is never read or interpreted.
 *   - Volatile runtime state (Webamp audio, playback) is never persisted.
 *   - Transient shell state (activeWindowId, z-order) is recalculated on restore.
 */

import type { AppType, VFSNode, WindowData } from "@/lib/os-config";
import type { RuntimeConstitution } from "@/lib/runtime";

export const SESSION_KEY = "specimen-session-v3";

export interface PersistedRecent {
  id: string;
  type: AppType;
  title: string;
  icon: string;
  lastOpenedAt: number;
  /** Opaque runtime state. */
  data?: WindowData;
}

export interface PersistedWindow {
  id: string;
  type: AppType;
  title: string;
  icon: string;
  isMinimized: boolean;
  isMaximized: boolean;
  constitution: RuntimeConstitution;
  position?: { x: number; y: number };
  width?: number | string;
  height?: number | string;
  /** Opaque runtime state (Monaco: { content: string }). Shell never reads this. */
  data?: WindowData;
  /** Persisted activity.dirty — restores the taskbar dirty indicator without re-emission. */
  dirty?: true;
  /** Persisted activity.subtitle — restores the artifact name (e.g. filename) immediately. */
  subtitle?: string;
  /** Unix timestamp (ms) when this window was first opened in its session. */
  openedAt?: number;
}

export interface SessionSnapshot {
  version: 3;
  windows: PersistedWindow[];
  recents?: PersistedRecent[];
  vfsNodes?: VFSNode[];
}

export function loadSnapshot(): SessionSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    if ((parsed as { version?: unknown }).version !== 3) return null;
    return parsed as SessionSnapshot;
  } catch {
    return null;
  }
}

export function saveSnapshot(snapshot: SessionSnapshot): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(snapshot));
  } catch {
    // localStorage unavailable: private mode, quota exceeded — fail silently
  }
}
