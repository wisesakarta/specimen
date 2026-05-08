/**
 * Specimen Runtime Lifecycle Kernel
 *
 * Defines the constitutional classes and lifecycle states that govern
 * how runtimes are hosted inside the Specimen operating substrate.
 *
 * This is NOT a process simulator. It names and formalizes lifecycle
 * states that already existed implicitly in the shell's rendering logic.
 *
 * ─── Constitutional Classes ───────────────────────────────────────────────
 *
 *   managed   — React-owned lifecycle. The shell mounts and unmounts the
 *               component. Minimize = unmount. Restore = remount.
 *               Examples: Notepad, Explorer, Browser, MusicPlayer.
 *
 *   sovereign — Third-party or self-contained runtime that owns its own
 *               lifecycle. The shell must never unmount it on minimize.
 *               Minimize = suspend (CSS hide). Restore = resume (CSS show).
 *               Runtime, DOM, and state survive across hibernation.
 *               Examples: Webamp. Future: JSPaint, Monaco, DOSBox.
 *
 * ─── Lifecycle States ─────────────────────────────────────────────────────
 *
 *   running   — open, visible, interactive
 *   suspended — open, hidden (sovereign only — runtime alive, invisible)
 *   minimized — open, hidden (managed — React component is unmounted)
 *   closed    — not in registry, no runtime, no window
 *
 * Note: "suspended" and "minimized" produce the same user-visible state
 * (window gone from desktop, taskbar pill still present) but have opposite
 * runtime consequences. The constitution field makes this distinction explicit.
 */

export type RuntimeConstitution = "managed" | "sovereign";

export type LifecycleState = "running" | "suspended" | "minimized" | "closed";

/**
 * Audio playback state emitted by audio-capable sovereign runtimes.
 * The shell observes this — it does NOT control playback through it.
 */
export type AudioPlaybackState = {
  isPlaying: boolean;
  track?: { title?: string; artist?: string };
};

/**
 * Runtime activity state emitted by content-producing sovereign runtimes.
 * The shell observes this — it does NOT control runtime content through it.
 *
 * dirty — content has been modified from its initial state since the runtime opened.
 *         Generalizes to: unsaved buffer in a terminal, modified document in an IDE,
 *         in-progress state in an emulator.
 */
export type RuntimeActivityState = {
  dirty?: boolean;
  /** Primary artifact label (e.g. filename, current track, project name) */
  subtitle?: string;
  /** Optional base64 or URL thumbnail of current runtime content */
  thumbnail?: string;
};

/**
 * Derives the explicit lifecycle state from a window's stored fields.
 * Accepts the minimal shape needed — does not require the full WindowState.
 */
export function getLifecycleState(win: {
  isOpen: boolean;
  isMinimized: boolean;
  constitution: RuntimeConstitution;
}): LifecycleState {
  if (!win.isOpen) return "closed";
  if (!win.isMinimized) return "running";
  return win.constitution === "sovereign" ? "suspended" : "minimized";
}
