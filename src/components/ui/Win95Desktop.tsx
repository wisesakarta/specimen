"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/style-composer";
import Win95DesktopIcon from "./Win95DesktopIcon";
import Win95BootSequence from "./Win95BootSequence";
import Win95ShutdownSequence from "./Win95ShutdownSequence";
import Win95Window from "./Win95Window";
import { DEFAULT_VFS } from "@/lib/vfs-init";
import { VFSNode, AppType, SOVEREIGN_REGISTRY, WindowData } from "@/lib/os-config";
import { RuntimeConstitution, getLifecycleState, AudioPlaybackState, RuntimeActivityState } from "@/lib/runtime";
import { loadSessionSnapshot, useSessionSave } from "@/hooks/useSessionPersistence";
import { useWindowManager, SPECIMEN_ID } from "@/hooks/useWindowManager";
import type { PersistedRecent } from "@/lib/persistence";
import { DispatchSovereignCitizen, DispatchManagedCitizen, resolveRuntimeSubtitle, extractRuntimeTextPayload } from "@/runtime/runtime-dispatch";
import type { RuntimeSnapshot } from "@/components/ui/apps/Explorer";
import Win95Icon from "./Win95Icon";
import { Notice } from "@/app/page";
import Win95Notification from "./Win95Notification";

import Win95SearchInput from "./Win95SearchInput";
import Win95ShutdownDialog from "./Win95ShutdownDialog";
import DesktopAmbientOverlay from "./DesktopAmbientOverlay";




function updateNodeInTree(nodes: VFSNode[], id: string, updates: Partial<VFSNode>): VFSNode[] {
  return nodes.map(node => {
    if (node.id === id) {
      return { ...node, ...updates };
    }
    if (node.children) {
      return { ...node, children: updateNodeInTree(node.children, id, updates) };
    }
    return node;
  });
}

/**
 * SovereignWindowRuntime
 * Stabilizes callbacks for sovereign applications to prevent render feedback loops.
 */
const SovereignWindowRuntime = ({ 
  win, 
  lifecycle, 
  updateWindowState, 
  closeWindow, 
  minimizeWindow, 
  focusWindow, 
  setVfs, 
  updateRecents,
  handleOpenApp,
  vfs,
  runtimeSnapshots,
  onOpenNode,
  onMaximize,
  runtimeLogs
}: {
  win: WindowState;
  lifecycle: string;
  updateWindowState: (id: string, patch: Partial<WindowState>) => void;
  closeWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  setVfs: React.Dispatch<React.SetStateAction<VFSNode[]>>;
  updateRecents: (id: string, type: AppType, title: string, icon: string, data?: WindowData) => void;
  handleOpenApp: (type: AppType, title?: string, icon?: string, data?: WindowData) => void;
  vfs: VFSNode[];
  runtimeSnapshots: RuntimeSnapshot[];
  onOpenNode: (node: VFSNode) => void;
  onMaximize: () => void;
  runtimeLogs?: string[];
}) => {
  const onActivityChange = useCallback((state: RuntimeActivityState) => {
    updateWindowState(win.id, { activity: state });
  }, [win.id, updateWindowState]);

  const onDataChange = useCallback((data: WindowData) => {
    updateWindowState(win.id, { data });
    setVfs(prev => updateNodeInTree(prev, win.id, { content: extractRuntimeTextPayload(data) }));
    updateRecents(win.id, win.type, win.title, win.icon, data);
  }, [win.id, win.type, win.title, win.icon, updateWindowState, setVfs, updateRecents]);

  const onPositionChange = useCallback((pos: { x: number; y: number }) => {
    updateWindowState(win.id, { position: pos });
  }, [win.id, updateWindowState]);

  const onPlaybackChange = useCallback((state: AudioPlaybackState) => {
    updateWindowState(win.id, { playback: state });
  }, [win.id, updateWindowState]);

  const onClose = useCallback(() => closeWindow(win.id), [win.id, closeWindow]);
  const onMinimize = useCallback(() => minimizeWindow(win.id), [win.id, minimizeWindow]);
  const onFocus = useCallback(() => focusWindow(win.id), [win.id, focusWindow]);
  const handleMaximize = useCallback(() => onMaximize(), [onMaximize]);

  const onOpenApp = useCallback((type: AppType, title?: string, icon?: string, data?: WindowData) => {
    handleOpenApp(type, title, icon, data);
  }, [handleOpenApp]);

  return (
    <DispatchSovereignCitizen
      type={win.type}
      isVisible={lifecycle === "running"}
      onClose={onClose}
      onMinimize={onMinimize}
      onMaximize={handleMaximize}
      onFocus={onFocus}
      onPositionChange={onPositionChange}
      onPlaybackChange={onPlaybackChange}
      onActivityChange={onActivityChange}
      onDataChange={onDataChange}
      initialData={win.data as WindowData}
      vfs={vfs}
      runtimeSnapshots={runtimeSnapshots}
      onOpenNode={onOpenNode}
      onOpenApp={onOpenApp}
      onCloseApp={closeWindow}
      onUpdateVFS={setVfs}
      runtimeLogs={runtimeLogs}
    />
  );
};

/**
 * ManagedWindowRuntime
 * Stabilizes callbacks for managed applications (Explorer, Browser).
 */
const ManagedWindowRuntime = ({
  win,
  vfs,
  recents,
  runtimeSnapshots,
  onOpenNode,
  onFocusWindow,
  updateWindowState
}: {
  win: WindowState;
  vfs: VFSNode[];
  recents: PersistedRecent[];
  runtimeSnapshots: RuntimeSnapshot[];
  onOpenNode: (node: VFSNode) => void;
  onFocusWindow: (id: string) => void;
  updateWindowState: (id: string, patch: Partial<WindowState>) => void;
}) => {
  const onDataChange = useCallback((data: WindowData) => {
    updateWindowState(win.id, { data });
  }, [win.id, updateWindowState]);

  const onActivityChange = useCallback((state: RuntimeActivityState) => {
    updateWindowState(win.id, { activity: state });
  }, [win.id, updateWindowState]);

  return (
    <DispatchManagedCitizen
      type={win.type}
      windowId={win.id}
      windowData={win.data}
      vfs={vfs}
      recents={recents}
      runtimeSnapshots={runtimeSnapshots}
      onOpenNode={onOpenNode}
      onFocusWindow={onFocusWindow}
      onDataChange={onDataChange}
      onActivityChange={onActivityChange}
    />
  );
};


export interface WindowState {
  id: string;
  type: AppType;
  title: string;
  icon: string;
  isOpen: boolean;
  isMinimized: boolean;
  isMaximized: boolean;
  zIndex: number;
  constitution: RuntimeConstitution;
  playback?: AudioPlaybackState;
  activity?: RuntimeActivityState;
  data?: WindowData;
  position?: { x: number; y: number };
  width?: number | string;
  height?: number | string;
  /** Unix timestamp (ms) when this window was first opened. Persisted across reload. */
  openedAt?: number;
}

interface Win95DesktopProps {
  children: React.ReactNode | ((props: { isActive: boolean; onMinimize: () => void }) => React.ReactNode);
  onOpenSpecimen: () => void;
  isSpecimenOpen: boolean;
  onCloseSpecimen: () => void;
  notice: Notice | null;
  // Search Authority
  targetUrl: string;
  onSearchChange: (val: string) => void;
  onAnalyze: () => void;
  isAnalyzing: boolean;
  isDownloading?: boolean;
  isSearchVisible: boolean;
  runtimeLogs?: string[];
}

export default function Win95Desktop({
  children,
  onOpenSpecimen,
  isSpecimenOpen,
  onCloseSpecimen,
  notice,
  targetUrl,
  onSearchChange,
  onAnalyze,
  isAnalyzing,
  isDownloading,
  isSearchVisible,
  runtimeLogs,
}: Win95DesktopProps) {
  // --- Session Persistence: Load ---
  // Lazy initialization ensures deterministic, synchronous state hydration.
  const [sessionSeed] = useState(loadSessionSnapshot);

  const {
    windows,
    activeWindowId,
    setActiveWindowId,
    maxZIndex,

    recents,
    openWindow,
    closeWindow,
    minimizeWindow,
    toggleMaximize,
    toggleMinimize,
    focusWindow,
    updateWindowState,
    updateRecents,
  } = useWindowManager(sessionSeed);

  // Sync isSpecimenOpen with window manager (only for opening; closing is handled via onCloseSpecimen)
  useEffect(() => {
    if (isSpecimenOpen && !windows.some(w => w.id === SPECIMEN_ID)) {
      openWindow(SPECIMEN_ID, "SPECIMEN", "Specimen Analyzer", "🔍", null);
    }
  }, [isSpecimenOpen, windows, openWindow]);

  const [vfs, setVfs] = useState<VFSNode[]>(sessionSeed.vfs);
  const [currentTime, setCurrentTime] = useState<Date | null>(null);
  const [bootStatus, setBootStatus] = useState<"booting" | "ready">("booting");
  const handleBootComplete = useCallback(() => {
    console.log("SPECIMEN: Boot Sequence Complete. Initializing GUI...");
    setBootStatus("ready");
  }, []);
  const [isShuttingDown, setIsShuttingDown] = useState(false);
  const [shutdownMode, setShutdownMode] = useState<"shutdown" | "restart">("shutdown");
  const [isShutdownDialogOpen, setIsShutdownDialogOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isStartMenuOpen, setIsStartMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const desktopRef = useRef<HTMLDivElement>(null);

  // --- Session Persistence: Save ---
  // Canonical debounced save effect governing all environmental mutations.
  useSessionSave({ windows, vfs, recents, mounted });

  // Hydration gate + environment detection + clock
  useEffect(() => {
    setMounted(true);
    setCurrentTime(new Date());

    const checkMobile = () => {
      setIsMobile(window.innerWidth < 640);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);

    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => {
      window.removeEventListener("resize", checkMobile);
      clearInterval(timer);
    };
  }, []);

  const handleOpenApp = useCallback((type: AppType, title?: string, icon?: string, data?: WindowData) => {
    setIsStartMenuOpen(false);
    // Generate a reasonably unique ID for procedural spawning
    const id = `${type.toLowerCase()}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    
    // Icon Authority: Use provided icon, or registry default, or generic fallback
    const finalIcon = icon || SOVEREIGN_REGISTRY[type]?.defaultIcon || "⚙️";
    const finalTitle = title || type;

    openWindow(id, type, finalTitle, finalIcon, data);
  }, [openWindow]);

  const handleOpenNode = (node: VFSNode) => {
    if (!node) {
      console.warn("SPECIMEN: Attempted to open undefined VFSNode. Launch aborted.");
      return;
    }
    setIsStartMenuOpen(false);
    if (node.type === "folder") {
      openWindow(node.id, "EXPLORER", node.name, node.icon, node);
    } else if (node.appType) {
      if (node.appType === "SPECIMEN") {
        onOpenSpecimen();
        openWindow(SPECIMEN_ID, "SPECIMEN", "Specimen Analyzer", "🔍", null);
      } else {
        openWindow(node.id, node.appType, node.name, node.icon, node.content || node);
      }
    } else if (node.name.toLowerCase().endsWith(".wsz")) {
      // Skin projection logic: Find an existing Webamp or open a new one with this skin
      const webamp = windows.find(w => w.type === "WEBAMP");
      const skinUrl = node.metadata?.skinUrl as string | undefined;
      
      if (webamp) {
        // Project skin into existing instance
        updateWindowState(webamp.id, { data: skinUrl });
        focusWindow(webamp.id);
      } else {
        // Open new Webamp with this skin
        openWindow("webamp-instance", "WEBAMP", "Webamp", "📻", skinUrl);
      }
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  return (
    <div className={cn("fixed inset-0 win-desktop flex flex-col overflow-hidden select-none", (isAnalyzing || isDownloading) && "cursor-wait")}>
      <DesktopAmbientOverlay />
      
      {/* Desktop Area — Acts as the spatial root for all citizens */}
      <div 
        ref={desktopRef}
        className="flex-1 relative overflow-hidden"
        onClick={(e) => {
            setIsStartMenuOpen(false);
            if (e.target === e.currentTarget) {
                setActiveWindowId(null);
            }
        }}
      >
        {/* Desktop Layer: Contains Icons and Grid logic */}
        <div 
          className="absolute inset-0 p-4 grid grid-flow-col grid-rows-[repeat(auto-fill,100px)] gap-4 items-start justify-start content-start z-0"
        >
          {bootStatus === "ready" && !isShuttingDown && vfs.map((node) => (
              <Win95DesktopIcon
                  key={node.id}
                  label={node.name}
                  icon={node.icon}
                  onDoubleClick={() => handleOpenNode(node)}
                  active={activeWindowId === node.id}
              />
          ))}
        </div>

        {/* Window Management Layer: Zero-padding, absolute positioning */}
        <div className="absolute inset-0 pointer-events-none z-10">
        <AnimatePresence>
          {bootStatus === "ready" && !isShuttingDown && windows.map((win, i) => {
            const lifecycle = getLifecycleState(win);
            if (lifecycle === "closed") return null;

            // Sovereign Citizens — suspended runtime stays mounted; visibility is CSS-controlled.
            if (win.constitution === "sovereign") {
              const spatial = SOVEREIGN_REGISTRY[win.type]?.spatial ?? "full";
              const isFullSovereign = win.constitution === "sovereign" && SOVEREIGN_REGISTRY[win.type]?.spatial === "full";

              const runtime = (
                <SovereignWindowRuntime
                  win={win}
                  lifecycle={lifecycle}
                  updateWindowState={updateWindowState}
                  closeWindow={closeWindow}
                  minimizeWindow={minimizeWindow}
                  focusWindow={focusWindow}
                  setVfs={setVfs}
                  updateRecents={updateRecents}
                  handleOpenApp={handleOpenApp}
                  vfs={vfs}
                  runtimeSnapshots={windows
                    .filter((w) => w.id !== win.id)
                    .sort((a, b) => b.zIndex - a.zIndex)
                    .map((w) => ({
                      id:          w.id,
                      type:        w.type,
                      title:       w.title,
                      icon:        w.icon,
                      isMinimized: w.isMinimized,
                      activity:    w.activity,
                      playback:    w.playback,
                      subtitle:    resolveRuntimeSubtitle(w),
                      openedAt:    w.openedAt,
                    }))}
                  onOpenNode={handleOpenNode}
                  onMaximize={() => toggleMaximize(win.id)}
                  runtimeLogs={runtimeLogs}
                />
              );

              if (win.constitution === "sovereign" && SOVEREIGN_REGISTRY[win.type]?.spatial === "vessel") {
                return (
                  <Win95Window
                    key={win.id}
                    title={`${win.activity?.dirty ? "*" : ""}${resolveRuntimeSubtitle(win) ? `${resolveRuntimeSubtitle(win)} - ${win.title}` : win.title}`}
                    icon={win.icon}
                    active={activeWindowId === win.id}
                    onClose={() => closeWindow(win.id)}
                    onClick={() => focusWindow(win.id)}
                    onMinimize={() => minimizeWindow(win.id)}
                    onMaximize={() => toggleMaximize(win.id)}
                    isMaximized={win.isMaximized}
                    x={isMobile || win.isMaximized ? 0 : (win.position?.x || 0)}
                    y={isMobile || win.isMaximized ? 0 : (win.position?.y || 0)}
                    onDragStart={() => focusWindow(win.id)}
                    dragConstraints={desktopRef}
                    disableDrag={isMobile || win.isMaximized}
                    onDragEnd={(_, info) => {
                      updateWindowState(win.id, {
                        position: {
                          x: (win.position?.x || 0) + info.offset.x,
                          y: (win.position?.y || 0) + info.offset.y,
                        }
                      });
                    }}
                    className="absolute"
                    style={{
                      zIndex: win.zIndex,
                      top: isMobile || win.isMaximized ? 0 : 0,
                      left: isMobile || win.isMaximized ? 0 : 0,
                      right: isMobile || win.isMaximized ? 0 : undefined,
                      bottom: isMobile || win.isMaximized ? -1 : undefined,
                      display: lifecycle === "suspended" ? "none" : undefined,
                      width: isMobile || win.isMaximized ? undefined : win.width,
                      height: isMobile || win.isMaximized ? undefined : win.height,
                      minWidth: isMobile || win.isMaximized ? "100%" : 300,
                      minHeight: isMobile || win.isMaximized ? "100%" : 200,
                      overflow: "hidden",
                    }}
                  >
                    {runtime}
                  </Win95Window>
                );
              }

              // Full sovereign — runtime owns chrome, positioning, and drag.
              // We center these on mobile instead of maximizing.
              return (
                <motion.div
                  key={win.id}
                  className="absolute"
                  drag={!isMobile}
                  dragMomentum={false}
                  onDragStart={() => focusWindow(win.id)}
                  dragConstraints={desktopRef}
                  animate={{
                    x: isMobile ? "-50%" : (win.position?.x || 0),
                    y: isMobile ? "-50%" : (win.position?.y || 0),
                    opacity: 1,
                    scale: 1
                  }}
                  onDragEnd={(_, info) => {
                    updateWindowState(win.id, {
                      position: {
                        x: (win.position?.x || 0) + info.offset.x,
                        y: (win.position?.y || 0) + info.offset.y,
                      },
                    });
                  }}
                  style={{
                    zIndex: win.zIndex,
                    pointerEvents: "auto",
                    top: isMobile ? "50%" : 0,
                    left: isMobile ? "50%" : 0,
                    display: lifecycle === "suspended" ? "none" : undefined,
                    width: win.width,
                    height: win.height,
                  }}
                >
                  {runtime}
                </motion.div>
              );
            }

            // Managed Citizens — minimize unmounts; restore remounts. Standard React lifecycle.
            if (lifecycle !== "running") return null;

            if (win.type === "SPECIMEN") {
                return (
                  <div 
                    key={win.id}
                    className="absolute inset-0"
                    style={{ zIndex: win.zIndex }}
                    onClick={() => focusWindow(win.id)}
                  >
                      {/* Search Utility */}
                      <AnimatePresence>
                        {isSearchVisible && (
                          <div className="w-full h-full flex items-center justify-center">
                            <Win95SearchInput
                              value={targetUrl}
                              onChange={(e: React.ChangeEvent<HTMLInputElement>) => onSearchChange(e.target.value)}
                              onAnalyze={onAnalyze}
                              disabled={isAnalyzing}
                              onClose={() => {
                                closeWindow(win.id);
                                onCloseSpecimen();
                              }}
                              onMinimize={() => minimizeWindow(win.id)}
                              active={activeWindowId === win.id}
                            />
                          </div>
                        )}
                      </AnimatePresence>

                      <div className={cn("contents", activeWindowId === win.id ? "opacity-100" : "opacity-95")}>
                          {typeof children === "function" ? children({
                              isActive: activeWindowId === win.id,
                              onMinimize: () => minimizeWindow(win.id)
                          }) : children}
                      </div>
                  </div>
                );
            }

            return (
              <motion.div
                key={win.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.1, delay: i * 0.05 }}
                className="contents"
              >
                <Win95Window
                  title={`${win.activity?.dirty ? "*" : ""}${win.title}`}
                  icon={win.icon}
                  active={activeWindowId === win.id}
                  onClose={() => closeWindow(win.id)}
                  onClick={() => focusWindow(win.id)}
                  onMinimize={() => minimizeWindow(win.id)}
                  onMaximize={() => toggleMaximize(win.id)}
                  isMaximized={win.isMaximized}
                  onResize={isMobile || win.isMaximized ? undefined : (width, height) => {
                      updateWindowState(win.id, { width, height });
                  }}
                  onDragStart={() => focusWindow(win.id)}
                  dragConstraints={desktopRef}
                  disableDrag={isMobile || win.isMaximized}
                  onDragEnd={(_, info) => {
                      updateWindowState(win.id, {
                          position: { 
                              x: (win.position?.x || 0) + info.offset.x, 
                              y: (win.position?.y || 0) + info.offset.y 
                          } 
                      });
                  }}
                  className="absolute"
                  style={{
                    zIndex: win.zIndex,
                    top: isMobile || win.isMaximized ? 0 : "12%",
                    left: isMobile || win.isMaximized ? 0 : "20%",
                    x: isMobile || win.isMaximized ? 0 : (win.position?.x || 0),
                    y: isMobile || win.isMaximized ? 0 : (win.position?.y || 0),
                    width: isMobile || win.isMaximized ? "100%" : win.width,
                    height: isMobile || win.isMaximized ? "calc(100% - var(--win-taskbar-height))" : win.height,
                    minWidth: isMobile || win.isMaximized ? "100%" : 300,
                    minHeight: isMobile || win.isMaximized ? "calc(100% - var(--win-taskbar-height))" : 200,
                    overflow: "hidden", // Native citizens are always clipped
                  }}
                >
                  <ManagedWindowRuntime
                    win={win}
                    vfs={vfs}
                    recents={recents}
                    runtimeSnapshots={windows
                      .filter((w) => w.id !== win.id)
                      .sort((a, b) => b.zIndex - a.zIndex)
                      .map((w) => ({
                        id:          w.id,
                        type:        w.type,
                        title:       w.title,
                        icon:        w.icon,
                        isMinimized: w.isMinimized,
                        activity:    w.activity,
                        playback:    w.playback,
                        subtitle:    resolveRuntimeSubtitle(w),
                        openedAt:    w.openedAt,
                      }))}
                    onOpenNode={handleOpenNode}
                    onFocusWindow={focusWindow}
                    updateWindowState={updateWindowState}
                  />
                </Win95Window>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>

      {/* Start Menu Overlay */}
      <AnimatePresence>
        {isStartMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.1, ease: "linear" }}
            className="absolute left-1 flex z-[2001] w-56"
            style={{
              bottom: "calc(var(--win-taskbar-height) + 4px)",
              background: "var(--win-face)",
              boxShadow: "var(--bevel-raised)",
              border: "1px solid var(--win-dk-shadow)",
            }}
          >
            <div
              className="w-8 relative flex-shrink-0 select-none overflow-hidden"
              style={{
                background: "linear-gradient(to bottom, var(--win-shadow), var(--win-title-active))",
              }}
            >
              <span
                className="absolute bottom-6 left-1/2 -rotate-90 origin-left whitespace-nowrap text-white font-bold"
                style={{
                  fontSize: 14,
                  letterSpacing: "1px",
                  textShadow: "1px 1px 0 rgba(0,0,0,0.5)",
                }}
              >
                Specimen <span className="font-normal opacity-70">OS</span>
              </span>
            </div>

            {/* Start Menu Items */}
            <div className="flex-1 flex flex-col py-1 win-stagger">
              <StartMenuItem icon="FileFind_16x16_4.png" label="Specimen Analyzer" onClick={onOpenSpecimen} />
              <StartMenuItem icon="⌨️" label="MS-DOS Prompt" onClick={() => handleOpenApp("TERMINAL", "MS-DOS Prompt")} />
              <StartMenuItem icon="Computer_16x16_4.png" label="My Computer" onClick={() => handleOpenNode(vfs.find(n => n.id === "desktop-mycomputer")!)} />
              <StartMenuItem icon="Globe_16x16_4.png" label="Internet Explorer" onClick={() => handleOpenApp("BROWSER", "Internet Explorer")} />
              <StartMenuItem icon="Folder_16x16_4.png" label="My Documents" onClick={() => handleOpenNode(vfs.find(n => n.name === "My Documents")!)} />
              <StartMenuItem icon="Mmsys100_16x16_4.png" label="Winamp" onClick={() => handleOpenApp("WEBAMP", "Winamp")} />
               <StartMenuItem icon="📄" label={(() => {
                 const win = windows.find(w => w.type === "NOTEPAD");
                 const sub = win ? resolveRuntimeSubtitle(win) : undefined;
                 const displaySub = sub ? (sub.length > 16 ? sub.slice(0, 16) + "..." : sub) : undefined;
                 return displaySub ? `Notepad (${displaySub})` : "Notepad";
               })()} onClick={() => handleOpenApp("NOTEPAD", "Notepad")} />
               <StartMenuItem icon="📝" label={(() => {
                 const win = windows.find(w => w.type === "MONACO_EDITOR");
                 const sub = win ? resolveRuntimeSubtitle(win) : undefined;
                 const displaySub = sub ? (sub.length > 16 ? sub.slice(0, 16) + "..." : sub) : undefined;
                 return displaySub ? `Monaco (${displaySub})` : "Monaco Editor";
               })()} onClick={() => handleOpenApp("MONACO_EDITOR", "Monaco Editor")} />
               <StartMenuItem icon="🎨" label={(() => {
                 const win = windows.find(w => w.type === "JSPAINT");
                 const sub = win?.activity?.subtitle;
                 const displaySub = sub ? (sub.length > 16 ? sub.slice(0, 16) + "..." : sub) : undefined;
                 return displaySub ? `Paint (${displaySub})` : "Paint";
               })()} onClick={() => handleOpenApp("JSPAINT", "Paint")} />
              <StartMenuItem icon="FolderOpen_16x16_4.png" label="Recent Items" onClick={() => handleOpenNode({ id: "__recents__", name: "Recent Items", type: "folder", icon: "📂" })} />
              <StartMenuItem icon="RecycleEmpty_16x16_4.png" label="Shut Down..." onClick={() => {
                setIsStartMenuOpen(false);
                setIsShutdownDialogOpen(true);
              }} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {bootStatus === "ready" && !isShuttingDown && (
        <div
          className="bg-[var(--win-face)] border-t border-[var(--win-dk-shadow)] shadow-[inset_0_1px_0_var(--win-highlight)] flex items-center px-1 gap-1 z-[1000] overflow-hidden"
          style={{ height: "var(--win-taskbar-height)", fontFamily: "var(--font-shell)" }}
        >
          {/* Start Button */}
          <div className="relative group/start shrink-0">
            <button
              className={cn(
                "win-btn flex items-center gap-1 font-bold h-5 px-2 mr-1",
                isStartMenuOpen && "win-pressed"
              )}
              style={{ minWidth: 0, boxShadow: isStartMenuOpen ? "var(--bevel-pressed)" : "var(--bevel-raised)" }}
              onClick={(e) => {
                e.stopPropagation();
                setIsStartMenuOpen(!isStartMenuOpen);
              }}
            >
              <svg width="13" height="13" viewBox="0 0 13 13" style={{ display: "block", imageRendering: "pixelated", flexShrink: 0 }}>
                <rect x="0" y="0" width="5" height="5" fill="#ff0000" />
                <rect x="7" y="0" width="5" height="5" fill="#00a000" />
                <rect x="0" y="7" width="5" height="5" fill="#0000ff" />
                <rect x="7" y="7" width="5" height="5" fill="#ffff00" />
              </svg>
              <span className="text-[11px] leading-none font-bold">Start</span>
            </button>
          </div>

          <div className="w-[2px] h-5 bg-[var(--win-shadow)] border-r border-[var(--win-highlight)] mx-1 shrink-0" />

          {/* Active App Pills */}
          <div className="flex-1 flex items-center gap-1 overflow-x-auto no-scrollbar h-full py-1">
            <AnimatePresence initial={false}>
              {windows.map((win) => (
                <TaskbarPill
                  key={win.id}
                  id={win.id}
                  title={win.activity?.subtitle || win.title}
                  icon={win.icon}
                  isActive={activeWindowId === win.id}
                  isMinimized={win.isMinimized}
                  dirty={win.activity?.dirty}
                  playing={win.playback?.isPlaying}
                  onClick={() => toggleMinimize(win.id)}
                />
              ))}
            </AnimatePresence>
          </div>

          {/* System Tray */}
          <div
            className="h-5 flex items-center px-2 gap-2 border border-inset shadow-[var(--bevel-sunken)] shrink-0"
            style={{ boxShadow: "var(--bevel-sunken)" }}
          >
            <div className="flex gap-[1px] opacity-40">
               <div className="w-[1px] h-2 bg-[#00aa00]" />
               <div className="w-[1px] h-1.5 bg-[#00aa00] mt-0.5" />
               <div className="w-[1px] h-1 bg-[#00aa00] mt-1" />
            </div>
            <span className="text-[10px] font-bold opacity-80" style={{ letterSpacing: "-0.05em" }}>
              {currentTime ? formatTime(currentTime) : "--:-- --"}
            </span>
          </div>
        </div>
      )}

      {/* Desktop Branding - Environmental Watermark (Dev Only) */}
      {process.env.NEXT_PUBLIC_APP_ENV === "development" && (
        <div
          className="fixed left-3 bottom-[34px] flex items-center pointer-events-none select-none z-[1500] px-2"
          style={{
            height: 14,
            fontSize: 7,
            letterSpacing: '0.1em',
            fontWeight: 700,
            gap: 8,
            opacity: 0.15,
            color: "var(--win-text)",
            textShadow: "1px 1px 0 rgba(255,255,255,0.05)"
          }}
        >
          <span>Specimen</span>
          <span style={{ color: "var(--win-shadow)", fontWeight: 400 }}>Technical Standard</span>
          <span style={{ color: "var(--win-title-active)", opacity: 0.8 }}>
            [Dev] {process.env.NEXT_PUBLIC_APP_BUILD}
          </span>
        </div>
      )}

      {/* Notifications */}
      <AnimatePresence>
        {notice && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[3000] pointer-events-none">
            <Win95Notification
                type={notice.type}
                message={notice.message}
            />
          </div>
        )}
      </AnimatePresence>

      {/* Environmental Lifecycle Components */}
      <AnimatePresence>
        {/* Boot Sequence Overlay */}
        <AnimatePresence>
          {bootStatus === "booting" && (
            <Win95BootSequence onComplete={handleBootComplete} />
          )}
        </AnimatePresence>
      </AnimatePresence>

      <AnimatePresence>
        {isShuttingDown && (
          <Win95ShutdownSequence mode={shutdownMode} />
        )}
      </AnimatePresence>

      {/* Shutdown Dialog */}
      {isShutdownDialogOpen && (
        <Win95ShutdownDialog 
          onClose={() => setIsShutdownDialogOpen(false)}
          onConfirm={(mode) => {
            setIsShutdownDialogOpen(false);
            setShutdownMode(mode);
            setIsShuttingDown(true);
          }}
        />
      )}
    </div>
  );
}

function TaskbarPill({ 
  id, title, icon, isActive, isMinimized, onClick, dirty, playing 
}: { 
  id: string; title: string; icon: string; isActive: boolean; isMinimized: boolean; onClick: () => void; dirty?: boolean; playing?: boolean;
}) {
  return (
    <motion.button
      key={`pill-${id}`}
      initial={{ opacity: 0, x: -5 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.05, ease: "linear" }}
      className={cn(
        "win-btn h-5 text-[10px] px-1 flex items-center gap-1 truncate max-w-[140px] shrink-0",
        isActive && "win-pressed"
      )}
      style={{
        boxShadow: isActive ? "var(--bevel-pressed)" : "var(--bevel-raised)",
        background: isActive ? "var(--win-face-light)" : "var(--win-face)",
        paddingLeft: isActive ? "4px" : "3px",
        borderLeft: isActive ? "2px solid var(--win-shadow)" : undefined,
      }}
      onClick={onClick}
    >
      <Win95Icon icon={icon} size={16} />
      <span className={cn("truncate", isActive && "font-bold")} style={{ letterSpacing: "-0.01em" }}>{title}</span>
      
      {/* Presence indicators mirror Explorer's micro-legitimacy */}
      <div className="flex items-center gap-1 ml-auto flex-shrink-0 pr-1">
        {!isMinimized && (
          <div 
            style={{ width: 2, height: 2, background: "#00aa00", borderRadius: "50%", opacity: 0.8 }}
          />
        )}
        {dirty && (
          <span 
            style={{ fontSize: "9px", color: "#cc0000", lineHeight: 1 }}
            title="Unsaved changes"
          >
            ●
          </span>
        )}
        {playing && <span style={{ fontSize: "8px", color: "var(--win-title-active)", lineHeight: 1 }}>▶</span>}
      </div>
    </motion.button>
  );
}

function StartMenuItem({ icon, label, onClick }: { icon: string; label: string; onClick?: () => void }) {
  const [active, setActive] = useState(false);

  return (
    <button
      className={cn(
        "flex items-center gap-2 px-2 py-[2px] hover:bg-[var(--win-select-bg)] hover:text-white text-left w-full border border-transparent transition-colors duration-75",
        active && "bg-[var(--win-select-bg)] text-white"
      )}
      style={{ 
        fontFamily: "var(--font-shell)", 
        fontSize: "var(--win-font-size)",
        transform: active ? "translateY(1px)" : "none",
        outline: active ? "1px dotted white" : undefined,
        outlineOffset: -3
      }}
      onPointerDown={() => setActive(true)}
      onPointerUp={() => setActive(false)}
      onPointerLeave={() => setActive(false)}
      onClick={onClick}
    >
      {icon.endsWith(".png") ? (
        <img src={`/win95-icons/${icon}`} width={16} height={16} alt="" style={{ imageRendering: "pixelated", flexShrink: 0 }} />
      ) : (
        <Win95Icon icon={icon} size={16} />
      )}
      <span className={cn("truncate", active && "font-bold")}>{label}</span>
    </button>
  );
}
