"use client";

import dynamic from "next/dynamic";
import type { AppType, VFSNode, WindowData } from "@/lib/os-config";
import type { AudioPlaybackState, RuntimeActivityState } from "@/lib/runtime";
import type { PersistedRecent } from "@/lib/persistence";

// Hard-linked Managed Citizens
import Explorer, { type RuntimeSnapshot } from "@/components/ui/apps/Explorer";
import WebBrowser from "@/components/ui/apps/WebBrowser";

// Dynamically-linked Sovereign Citizens
const WebampPlayer = dynamic(() => import("@/components/ui/apps/WebampPlayer"), { ssr: false });
const MonacoEditorApp = dynamic(() => import("@/components/ui/apps/MonacoEditor"), { ssr: false });
const JSPaintApp = dynamic(() => import("@/components/ui/apps/JSPaintApp"), { ssr: false });
const NotepadApp = dynamic(() => import("@/components/ui/apps/Notepad"), { ssr: false });
const TerminalApp = dynamic(() => import("@/components/ui/apps/Terminal"), { ssr: false });
const DoomApp = dynamic(() => import("@/components/ui/apps/DoomApp"), { ssr: false });
const SkiFreeApp = dynamic(() => import("@/components/ui/apps/SkiFreeApp"), { ssr: false });

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
  onDataChange?: (data: WindowData) => void;
  onMaximize: () => void;
  
  // Terminal/Introspection Extensions
  vfs?: VFSNode[];
  runtimeSnapshots?: RuntimeSnapshot[];
  onOpenNode?: (node: VFSNode) => void;
  onOpenApp?: (type: AppType, title?: string, icon?: string, data?: WindowData) => void;
  onCloseApp?: (id: string) => void;
  onUpdateVFS?: (updater: (prev: VFSNode[]) => VFSNode[]) => void;
  runtimeLogs?: string[];
}

interface SovereignDispatchProps extends SovereignRuntimeProps {
  type: AppType;
  initialData?: WindowData;
  onPlaybackChange?: (state: AudioPlaybackState) => void;
  onMaximize: () => void;
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
  onMaximize,
  onFocus,
  onPositionChange,
  onPlaybackChange,
  onActivityChange,
  onDataChange,
  initialData,
  vfs,
  runtimeSnapshots,
  onOpenNode,
  onOpenApp,
  onCloseApp,
  onUpdateVFS,
  runtimeLogs,
}: SovereignDispatchProps) {
  switch (type) {
    case "WEBAMP":
      return (
        <WebampPlayer
          isVisible={isVisible}
          onClose={onClose}
          onMinimize={onMinimize}
          onMaximize={onMaximize}
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
          onMaximize={onMaximize}
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
          onMaximize={onMaximize}
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
          onMaximize={onMaximize}
          onFocus={onFocus}
          onPositionChange={onPositionChange}
          onActivityChange={onActivityChange}
          onDataChange={onDataChange}
          initialData={initialData}
        />
      );

    case "TERMINAL":
      return (
        <TerminalApp
          isVisible={isVisible}
          onClose={onClose}
          onMinimize={onMinimize}
          onMaximize={onMaximize}
          onFocus={onFocus}
          onPositionChange={onPositionChange}
          onActivityChange={onActivityChange}
          onDataChange={onDataChange}
          vfs={vfs}
          runtimeSnapshots={runtimeSnapshots}
          onOpenNode={onOpenNode}
          onOpenApp={onOpenApp}
          onCloseApp={onCloseApp}
          onUpdateVFS={onUpdateVFS}
          runtimeLogs={runtimeLogs}
        />
      );

    case "BROWSER":
      return (
        <WebBrowser 
          isVisible={isVisible}
          onClose={onClose}
          onMinimize={onMinimize}
          onMaximize={onMaximize}
          onFocus={onFocus}
          onPositionChange={onPositionChange}
          onActivityChange={onActivityChange} 
        />
      );

    case "DOOM":
      return (
        <DoomApp
          isVisible={isVisible}
          onClose={onClose}
          onMinimize={onMinimize}
          onMaximize={onMaximize}
          onFocus={onFocus}
          onPositionChange={onPositionChange}
          onActivityChange={onActivityChange}
        />
      );

    case "SKIFREE":
      return (
        <SkiFreeApp
          isVisible={isVisible}
          onClose={onClose}
          onMinimize={onMinimize}
          onMaximize={onMaximize}
          onFocus={onFocus}
          onPositionChange={onPositionChange}
          onActivityChange={onActivityChange}
        />
      );

    default:
      return null;
  }
}

interface ManagedDispatchProps {
  type: AppType;
  windowId: string;
  windowData?: WindowData;
  vfs: VFSNode[];
  recents: PersistedRecent[];
  runtimeSnapshots: RuntimeSnapshot[];
  onOpenNode: (node: VFSNode) => void;
  onFocusWindow: (id: string) => void;
  onDataChange: (data: WindowData) => void;
  onActivityChange?: (state: RuntimeActivityState) => void;
  onUpdateVFS?: (updater: (prev: VFSNode[]) => VFSNode[]) => void;
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
  onDataChange,
  onActivityChange,
  onUpdateVFS,
}: ManagedDispatchProps) {
  switch (type) {
    case "EXPLORER":
      return (
        <Explorer
          vfs={vfs}
          initialData={windowData as WindowData}
          runtimes={runtimeSnapshots}
          recents={recents}
          onOpenNode={onOpenNode}
          onFocusWindow={onFocusWindow}
          onDataChange={onDataChange}
          onActivityChange={onActivityChange}
          onUpdateVFS={onUpdateVFS}
        />
      );

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
  playback?: AudioPlaybackState;
  activity?: RuntimeActivityState;
}): string | undefined {
  if (w.type === "WEBAMP") {
    return w.playback?.track?.title ?? undefined;
  }
  return w.activity?.subtitle ?? undefined;
}
