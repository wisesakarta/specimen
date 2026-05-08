"use client";

import dynamic from "next/dynamic";
import type { AppType, VFSNode } from "@/lib/os-config";
import type { AudioPlaybackState, RuntimeActivityState } from "@/lib/runtime";

// Hard-linked Managed Citizens
import Explorer, { type RuntimeSnapshot } from "@/components/ui/apps/Explorer";
import WebBrowser from "@/components/ui/apps/WebBrowser";

// Dynamically-linked Sovereign Citizens
const WebampPlayer = dynamic(() => import("@/components/ui/apps/WebampPlayer"), { ssr: false });
const MonacoEditorApp = dynamic(() => import("@/components/ui/apps/MonacoEditor"), { ssr: false });
const JSPaintApp = dynamic(() => import("@/components/ui/apps/JSPaintApp"), { ssr: false });
const NotepadApp = dynamic(() => import("@/components/ui/apps/Notepad"), { ssr: false });

/**
 * The standard shell-to-runtime contract for Sovereign citizens.
 */
export interface SovereignRuntimeProps {
  isVisible: boolean;
  onClose: () => void;
  onMinimize: () => void;
  onFocus: () => void;
  onPositionChange: (pos: { x: number; y: number }) => void;
  onActivityChange?: (state: RuntimeActivityState) => void;
  onDataChange?: (data: unknown) => void;
}

interface SovereignDispatchProps extends SovereignRuntimeProps {
  type: AppType;
  initialData?: unknown;
  onPlaybackChange?: (state: AudioPlaybackState) => void;
}

/**
 * DispatchSovereignCitizen
 * Resolves the executable for sovereign applications.
 */
export function DispatchSovereignCitizen({
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
}: SovereignDispatchProps) {
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

    default:
      return null;
  }
}

interface ManagedDispatchProps {
  type: AppType;
  windowId: string;
  windowData?: unknown;
  vfs: VFSNode[];
  recents: any;
  runtimeSnapshots: RuntimeSnapshot[];
  onOpenNode: (node: VFSNode) => void;
  onFocusWindow: (id: string) => void;
  onDataChange: (data: unknown) => void;
}

/**
 * DispatchManagedCitizen
 * Resolves the executable for managed applications that follow standard React lifecycle.
 */
export function DispatchManagedCitizen({
  type,
  windowData,
  vfs,
  recents,
  runtimeSnapshots,
  onOpenNode,
  onFocusWindow,
  onDataChange
}: ManagedDispatchProps) {
  switch (type) {
    case "EXPLORER":
      return (
        <Explorer
          vfs={vfs}
          initialData={windowData}
          runtimes={runtimeSnapshots}
          recents={recents}
          onOpenNode={onOpenNode}
          onFocusWindow={onFocusWindow}
          onDataChange={onDataChange}
        />
      );

    case "BROWSER":
      return <WebBrowser />;

    default:
      return null;
  }
}

/**
 * extractRuntimeTextPayload
 * Extracts raw string content from arbitrary runtime data payloads.
 */
export function extractRuntimeTextPayload(data: unknown): string {
  if (typeof data === "string") return data;
  if (data && typeof data === "object" && "content" in data && typeof (data as { content: unknown }).content === "string") {
    return (data as { content: string }).content;
  }
  return "";
}

/**
 * resolveRuntimeSubtitle
 * Derives the environmental subtitle for a window based on its runtime type and current state.
 */
export function resolveRuntimeSubtitle(w: {
  type: AppType;
  data?: any;
  playback?: AudioPlaybackState;
  activity?: RuntimeActivityState;
}): string | undefined {
  if (w.type === "MONACO_EDITOR") {
    const content = (w.data as { content?: string } | null)?.content;
    if (!content) return undefined;
    const firstLine = content.split("\n").find(
      (l) => l.trim() && !l.trim().startsWith("//") && !l.trim().startsWith("#") && !l.trim().startsWith("/*")
    );
    return firstLine?.trim().slice(0, 40) || undefined;
  }
  if (w.type === "WEBAMP") {
    return w.playback?.track?.title ?? undefined;
  }
  if (w.type === "NOTEPAD") {
    const content = extractRuntimeTextPayload(w.data);
    if (!content) return undefined;
    const firstLine = content.split("\n").find((l) => l.trim());
    return firstLine?.trim().slice(0, 40) || undefined;
  }
  if (w.type === "JSPAINT") {
    return w.activity?.subtitle ?? undefined;
  }
  return undefined;
}
