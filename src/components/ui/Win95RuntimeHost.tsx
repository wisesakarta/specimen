"use client";

/**
 * SovereignRuntimeHost
 *
 * The hosting dispatch layer for sovereign runtimes inside the Specimen shell.
 *
 * Shell responsibilities (handled OUTSIDE this file, in Win95Desktop):
 *   - Z-index, taskbar pill, focus/minimize/restore governance
 *   - Visibility wrapper: display:none on the motion.div container
 *   - Existence gate: close removes from tree, minimize only suspends visibility
 *
 * Sovereign runtime responsibilities (enforced by SovereignRuntimeProps):
 *   - Mount and own the third-party runtime lifecycle
 *   - Respond to isVisible: false by suspending visibility at the runtime level
 *   - Report close / minimize / focus / position changes back to shell
 *
 * To register a new sovereign runtime:
 *   1. Add its AppType to SOVEREIGN_REGISTRY in os-config.ts
 *   2. Add a case below
 *   3. Implement SovereignRuntimeProps in the runtime component
 */

import dynamic from "next/dynamic";
import type { AppType } from "@/lib/os-config";
import type { AudioPlaybackState, RuntimeActivityState } from "@/lib/runtime";

const WebampPlayer = dynamic(() => import("./apps/WebampPlayer"), { ssr: false });
const MonacoEditorApp = dynamic(() => import("./apps/MonacoEditor"), { ssr: false });
const JSPaintApp = dynamic(() => import("./apps/JSPaintApp"), { ssr: false });
const NotepadApp = dynamic(() => import("./apps/Notepad"), { ssr: false });

/** The standard shell-to-runtime contract. Every sovereign runtime must accept these. */
export interface SovereignRuntimeProps {
  isVisible: boolean;
  onClose: () => void;
  onMinimize: () => void;
  onFocus: () => void;
  onPositionChange: (pos: { x: number; y: number }) => void;
  onActivityChange?: (state: RuntimeActivityState) => void;
  onDataChange?: (data: unknown) => void;
}

interface SovereignRuntimeHostProps extends SovereignRuntimeProps {
  type: AppType;
  /** Opaque runtime state from a prior session — passed back on restore. Shell never reads it. */
  initialData?: unknown;
  /** Audio-capable runtimes only. Shell observes playback — does not control it. */
  onPlaybackChange?: (state: AudioPlaybackState) => void;
  /** Content-producing runtimes only. Shell observes activity — does not control it. */
  onActivityChange?: (state: RuntimeActivityState) => void;
  /** Content-producing runtimes only. Runtime pushes snapshot; shell stores it opaquely. */
  onDataChange?: (data: unknown) => void;
}

export default function SovereignRuntimeHost({
  type,
  isVisible,
  onClose,
  onMinimize,
  onFocus,
  onPositionChange,
  onPlaybackChange,
  onActivityChange,
  onDataChange,
  initialData,
}: SovereignRuntimeHostProps) {
  switch (type) {
    case "WEBAMP":
      return (
        <WebampPlayer
          isVisible={isVisible}
          onClose={onClose}
          onMinimize={onMinimize}
          onFocus={onFocus}
          onPositionChange={onPositionChange}
          onPlaybackChange={onPlaybackChange}
          initialData={initialData}
        />
      );

    case "MONACO_EDITOR":
      return (
        <MonacoEditorApp
          isVisible={isVisible}
          onClose={onClose}
          onMinimize={onMinimize}
          onFocus={onFocus}
          onPositionChange={onPositionChange}
          onActivityChange={onActivityChange}
          onDataChange={onDataChange}
          initialData={initialData}
        />
      );

    case "JSPAINT":
      return (
        <JSPaintApp
          isVisible={isVisible}
          onClose={onClose}
          onMinimize={onMinimize}
          onFocus={onFocus}
          onPositionChange={onPositionChange}
          onActivityChange={onActivityChange}
          onDataChange={onDataChange}
        />
      );

    case "NOTEPAD":
      return (
        <NotepadApp
          isVisible={isVisible}
          onClose={onClose}
          onMinimize={onMinimize}
          onFocus={onFocus}
          onPositionChange={onPositionChange}
          onActivityChange={onActivityChange}
          onDataChange={onDataChange}
          initialData={initialData}
        />
      );

    // Future sovereign runtimes registered here:
    // case "DOSBOX": return <DOSBox ... />;

    default:
      return null;
  }
}
