"use client";

import { useState, useMemo, Fragment, useEffect } from "react";
import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { type VFSNode, type AppType, type WindowData } from "@/lib/os-config";
import { cn } from "@/lib/style-composer";
import Win95Window, { Win95MenuBar, Win95MenuItem, Win95StatusBar, Win95StatusPanel } from "../Win95Window";

// ─── Runtime projection ───────────────────────────────────────────────────────

/** Minimal runtime state projected by the shell into Explorer's topology view. */
export interface RuntimeSnapshot {
  id: string;
  type: AppType;
  title: string;
  icon: string;
  isMinimized: boolean;
  activity?: { dirty?: boolean };
  playback?: { isPlaying: boolean };
  /** Derived document identity — e.g. first content line for Monaco, track title for Webamp. */
  subtitle?: string;
  /** Unix timestamp (ms) when this window was first opened. */
  openedAt?: number;
}

// ─── Navigation model ─────────────────────────────────────────────────────────

/**
 * ExplorerView is the unit of navigation.
 * "my-computer" and "active-sessions" are virtual — derived from runtime topology.
 * "desktop" mirrors the VFS root.
 * "vfs" navigates into a static VFSNode subtree.
 */
type ExplorerView =
  | { kind: "my-computer"; selectedId?: string }
  | { kind: "desktop"; selectedId?: string }
  | { kind: "active-sessions"; selectedId?: string }
  | { kind: "recent-items"; selectedId?: string }
  | { kind: "vfs"; node: VFSNode; selectedId?: string };

/** Serializable form stored in shell's window.data for navigation continuity. */
type SerializedView =
  | { kind: "my-computer"; selectedId?: string }
  | { kind: "desktop"; selectedId?: string }
  | { kind: "active-sessions"; selectedId?: string }
  | { kind: "recent-items"; selectedId?: string }
  | { kind: "vfs"; nodeId: string; selectedId?: string };

export interface ExplorerSession {
  viewStack: SerializedView[];
}

function serialize(v: ExplorerView): SerializedView {
  const base = v.kind === "vfs" ? { kind: "vfs" as const, nodeId: v.node.id } : { kind: v.kind as any };
  return { ...base, selectedId: v.selectedId };
}

function deserialize(s: SerializedView, vfs: VFSNode[]): ExplorerView | null {
  if (s.kind !== "vfs") return { ...s } as ExplorerView;
  const node = findNode(s.nodeId, vfs);
  return node ? { kind: "vfs", node, selectedId: s.selectedId } : null;
}

function findNode(id: string, nodes: VFSNode[]): VFSNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children) {
      const found = findNode(id, n.children);
      if (found) return found;
    }
  }
  return null;
}

function findParent(id: string, nodes: VFSNode[]): VFSNode | null {
  for (const n of nodes) {
    if (n.children?.some((c) => c.id === id)) return n;
    if (n.children) {
      const found = findParent(id, n.children);
      if (found) return found;
    }
  }
  return null;
}

function getParent(v: ExplorerView, vfs: VFSNode[]): ExplorerView | null {
  if (v.kind === "my-computer") return null;
  if (v.kind === "desktop" || v.kind === "active-sessions" || v.kind === "recent-items") return { kind: "my-computer" };
  if (v.kind === "vfs") {
    if (vfs.some((n) => n.id === v.node.id)) return { kind: "my-computer" };
    const parent = findParent(v.node.id, vfs);
    return parent ? { kind: "vfs", node: parent } : { kind: "my-computer" };
  }
  return null;
}

function getViewLabel(v: ExplorerView): string {
  switch (v.kind) {
    case "my-computer":      return "My Computer";
    case "desktop":          return "Desktop";
    case "active-sessions":  return "Active Sessions";
    case "recent-items":     return "Recent Items";
    case "vfs":              return v.node.name;
  }
}


// ─── Display items ────────────────────────────────────────────────────────────

type DisplayItem =
  | { kind: "vfolder";  id: string; name: string; iconSrc: string; view: ExplorerView }
  | { kind: "vfile";    id: string; name: string; iconSrc: string; node: VFSNode; typeName: string }
  | { kind: "vapp";     id: string; name: string; iconSrc: string; node: VFSNode }
  | { kind: "runtime";  id: string; name: string; iconSrc: string; runtimeId: string; isMinimized: boolean; dirty: boolean; playing: boolean; subtitle?: string; openedAt?: number }
  | { kind: "recent";   id: string; name: string; iconSrc: string; type: AppType; data: any; lastOpenedAt: number };

import { resolveWin95Icon } from "@/lib/icon-map";

function iconSrc(emoji: string, size: 16 | 32 = 16): string {
  return resolveWin95Icon(emoji, size) ?? "";
}

function vfsToItem(node: VFSNode): DisplayItem {
  if (node.type === "folder") {
    return { kind: "vfolder", id: node.id, name: node.name, iconSrc: iconSrc(node.icon), view: { kind: "vfs", node } };
  }
  if (node.appType) {
    return { kind: "vapp", id: node.id, name: node.name, iconSrc: iconSrc(node.icon), node };
  }
  return {
    kind: "vfile", id: node.id, name: node.name,
    iconSrc: iconSrc(node.icon), node,
    typeName: node.name.endsWith(".txt") ? "Text Document" : node.name.endsWith(".zip") ? "ZIP Archive" : "File",
  };
}

// ─── Initial state resolution ─────────────────────────────────────────────────

function resolveInitialView(data: unknown, vfs: VFSNode[]): ExplorerView {
  if (!data) return { kind: "my-computer" };
  if (typeof data === "object" && data !== null) {
    // Restored ExplorerSession
    if ("viewStack" in data) {
      const s = data as ExplorerSession;
      if (s.viewStack.length > 0) {
        const resolved = deserialize(s.viewStack[s.viewStack.length - 1], vfs);
        if (resolved) return resolved;
      }
      return { kind: "my-computer" };
    }
    // Fresh VFSNode
    if ("id" in data) {
      const node = data as VFSNode;
      if (node.id === "desktop-mycomputer") return { kind: "my-computer" };
      if (node.id === "__recents__") return { kind: "recent-items" };
      
      // Sync fresh node with current VFS state (Materiality consistency)
      const syncedNode = findNode(node.id, vfs);
      return { kind: "vfs", node: syncedNode || node };
    }
  }
  return { kind: "my-computer" };
}

function resolveInitialHistory(data: unknown, vfs: VFSNode[]): ExplorerView[] {
  if (!data || typeof data !== "object" || !("viewStack" in data)) return [];
  const s = data as ExplorerSession;
  if (s.viewStack.length <= 1) return [];
  return s.viewStack
    .slice(0, -1)
    .map(s => deserialize(s, vfs))
    .filter((v): v is ExplorerView => v !== null);
}

// ─── Component ────────────────────────────────────────────────────────────────

interface ExplorerProps {
  vfs: VFSNode[];
  initialData: WindowData;
  runtimes: RuntimeSnapshot[];
  recents: import("@/lib/persistence").PersistedRecent[];
  onOpenNode: (node: VFSNode) => void;
  onFocusWindow: (id: string) => void;
  onDataChange?: (session: WindowData) => void;
}

export default function Explorer({ vfs, initialData, runtimes, recents, onOpenNode, onFocusWindow, onDataChange }: ExplorerProps) {
  const [view, setView]       = useState<ExplorerView>(() => resolveInitialView(initialData, vfs));
  const [history, setHistory] = useState<ExplorerView[]>(() => resolveInitialHistory(initialData, vfs));
  const [selected, setSelected] = useState<string | null>(null);

  // Materiality Synchronization: Ensure current view node reflects latest VFS state
  useEffect(() => {
    if (view.kind === "vfs") {
      const updatedNode = findNode(view.node.id, vfs);
      if (updatedNode && updatedNode !== view.node) {
        setView(prev => prev.kind === "vfs" ? { ...prev, node: updatedNode } : prev);
      }
    }
  }, [vfs, view.kind]);

  const navigate = (next: ExplorerView) => {
    // Save current selection into history before moving
    const currentWithMemory = { ...view, selectedId: selected ?? undefined };
    const newHistory = [...history, currentWithMemory];
    setHistory(newHistory);
    setView(next);
    setSelected(next.selectedId ?? null);
    onDataChange?.({ viewStack: [...newHistory, next].map(serialize) } as WindowData);
  };

  const goBack = () => {
    if (!history.length) return;
    const newHistory = history.slice(0, -1);
    const prev = history[history.length - 1];
    setHistory(newHistory);
    setView(prev);
    setSelected(prev.selectedId ?? null);
    onDataChange?.({ viewStack: [...newHistory, prev].map(serialize) } as WindowData);
  };

  const goUp = () => {
    const parent = getParent(view, vfs);
    if (parent) navigate(parent);
  };

  const navigateTo = (index: number) => {
    const currentWithMemory = { ...view, selectedId: selected ?? undefined };
    const fullStack = [...history, currentWithMemory];
    if (index >= fullStack.length - 1) return;
    const target = fullStack[index];
    const newHistory = fullStack.slice(0, index);
    setHistory(newHistory);
    setView(target);
    setSelected(target.selectedId ?? null);
    onDataChange?.({ viewStack: [...newHistory, target].map(serialize) } as WindowData);
  };

  const myDocs = useMemo(() => findNode("desktop-docs", vfs), [vfs]);

  const items = useMemo<DisplayItem[]>(() => {
    if (view.kind === "my-computer") {
      const entries: DisplayItem[] = [
        { kind: "vfolder", id: "__desktop__",  name: "Desktop",         iconSrc: iconSrc("🗂️"),              view: { kind: "desktop" } },
        ...(myDocs ? [{ kind: "vfolder" as const, id: myDocs.id, name: myDocs.name, iconSrc: iconSrc(myDocs.icon), view: { kind: "vfs" as const, node: myDocs } }] : []),
        { kind: "vfolder", id: "__sessions__", name: "Active Sessions", iconSrc: iconSrc("🗂️"),              view: { kind: "active-sessions" } },
        { kind: "vfolder", id: "__recents__",  name: "Recent Items",    iconSrc: iconSrc("📂"),              view: { kind: "recent-items" } },
      ];
      return entries;
    }
    if (view.kind === "desktop")         return vfs.map(vfsToItem);
    if (view.kind === "active-sessions") return runtimes.map((rt) => ({
      kind:       "runtime" as const,
      id:         rt.id,
      name:       rt.title,
      iconSrc:    iconSrc(rt.icon),
      runtimeId:  rt.id,
      isMinimized: rt.isMinimized,
      dirty:      rt.activity?.dirty === true,
      playing:    rt.playback?.isPlaying === true,
      subtitle:   rt.subtitle,
      openedAt:   rt.openedAt,
    }));
    if (view.kind === "recent-items") return recents.map((r) => ({
      kind:       "recent" as const,
      id:         r.id,
      name:       r.title,
      iconSrc:    iconSrc(r.icon),
      type:       r.type,
      data:       r.data,
      lastOpenedAt: r.lastOpenedAt,
    }));
    if (view.kind === "vfs")             return (view.node.children ?? []).map(vfsToItem);
    return [];
  }, [view, runtimes, myDocs]);

  const onActivate = (item: DisplayItem) => {
    if (item.kind === "vfolder")  navigate(item.view);
    else if (item.kind === "runtime") onFocusWindow(item.runtimeId);
    else if (item.kind === "recent") {
      onOpenNode({
        id: item.id,
        name: item.name,
        type: "file",
        icon: "📄", // Fallback
        appType: item.type,
        content: typeof item.data === "string" ? item.data : (item.data as any)?.content,
        metadata: item.data,
      });
    }
    else if (item.kind === "vapp" || item.kind === "vfile") onOpenNode(item.node);
  };

  const canUp        = getParent(view, vfs) !== null;
  const runningCount = runtimes.filter((r) => !r.isMinimized).length;
  const fullPathStack = [...history, view];

  return (
    <div className="flex flex-col h-full select-none" style={{ background: "var(--win-face)", fontFamily: "var(--font-shell)", fontSize: "var(--win-font-size)" }}>

      {/* Toolbar */}
      <div className="flex items-center gap-1 p-1 select-none" style={{ borderBottom: "1px solid var(--win-shadow)" }}>
        <button className="win-btn h-6 px-2 min-w-0" style={{ fontSize: "var(--win-font-size)" }}
          onClick={goBack} disabled={!history.length}>
          ← Back
        </button>
        <button className="win-btn h-6 px-2 min-w-0" style={{ fontSize: "var(--win-font-size)" }}
          onClick={goUp} disabled={!canUp}>
          ↑ Up
        </button>
        {/* Address bar — interactive breadcrumbs */}
        <div className="flex-1 flex items-center px-[2px] gap-0 overflow-hidden"
          style={{ height: 20, background: "var(--win-window)", boxShadow: "var(--bevel-sunken)" }}>
          <div className="h-[14px] flex items-center px-1 bg-[var(--win-face)] border border-[var(--win-shadow)] mr-[4px] shadow-[inset_1px_1px_0_white]" style={{ flexShrink: 0 }}>
             <span className="font-bold" style={{ color: "var(--win-text)", fontSize: "8px", letterSpacing: "0.02em" }}>PATH</span>
          </div>
          {fullPathStack.map((v, i, arr) => (
            <Fragment key={i}>
              {i > 0 && <span style={{ padding: "0 4px", color: "var(--win-shadow)", flexShrink: 0, fontSize: "9px", opacity: 0.4 }}>▶</span>}
              {i < arr.length - 1 ? (
                <button
                  style={{ color: "var(--win-shadow)", cursor: "default", flexShrink: 0, fontSize: "var(--win-font-size)", textDecoration: "none", fontWeight: 400 }}
                  onClick={() => navigateTo(i)}
                  className="hover:text-[var(--win-title-active)] px-1 outline-none focus:bg-[var(--win-select-bg)] focus:text-white"
                >
                  {getViewLabel(v)}
                </button>
              ) : (
                <span className="truncate font-bold" style={{ flexShrink: 1, fontSize: "var(--win-font-size)", padding: "0 4px", color: "var(--win-text)", opacity: 0.9 }}>{getViewLabel(v)}</span>
              )}
            </Fragment>
          ))}
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Navigation Pane (Spatial Legitimacy) — Hidden on mobile to prevent spatial crushing */}
        <div className="hidden sm:flex w-36 flex-shrink-0 flex flex-col border-r border-[var(--win-dk-shadow)] shadow-[1px_0_0_var(--win-highlight)] p-0 gap-0 overflow-y-auto" style={{ background: "var(--win-face)" }}>
          <div className="p-1 flex flex-col gap-0">
            <SidebarItem label="Desktop" icon="🗂️" active={view.kind === "desktop"} onClick={() => navigate({ kind: "desktop" })} />
            <SidebarItem label="My Computer" icon="🖥️" active={view.kind === "my-computer"} onClick={() => navigate({ kind: "my-computer" })} />
            {myDocs && <SidebarItem label="My Documents" icon="📁" active={view.kind === "vfs" && view.node.id === myDocs.id} onClick={() => navigate({ kind: "vfs", node: myDocs })} />}
          </div>
          <div className="h-[2px] bg-[var(--win-shadow)] shadow-[0_1px_0_white] my-1 mx-1" />
          <div className="p-1 flex flex-col gap-0">
            <SidebarItem label="Sessions" icon="🔍" active={view.kind === "active-sessions"} onClick={() => navigate({ kind: "active-sessions" })} />
            <SidebarItem label="Recents" icon="📂" active={view.kind === "recent-items"} onClick={() => navigate({ kind: "recent-items" })} />
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden m-1 ml-0 win-sunken" style={{ background: "var(--win-window)" }}>
          {/* Column headers */}
          <div className="flex select-none" style={{ height: 18, borderBottom: "1px solid var(--win-shadow)", background: "var(--win-face)" }}>
            <ColHeader label="Name"   style={{ flex: 3 }} onClick={() => {}} />
            <ColHeader label="Type"   style={{ flex: 2 }} onClick={() => {}} />
            <ColHeader label="Status" style={{ flex: 2 }} onClick={() => {}} />
          </div>

          {/* Item list */}
          <div
            className="flex-1 overflow-y-auto win-stagger"
            onClick={(e) => { if (e.target === e.currentTarget) setSelected(null); }}
          >
            {view.kind === "my-computer" && runtimes.length > 0 && (
              <WorkspaceSummary runtimes={runtimes} recentsCount={recents.length} />
            )}
            {items.length === 0 && (
              <div className="flex items-center justify-center h-full italic" style={{ color: "var(--win-shadow)" }}>
                {view.kind === "active-sessions" ? "No active sessions." : "This folder is empty."}
              </div>
            )}
            {items.map((item) => (
              <ExplorerRow
                key={item.id}
                item={item}
                selected={selected === item.id}
                onSelect={() => setSelected(item.id)}
                onActivate={() => onActivate(item)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Status bar */}
      <Win95StatusBar>
        <Win95StatusPanel className="flex-1">
          {items.length} object{items.length !== 1 ? "s" : ""}
          {view.kind === "active-sessions" && runningCount > 0 && ` (${runningCount} running)`}
        </Win95StatusPanel>
        {selected && (
          <Win95StatusPanel style={{ minWidth: 120 }}>
            {items.find((i) => i.id === selected)?.name ?? ""}
          </Win95StatusPanel>
        )}
      </Win95StatusBar>
    </div>
  );
}

// ─── Column header ────────────────────────────────────────────────────────────

function ColHeader({ label, style, onClick }: { label: string; style?: React.CSSProperties; onClick?: () => void }) {
  return (
    <button
      className="px-2 flex items-center truncate cursor-default border-0 active:translate-y-[1px]"
      onClick={onClick}
      style={{ 
        height: "100%", 
        boxShadow: "var(--bevel-raised)", 
        fontSize: "var(--win-font-size)", 
        background: "var(--win-face)",
        textAlign: "left",
        ...style 
      }}
    >
      {label}
    </button>
  );
}

// ─── Explorer row ─────────────────────────────────────────────────────────────

function ExplorerRow({
  item, selected, onSelect, onActivate,
}: {
  item: DisplayItem;
  selected: boolean;
  onSelect: () => void;
  onActivate: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center cursor-default select-none group",
        selected ? "bg-[var(--win-select-bg)] text-[var(--win-select-text)]" : "hover:bg-[rgba(0,0,0,0.03)]"
      )}
      style={{
        height: 24, // Increased from 20 for better touch hit-rates
        fontSize: "var(--win-font-size)",
      }}
      onClick={() => {
        if (selected) {
          // Adaptive logic: If already selected, a second click/tap acts as activation on mobile
          // This preserves Win95 legitimacy while enabling touch survivability
          onActivate();
        } else {
          onSelect();
        }
      }}
      onDoubleClick={onActivate}
    >
      {/* Name */}
      <div className="flex items-center gap-1 px-1 truncate relative" style={{ flex: 3, height: "100%" }}>
        {selected && (
          <div className="absolute inset-0 pointer-events-none" 
            style={{ border: "1px dotted white", opacity: 0.4, margin: "1px" }} 
          />
        )}
        {item.iconSrc
          ? <img src={item.iconSrc} width={16} height={16} alt="" style={{ imageRendering: "pixelated", flexShrink: 0 }} />
          : <span style={{ width: 16, flexShrink: 0, textAlign: "center" }}>□</span>
        }
        <span className="truncate">{item.name}</span>
      </div>
      {/* Type */}
      <div className="px-2 flex items-center truncate" style={{ flex: 2, height: "100%" }}>
        {itemTypeName(item)}
      </div>
      {/* Status */}
      <div className="px-2 flex items-center gap-1" style={{ flex: 2, height: "100%" }}>
        {itemStatus(item)}
      </div>
    </div>
  );
}

function itemTypeName(item: DisplayItem): ReactNode {
  if (item.kind === "recent") {
    return <span style={{ color: "var(--win-shadow)" }}>Recent Document</span>;
  }
  if (item.kind === "runtime") {
    return item.subtitle
      ? <span className="truncate" style={{ fontStyle: "italic", color: "var(--win-shadow)" }}>{item.subtitle}</span>
      : "Runtime Session";
  }
  switch (item.kind) {
    case "vfolder":  return "File Folder";
    case "vfile":    return item.typeName;
    case "vapp":     return "Application";
  }
}

function atmosphericTime(openedAt: number | undefined): string {
  if (!openedAt) return "";
  const diffMs  = Date.now() - openedAt;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1)  return "current";
  if (diffMin < 15) return "active";
  if (diffMin < 60) return "stable";
  if (diffMin < 1440) return "persistent";
  return "historical";
}

function itemStatus(item: DisplayItem): ReactNode {
  if (item.kind === "recent") {
    return <span style={{ color: "var(--win-shadow)", fontSize: "9px", opacity: 0.8 }}>{atmosphericTime(item.lastOpenedAt)}</span>;
  }
  if (item.kind !== "runtime") return null;
  const timeHint = atmosphericTime(item.openedAt);
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex items-center gap-1 min-w-[32px]">
        {!item.isMinimized && (
          <motion.div 
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
            style={{ width: 3, height: 3, background: "#00cc00" }}
          />
        )}
        <span style={{ fontSize: "10px", opacity: item.isMinimized ? 0.5 : 1 }}>
          {item.isMinimized ? "Suspended" : "Live"}
        </span>
      </div>
      {item.dirty   && <span title="Unsaved changes" style={{ color: "#ff0000", fontSize: 10, lineHeight: 1 }}>●</span>}
      {item.playing && <span title="Playing"         style={{ color: "var(--win-title-active)", fontSize: 8, lineHeight: 1 }}>▶</span>}
      {timeHint && (
        <span className="truncate ml-auto" style={{ color: "var(--win-shadow)", fontSize: "9px", opacity: 0.7 }}>{timeHint}</span>
      )}
    </div>
  );
}

// ─── Workspace summary ────────────────────────────────────────────────────────

function WorkspaceSummary({ runtimes, recentsCount }: { runtimes: RuntimeSnapshot[], recentsCount: number }) {
  const running  = runtimes.filter((r) => !r.isMinimized).length;
  const dirty    = runtimes.filter((r) => r.activity?.dirty).length;
  const nowPlaying = runtimes.find((r) => r.playback?.isPlaying);

  const parts: string[] = [];
  if (running > 0) parts.push(`${running} session${running !== 1 ? "s" : ""} live`);
  if (dirty > 0)   parts.push(`${dirty} unsaved`);
  if (recentsCount > 0) parts.push(`${recentsCount} recent artifact${recentsCount !== 1 ? "s" : ""}`);
  if (nowPlaying)  parts.push(`▶ ${nowPlaying.subtitle ?? nowPlaying.title}`);

  return (
    <div
      className="flex items-center gap-3 px-2 select-none"
      style={{
        height: 18,
        borderBottom: "1px solid var(--win-shadow)",
        background: "var(--win-face)",
        color: "var(--win-shadow)",
        fontSize: "var(--win-font-size)",
        flexShrink: 0,
        opacity: 0.9
      }}
    >
      <span className="font-bold" style={{ color: "var(--win-shadow)", fontSize: "9px", opacity: 0.8, marginRight: -4 }}>WORK AREA:</span>
      {parts.length > 0 ? parts.join("  ·  ") : "Ambient state: quiet"}
    </div>
  );
}
// ─── Sidebar Item ─────────────────────────────────────────────────────────────

function SidebarItem({ label, icon, active, onClick }: { label: string; icon: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      className={cn(
        "flex items-center gap-1 px-1 py-[1px] w-full text-left truncate border border-transparent transition-colors duration-75",
        active ? "bg-[var(--win-select-bg)] text-white" : "hover:bg-[rgba(0,0,0,0.03)]"
      )}
      style={{ 
        fontSize: "var(--win-font-size)", 
        outline: active ? "1px dotted white" : undefined, 
        outlineOffset: -3,
        height: "18px",
        transform: active ? "translateY(1px)" : "none"
      }}
      onClick={onClick}
    >
      <img src={iconSrc(icon)} width={14} height={14} alt="" style={{ imageRendering: "pixelated", flexShrink: 0, opacity: active ? 1 : 0.8 }} />
      <span className={cn("truncate", active && "font-bold")} style={{ letterSpacing: "-0.01em" }}>{label}</span>
    </button>
  );
}
