"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import type { ReactNode } from "react";
import { type VFSNode, type AppType, type WindowData } from "@/lib/os-config";
import { Win95StatusBar, Win95StatusPanel } from "../Win95Window";
import { Win95MenuBar, Win95MenuDropdown, Win95MenuAction, Win95MenuSeparator } from "../Win95Menu";
import { resolveWin95Icon } from "@/lib/icon-map";
import Win95ContextMenu, { type ContextMenuEntry } from "../Win95ContextMenu";

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

function iconSrc(emoji: string, size: 16 | 32 = 16): string {
  return resolveWin95Icon(emoji, size) ?? "";
}

/** Format a VFS node's modifiedAt timestamp in canonical Win95 format: MM/DD/YY HH:MM AM */
function formatModifiedDate(item: DisplayItem): string {
  let timestamp: number | undefined;
  if (item.kind === "vfile" || item.kind === "vapp") {
    timestamp = item.node.modifiedAt || item.node.createdAt;
  } else if (item.kind === "vfolder" && "view" in item && item.view.kind === "vfs") {
    timestamp = item.view.node.modifiedAt || item.view.node.createdAt;
  }
  if (!timestamp) return "";
  const d = new Date(timestamp);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const year = String(d.getFullYear()).slice(-2);
  const hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  const h12 = hours % 12 || 12;
  return `${month}/${day}/${year} ${h12}:${minutes} ${ampm}`;
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
  onActivityChange?: (state: { subtitle?: string; dirty?: boolean }) => void;
  onUpdateVFS?: (updater: (prev: VFSNode[]) => VFSNode[]) => void;
}

export default function Explorer({ vfs, initialData, runtimes, recents, onOpenNode, onFocusWindow, onDataChange, onActivityChange, onUpdateVFS }: ExplorerProps) {
  const [view, setView]       = useState<ExplorerView>(() => resolveInitialView(initialData, vfs));
  const [history, setHistory] = useState<ExplorerView[]>(() => resolveInitialHistory(initialData, vfs));
  const [selected, setSelected] = useState<string | null>(null);

  // Clipboard state for Cut/Copy/Paste operations
  const [clipboard, setClipboard] = useState<{ id: string; mode: "cut" | "copy" } | null>(null);

  // View mode: "icon-grid" = My Computer style (large icons, no tree pane)
  //            "tree-list" = Windows Explorer style (split pane with tree + contents list)
  // Determined by how the window was opened. My Computer desktop icon passes
  // a VFSNode with id "desktop-mycomputer"; Start → Windows Explorer passes nothing.
  const [viewMode] = useState<"icon-grid" | "tree-list">(() => {
    if (initialData && typeof initialData === "object" && "id" in initialData) {
      const node = initialData as VFSNode;
      // My Computer opens in icon-grid mode (canonical Win95 behavior)
      if (node.id === "desktop-mycomputer") return "icon-grid";
    }
    return "tree-list";
  });

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

  const myDocs = useMemo(() => findNode("desktop-docs", vfs), [vfs]);

  const items = useMemo<DisplayItem[]>(() => {
    if (view.kind === "my-computer") {
      // Canonical Win95 "My Computer" shows disk drives and system folders.
      // In Specimen, this maps to VFS root folders (My Documents, etc.)
      // Exclude "My Computer" itself to prevent circular navigation.
      const vfsFolders: DisplayItem[] = vfs
        .filter(n => n.type === "folder" && n.id !== "desktop-trash" && n.id !== "desktop-mycomputer")
        .map(n => ({
          kind: "vfolder" as const,
          id: n.id,
          name: n.name,
          iconSrc: iconSrc(n.icon, 32),
          view: { kind: "vfs" as const, node: n },
        }));
      return vfsFolders;
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
  }, [view, runtimes, myDocs, vfs, recents]);

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

  // Canonical Win95 Explorer title: "Exploring - {folder name}"
  const titleLabel = getViewLabel(view);

  // Emit activity subtitle when view changes — updates window title bar
  useEffect(() => {
    const label = getViewLabel(view);
    onActivityChange?.({ subtitle: label });
  }, [view]);

  // Display mode: canonical Win95 View menu options
  type DisplayMode = "large-icons" | "small-icons" | "list" | "details";
  const [displayMode, setDisplayMode] = useState<DisplayMode>(
    viewMode === "icon-grid" ? "large-icons" : "list"
  );

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuEntry[] } | null>(null);

  const handleNewFolder = useCallback(() => {
    if (!onUpdateVFS) return;
    const newFolder: VFSNode = {
      id: `folder-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      name: "New Folder",
      type: "folder",
      icon: "📁",
      children: [],
      createdAt: Date.now(),
      modifiedAt: Date.now(),
    };

    if (view.kind === "vfs" && view.node.children) {
      onUpdateVFS((prev) => {
        const addToNode = (nodes: VFSNode[], parentId: string): VFSNode[] =>
          nodes.map(n => {
            if (n.id === parentId) return { ...n, children: [...(n.children || []), newFolder], modifiedAt: Date.now() };
            if (n.children) return { ...n, children: addToNode(n.children, parentId) };
            return n;
          });
        return addToNode(prev, view.node.id);
      });
    } else if (view.kind === "my-computer" || view.kind === "desktop") {
      onUpdateVFS((prev) => [...prev, newFolder]);
    }
    setContextMenu(null);
  }, [view, onUpdateVFS]);

  const handleDelete = useCallback((itemId: string) => {
    if (!onUpdateVFS) return;
    onUpdateVFS((prev) => {
      const removeFromNodes = (nodes: VFSNode[]): VFSNode[] =>
        nodes.filter(n => n.id !== itemId).map(n =>
          n.children ? { ...n, children: removeFromNodes(n.children) } : n
        );
      return removeFromNodes(prev);
    });
    setSelected(null);
    setContextMenu(null);
  }, [onUpdateVFS]);

  const handleRename = useCallback((itemId: string) => {
    const item = items.find(i => i.id === itemId);
    if (!item || !onUpdateVFS) return;
    const newName = window.prompt("Rename", item.name);
    if (!newName || newName === item.name) return;

    onUpdateVFS((prev) => {
      const renameInNodes = (nodes: VFSNode[]): VFSNode[] =>
        nodes.map(n => {
          if (n.id === itemId) return { ...n, name: newName, modifiedAt: Date.now() };
          if (n.children) return { ...n, children: renameInNodes(n.children) };
          return n;
        });
      return renameInNodes(prev);
    });
    setContextMenu(null);
  }, [items, onUpdateVFS]);

  const handleCut = useCallback((itemId: string) => {
    setClipboard({ id: itemId, mode: "cut" });
    setContextMenu(null);
  }, []);

  const handleCopy = useCallback((itemId: string) => {
    setClipboard({ id: itemId, mode: "copy" });
    setContextMenu(null);
  }, []);

  const handlePaste = useCallback(() => {
    if (!clipboard || !onUpdateVFS) return;
    const sourceNode = findNode(clipboard.id, vfs);
    if (!sourceNode) { setClipboard(null); return; }

    // Create a copy of the node with new ID
    const clonedNode: VFSNode = {
      ...sourceNode,
      id: `${sourceNode.id}-copy-${Date.now()}`,
      name: clipboard.mode === "copy" ? `Copy of ${sourceNode.name}` : sourceNode.name,
      modifiedAt: Date.now(),
    };

    // Insert into current folder
    if (view.kind === "vfs" && view.node.children) {
      onUpdateVFS((prev) => {
        const addToNode = (nodes: VFSNode[], parentId: string): VFSNode[] =>
          nodes.map(n => {
            if (n.id === parentId) return { ...n, children: [...(n.children || []), clonedNode], modifiedAt: Date.now() };
            if (n.children) return { ...n, children: addToNode(n.children, parentId) };
            return n;
          });
        return addToNode(prev, view.node.id);
      });
    } else {
      onUpdateVFS((prev) => [...prev, clonedNode]);
    }

    // If cut, remove original
    if (clipboard.mode === "cut") {
      onUpdateVFS((prev) => {
        const removeFromNodes = (nodes: VFSNode[]): VFSNode[] =>
          nodes.filter(n => n.id !== clipboard.id).map(n =>
            n.children ? { ...n, children: removeFromNodes(n.children) } : n
          );
        return removeFromNodes(prev);
      });
    }

    setClipboard(null);
    setContextMenu(null);
  }, [clipboard, vfs, view, onUpdateVFS]);

  const handleContextMenu = useCallback((e: React.MouseEvent, item?: DisplayItem) => {
    e.preventDefault();
    e.stopPropagation();

    const menuItems: ContextMenuEntry[] = item
      ? [
          { label: "Open", bold: true, onClick: () => item && onActivate(item) },
          ...(item.kind === "vfolder" ? [{ label: "Explore", onClick: () => item && onActivate(item) }] : []),
          { separator: true as const },
          { label: "Cut", onClick: () => handleCut(item.id) },
          { label: "Copy", onClick: () => handleCopy(item.id) },
          { separator: true as const },
          { label: "Delete", onClick: () => handleDelete(item.id) },
          { label: "Rename", onClick: () => handleRename(item.id) },
          { separator: true as const },
          { label: "Properties", disabled: true },
        ]
      : [
          { label: "View", disabled: true },
          { label: "Arrange Icons", disabled: true },
          { separator: true as const },
          { label: "Paste", disabled: !clipboard, onClick: () => handlePaste() },
          { separator: true as const },
          { label: "New Folder", onClick: () => handleNewFolder() },
          { separator: true as const },
          { label: "Properties", disabled: true },
        ];

    setContextMenu({ x: e.clientX, y: e.clientY, items: menuItems });
  }, [handleDelete, handleRename, handleNewFolder, handleCut, handleCopy, handlePaste, clipboard]);

  // Menu bar state
  type MenuKey = "file" | "edit" | "view" | "help" | null;
  const [activeMenu, setActiveMenu] = useState<MenuKey>(null);
  const handleMenuClick = (menu: MenuKey) => setActiveMenu(activeMenu === menu ? null : menu);
  const handleMenuHover = (menu: MenuKey) => { if (activeMenu) setActiveMenu(menu); };
  const closeMenus = () => setActiveMenu(null);

  // Keyboard shortcuts — canonical Win95 Explorer behavior
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // F2 = Rename selected item
      if (e.key === "F2" && selected) {
        e.preventDefault();
        handleRename(selected);
      }
      // Delete = Delete selected item
      if (e.key === "Delete" && selected) {
        e.preventDefault();
        handleDelete(selected);
      }
      // Backspace = Go to parent folder
      if (e.key === "Backspace") {
        e.preventDefault();
        goUp();
      }
      // Enter = Open/activate selected item
      if (e.key === "Enter" && selected) {
        e.preventDefault();
        const item = items.find(i => i.id === selected);
        if (item) onActivate(item);
      }
      // Ctrl+X = Cut
      if (e.ctrlKey && e.key === "x" && selected) {
        e.preventDefault();
        handleCut(selected);
      }
      // Ctrl+C = Copy
      if (e.ctrlKey && e.key === "c" && selected) {
        e.preventDefault();
        handleCopy(selected);
      }
      // Ctrl+V = Paste
      if (e.ctrlKey && e.key === "v") {
        e.preventDefault();
        handlePaste();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selected, items, goUp, handleRename, handleDelete, handleCut, handleCopy, handlePaste]);

  // Build tree data for the left pane — handled by TreeNode component below
  const handleTreeSelect = (id: string) => {
    if (id === "__desktop__") navigate({ kind: "desktop" });
    else if (id === "__mycomputer__") navigate({ kind: "my-computer" });
    else {
      const node = findNode(id, vfs);
      if (node) navigate({ kind: "vfs", node });
    }
  };

  return (
    <div className="flex flex-col h-full select-none" style={{ background: "var(--win-face)", fontFamily: "var(--font-shell)", fontSize: "var(--win-font-size)" }}>

      {/* Menu Bar — canonical Win95: File / Edit / View / Help (functional dropdowns) */}
      <Win95MenuBar>
        <Win95MenuDropdown
          label="File"
          isOpen={activeMenu === "file"}
          onOpen={() => handleMenuClick("file")}
          onHover={() => handleMenuHover("file")}
        >
          <Win95MenuAction label="New Folder" onClick={() => { handleNewFolder(); closeMenus(); }} />
          <Win95MenuSeparator />
          <Win95MenuAction label="Delete" disabled={!selected} onClick={() => { if (selected) handleDelete(selected); closeMenus(); }} />
          <Win95MenuAction label="Rename" disabled={!selected} onClick={() => { if (selected) handleRename(selected); closeMenus(); }} />
          <Win95MenuSeparator />
          <Win95MenuAction label="Properties" disabled />
          <Win95MenuSeparator />
          <Win95MenuAction label="Close" onClick={() => closeMenus()} />
        </Win95MenuDropdown>

        <Win95MenuDropdown
          label="Edit"
          isOpen={activeMenu === "edit"}
          onOpen={() => handleMenuClick("edit")}
          onHover={() => handleMenuHover("edit")}
        >
          <Win95MenuAction label="Cut" shortcut="Ctrl+X" disabled={!selected} onClick={() => { if (selected) handleCut(selected); closeMenus(); }} />
          <Win95MenuAction label="Copy" shortcut="Ctrl+C" disabled={!selected} onClick={() => { if (selected) handleCopy(selected); closeMenus(); }} />
          <Win95MenuAction label="Paste" shortcut="Ctrl+V" disabled={!clipboard} onClick={() => { handlePaste(); closeMenus(); }} />
          <Win95MenuSeparator />
          <Win95MenuAction label="Select All" shortcut="Ctrl+A" disabled />
        </Win95MenuDropdown>

        <Win95MenuDropdown
          label="View"
          isOpen={activeMenu === "view"}
          onOpen={() => handleMenuClick("view")}
          onHover={() => handleMenuHover("view")}
        >
          <Win95MenuAction label="Large Icons" checked={displayMode === "large-icons"} onClick={() => { setDisplayMode("large-icons"); closeMenus(); }} />
          <Win95MenuAction label="Small Icons" checked={displayMode === "small-icons"} onClick={() => { setDisplayMode("small-icons"); closeMenus(); }} />
          <Win95MenuAction label="List" checked={displayMode === "list"} onClick={() => { setDisplayMode("list"); closeMenus(); }} />
          <Win95MenuAction label="Details" checked={displayMode === "details"} onClick={() => { setDisplayMode("details"); closeMenus(); }} />
          <Win95MenuSeparator />
          <Win95MenuAction label="Refresh" onClick={() => closeMenus()} />
        </Win95MenuDropdown>

        <Win95MenuDropdown
          label="Help"
          isOpen={activeMenu === "help"}
          onOpen={() => handleMenuClick("help")}
          onHover={() => handleMenuHover("help")}
        >
          <Win95MenuAction label="Help Topics" disabled />
          <Win95MenuSeparator />
          <Win95MenuAction label="About Specimen 95" disabled />
        </Win95MenuDropdown>
      </Win95MenuBar>

      {/* Global menu close trigger */}
      {activeMenu && <div className="fixed inset-0 z-40" onMouseDown={closeMenus} />}

      {/* Content area — mode-dependent layout */}
      {viewMode === "icon-grid" ? (
        /* ═══ MY COMPUTER MODE: No tree pane, content fills entire area ═══ */
        <div
          className="flex-1 overflow-y-auto"
          style={{
            background: "var(--win-window)",
            boxShadow: "var(--bevel-sunken)",
            margin: 2,
            padding: displayMode === "large-icons" ? "8px 0" : "2px",
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setSelected(null); }} onContextMenu={(e) => handleContextMenu(e)}
        >
          <ContentArea items={items} displayMode={displayMode} selected={selected} onSelect={setSelected} onActivate={onActivate} onContextMenu={handleContextMenu} />
        </div>
      ) : (
        /* ═══ EXPLORER MODE: Split pane (tree left + contents right) ═══
           Canonical Win95 "Exploring - ..." window with "All Folders"
           tree view on the left and "Contents of..." list on the right. */
        <div className="flex-1 flex overflow-hidden">

          {/* Left pane: "All Folders" — custom TreeNode for canonical rendering */}
          <div
            className="flex flex-col overflow-hidden"
            style={{ width: 220, flexShrink: 0, borderRight: "1px solid var(--win-shadow)" }}
          >
            <div
              className="flex items-center px-1 select-none"
              style={{
                height: 20,
                background: "var(--win-face)",
                boxShadow: "var(--bevel-sunken)",
                margin: 2,
                marginBottom: 0,
              }}
            >
              All Folders
            </div>

            <div
              className="flex-1 overflow-auto"
              style={{
                background: "var(--win-window)",
                boxShadow: "var(--bevel-sunken)",
                margin: 2,
                padding: "2px 4px",
              }}
            >
              <TreeNode
                id="__desktop__"
                label="Desktop"
                icon="🗂️"
                active={view.kind === "desktop"}
                onSelect={handleTreeSelect}
                depth={0}
              >
                <TreeNode
                  id="__mycomputer__"
                  label="My Computer"
                  icon="🖥️"
                  active={view.kind === "my-computer"}
                  onSelect={handleTreeSelect}
                  depth={1}
                >
                  {vfs.filter(n => n.type === "folder" && n.id !== "desktop-mycomputer" && n.id !== "desktop-trash").map((node) => (
                    <TreeNode
                      key={node.id}
                      id={node.id}
                      label={node.name}
                      icon={node.icon}
                      active={view.kind === "vfs" && view.node.id === node.id}
                      onSelect={handleTreeSelect}
                      depth={2}
                    />
                  ))}
                </TreeNode>
                <TreeNode
                  id="__recyclebin__"
                  label="Recycle Bin"
                  icon="🗑️"
                  active={false}
                  onSelect={handleTreeSelect}
                  depth={1}
                />
              </TreeNode>
            </div>
          </div>

          {/* Right pane: "Contents of..." */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div
              className="flex items-center px-1 select-none"
              style={{
                height: 20,
                background: "var(--win-face)",
                boxShadow: "var(--bevel-sunken)",
                margin: 2,
                marginBottom: 0,
              }}
            >
              Contents of &apos;{titleLabel}&apos;
            </div>

            <div
              className="flex-1 overflow-y-auto"
              style={{
                background: "var(--win-window)",
                boxShadow: "var(--bevel-sunken)",
                margin: 2,
                padding: displayMode === "large-icons" ? "8px 0" : "2px",
              }}
              onClick={(e) => { if (e.target === e.currentTarget) setSelected(null); }} onContextMenu={(e) => handleContextMenu(e)}
            >
              <ContentArea items={items} displayMode={displayMode} selected={selected} onSelect={setSelected} onActivate={onActivate} onContextMenu={handleContextMenu} />
            </div>
          </div>
        </div>
      )}

      {/* Context Menu — rendered as fixed overlay */}
      {contextMenu && (
        <Win95ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Status bar — canonical Win95: "N object(s)" | optional size info */}
      <Win95StatusBar>
        <Win95StatusPanel className="flex-1">
          {selected
            ? "1 object(s) selected"
            : `${items.length} object${items.length !== 1 ? "s" : ""}`}
        </Win95StatusPanel>
        {view.kind === "vfs" && (
          <Win95StatusPanel style={{ minWidth: 140 }}>
            {items.filter(i => i.kind === "vfolder").length} folder(s)
          </Win95StatusPanel>
        )}
      </Win95StatusBar>
    </div>
  );
}

// ─── Icon Tile (My Computer icon grid mode) ───────────────────────────────────
// Canonical Win95 large icon tile: 48x48 icon area (32x32 icon centered),
// label below (centered, wrapping). Selection = dithered navy overlay on icon
// + navy bg on label with dotted outline. Grid cell width 116px per snippet.

function IconTile({
  item, selected, onSelect, onActivate,
}: {
  item: DisplayItem;
  selected: boolean;
  onSelect: () => void;
  onActivate: () => void;
}) {
  const iconSrc32 = item.iconSrc
    ? item.iconSrc.replace("_16x16_", "_32x32_")
    : "";

  return (
    <div
      className="flex flex-col items-center cursor-default select-none"
      style={{ width: 116, padding: "4px 0" }}
      onClick={() => { if (selected) onActivate(); else onSelect(); }}
      onDoubleClick={onActivate}
    >
      {/* Icon area — 48x48 container, 32x32 icon centered */}
      <div
        className="flex items-center justify-center relative"
        style={{ width: 48, height: 48, marginBottom: 6 }}
      >
        {iconSrc32 ? (
          <img
            src={iconSrc32}
            width={32}
            height={32}
            alt=""
            style={{ imageRendering: "pixelated" }}
            onError={(e) => {
              const fallback = item.iconSrc;
              if (fallback && e.currentTarget.src !== fallback) {
                e.currentTarget.src = fallback;
                e.currentTarget.width = 32;
                e.currentTarget.height = 32;
              }
            }}
          />
        ) : (
          <span style={{ fontSize: 24 }}>□</span>
        )}
        {selected && (
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              background: "var(--win-select-bg)",
              opacity: 0.45,
              mixBlendMode: "multiply",
            }}
          />
        )}
      </div>
      {/* Label — canonical Win95 selection: navy bg, white text, 1.5px dotted border */}
      <span
        className="text-center break-words"
        style={{
          padding: "1px 2px",
          maxWidth: "100%",
          fontFamily: "var(--font-shell)",
          fontSize: "var(--win-font-size)",
          lineHeight: 1.3,
          background: selected ? "var(--win-select-bg)" : "transparent",
          color: selected ? "var(--win-select-text)" : "var(--win-text)",
          border: selected ? "1.5px dotted var(--win-highlight)" : "1.5px solid transparent",
        }}
      >
        {item.name}
      </span>
    </div>
  );
}

// ─── Tree Node (Explorer left pane — canonical Win95 tree) ───────────────────

function TreeNode({
  id, label, icon, active, onSelect, depth, children,
}: {
  id: string;
  label: string;
  icon: string;
  active?: boolean;
  onSelect: (id: string) => void;
  depth: number;
  children?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = !!children;

  return (
    <div style={{ paddingLeft: depth > 0 ? 18 : 0, position: "relative" }}>
      {/* Dotted connector lines — canonical Win95 tree */}
      {depth > 0 && (
        <>
          <div
            aria-hidden
            style={{
              position: "absolute",
              top: 0,
              left: 8,
              height: hasChildren && expanded ? "100%" : 10,
              borderLeft: "1px dotted var(--win-shadow)",
            }}
          />
          <div
            aria-hidden
            style={{
              position: "absolute",
              top: 10,
              left: 8,
              width: 9,
              borderTop: "1px dotted var(--win-shadow)",
            }}
          />
        </>
      )}

      <div className="flex items-center" style={{ height: 20, position: "relative" }}>
        {/* +/- toggle box */}
        {hasChildren && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            style={{
              position: "absolute",
              left: depth > 0 ? 3 : -11,
              top: 5,
              width: 11,
              height: 11,
              background: "var(--win-window)",
              border: "none",
              boxShadow: "inset -1px -1px 0 0 var(--win-shadow), inset 1px 1px 0 0 var(--win-shadow)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              cursor: "default",
            }}
          >
            <div style={{ position: "relative", width: 7, height: 7 }}>
              <div style={{ position: "absolute", left: 0, top: 3, width: 7, height: 1, background: "var(--win-text)" }} />
              {!expanded && (
                <div style={{ position: "absolute", left: 3, top: 0, width: 1, height: 7, background: "var(--win-text)" }} />
              )}
            </div>
          </button>
        )}

        {/* Icon + label */}
        <button
          type="button"
          className="flex items-center gap-1 cursor-default border-0 outline-none truncate"
          style={{
            marginLeft: depth > 0 ? 18 : 4,
            padding: "1px 3px",
            background: active ? "var(--win-select-bg)" : "transparent",
            color: active ? "var(--win-select-text)" : "var(--win-text)",
            fontFamily: "var(--font-shell)",
            fontSize: "var(--win-font-size)",
          }}
          onClick={() => onSelect(id)}
        >
          <img
            src={iconSrc(icon)}
            width={16}
            height={16}
            alt=""
            style={{ imageRendering: "pixelated", flexShrink: 0 }}
          />
          <span className="truncate">{label}</span>
        </button>
      </div>

      {hasChildren && expanded && (
        <div style={{ position: "relative" }}>{children}</div>
      )}
    </div>
  );
}

// ─── Content Row (Right pane — canonical Win95 list view) ─────────────────────
// Canonical Win95 list row: 16x16 icon + 6px gap + label. Height 18-20px.
// Selection: navy bg + white text. Focus: 1px dotted white outline inset.

function ContentRow({
  item, selected, onSelect, onActivate,
}: {
  item: DisplayItem;
  selected: boolean;
  onSelect: () => void;
  onActivate: () => void;
}) {
  return (
    <div
      className="flex items-center cursor-default select-none relative"
      style={{
        height: 18,
        padding: "0 2px",
        background: selected ? "var(--win-select-bg)" : "transparent",
        color: selected ? "var(--win-select-text)" : "var(--win-text)",
        fontFamily: "var(--font-shell)",
        fontSize: "var(--win-font-size)",
      }}
      onClick={() => {
        if (selected) onActivate();
        else onSelect();
      }}
      onDoubleClick={onActivate}
    >
      {/* Dotted focus rectangle — canonical Win95 selection indicator */}
      {selected && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            border: "1px dotted var(--win-highlight)",
            pointerEvents: "none",
            opacity: 0.6,
          }}
        />
      )}
      {item.iconSrc ? (
        <img
          src={item.iconSrc}
          width={16}
          height={16}
          alt=""
          style={{ imageRendering: "pixelated", flexShrink: 0, marginRight: 6 }}
        />
      ) : (
        <span style={{ width: 16, flexShrink: 0, marginRight: 6, textAlign: "center" }}>□</span>
      )}
      <span className="truncate">{item.name}</span>
    </div>
  );
}

// ─── Content Area (renders items based on display mode) ───────────────────────

function ContentArea({
  items, displayMode, selected, onSelect, onActivate, onContextMenu,
}: {
  items: DisplayItem[];
  displayMode: "large-icons" | "small-icons" | "list" | "details";
  selected: string | null;
  onSelect: (id: string | null) => void;
  onActivate: (item: DisplayItem) => void;
  onContextMenu?: (e: React.MouseEvent, item?: DisplayItem) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center h-full" style={{ color: "var(--win-shadow)" }}>
        (Empty)
      </div>
    );
  }

  if (displayMode === "large-icons") {
    return (
      <div
        style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", alignContent: "flex-start" }}
        onContextMenu={(e) => { e.preventDefault(); onContextMenu?.(e); }}
      >
        {items.map((item) => (
          <div key={item.id} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onSelect(item.id); onContextMenu?.(e, item); }}>
            <IconTile item={item} selected={selected === item.id} onSelect={() => onSelect(item.id)} onActivate={() => onActivate(item)} />
          </div>
        ))}
      </div>
    );
  }

  if (displayMode === "small-icons") {
    return (
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", alignContent: "flex-start", gap: "2px 0" }}>
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center cursor-default select-none"
            style={{
              width: 180,
              height: 20,
              padding: "0 4px",
              background: selected === item.id ? "var(--win-select-bg)" : "transparent",
              color: selected === item.id ? "var(--win-select-text)" : "var(--win-text)",
              fontSize: "var(--win-font-size)",
            }}
            onClick={() => { if (selected === item.id) onActivate(item); else onSelect(item.id); }}
            onDoubleClick={() => onActivate(item)}
          >
            {item.iconSrc && <img src={item.iconSrc} width={16} height={16} alt="" style={{ imageRendering: "pixelated", marginRight: 4, flexShrink: 0 }} />}
            <span className="truncate">{item.name}</span>
          </div>
        ))}
      </div>
    );
  }

  if (displayMode === "list") {
    return (
      <div style={{ display: "flex", flexDirection: "column" }}>
        {items.map((item) => (
          <div key={item.id} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onSelect(item.id); onContextMenu?.(e, item); }}>
            <ContentRow item={item} selected={selected === item.id} onSelect={() => onSelect(item.id)} onActivate={() => onActivate(item)} />
          </div>
        ))}
      </div>
    );
  }

  // Details view — canonical Win95 columns: Name, Size, Type, Modified
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {/* Column headers */}
      <div className="flex select-none" style={{ height: 18, background: "var(--win-face)", borderBottom: "1px solid var(--win-shadow)", position: "sticky", top: 0 }}>
        <div style={{ flex: 3, padding: "0 4px", display: "flex", alignItems: "center", boxShadow: "var(--bevel-raised)", fontSize: "var(--win-font-size)" }}>Name</div>
        <div style={{ flex: 1, padding: "0 4px", display: "flex", alignItems: "center", boxShadow: "var(--bevel-raised)", fontSize: "var(--win-font-size)" }}>Size</div>
        <div style={{ flex: 2, padding: "0 4px", display: "flex", alignItems: "center", boxShadow: "var(--bevel-raised)", fontSize: "var(--win-font-size)" }}>Type</div>
        <div style={{ flex: 2, padding: "0 4px", display: "flex", alignItems: "center", boxShadow: "var(--bevel-raised)", fontSize: "var(--win-font-size)" }}>Modified</div>
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          className="flex items-center cursor-default select-none"
          style={{
            height: 18,
            background: selected === item.id ? "var(--win-select-bg)" : "transparent",
            color: selected === item.id ? "var(--win-select-text)" : "var(--win-text)",
            fontSize: "var(--win-font-size)",
          }}
          onClick={() => { if (selected === item.id) onActivate(item); else onSelect(item.id); }}
          onDoubleClick={() => onActivate(item)}
        >
          <div className="flex items-center truncate" style={{ flex: 3, padding: "0 4px" }}>
            {item.iconSrc && <img src={item.iconSrc} width={16} height={16} alt="" style={{ imageRendering: "pixelated", marginRight: 4, flexShrink: 0 }} />}
            <span className="truncate">{item.name}</span>
          </div>
          <div className="truncate" style={{ flex: 1, padding: "0 4px" }}>
            {item.kind === "vfolder" ? "" : "1 KB"}
          </div>
          <div className="truncate" style={{ flex: 2, padding: "0 4px" }}>
            {item.kind === "vfolder" ? "File Folder" : item.kind === "vapp" ? "Application" : item.kind === "vfile" ? item.typeName : "File"}
          </div>
          <div className="truncate" style={{ flex: 2, padding: "0 4px", color: "var(--win-shadow)" }}>
            {formatModifiedDate(item)}
          </div>
        </div>
      ))}
    </div>
  );
}

// End of Explorer component file
