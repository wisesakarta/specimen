import { useState, useCallback } from "react";
import type { WindowState } from "@/components/ui/Win95Desktop";
import { AppType, SOVEREIGN_REGISTRY, WindowData } from "@/lib/os-config";
import type { PersistedRecent } from "@/lib/persistence";

export const SPECIMEN_ID = "specimen";

export function useWindowManager(initialState: {
  windows: WindowState[];
  maxZIndex: number;
  recents: PersistedRecent[];
}) {
  const [windows, setWindows] = useState<WindowState[]>(initialState.windows);
  const [recents, setRecents] = useState<PersistedRecent[]>(initialState.recents);
  const [activeWindowId, setActiveWindowId] = useState<string | null>(null);
  const [maxZIndex, setMaxZIndex] = useState(initialState.maxZIndex);
  

  const normalizeZIndexes = useCallback(() => {
    setWindows((prevWindows) => {
      // Collect all unique z-indexes and their IDs based on the current functional state
      const items = [...prevWindows.map(w => ({ id: w.id, z: w.zIndex }))].sort((a, b) => a.z - b.z);

      const newWindows = [...prevWindows];

      items.forEach((item, index) => {
        const newZ = 100 + index;
        const winIdx = newWindows.findIndex(w => w.id === item.id);
        if (winIdx !== -1) newWindows[winIdx].zIndex = newZ;
      });

      setMaxZIndex(100 + items.length);
      return newWindows;
    });
  }, []);

  const updateRecents = useCallback((id: string, type: AppType, title: string, icon: string, data?: WindowData) => {
    if (type === "EXPLORER" || type === "SPECIMEN") return; // Don't track shell apps as recents
    setRecents((prev) => {
      const filtered = prev.filter((r) => r.id !== id);
      const newItem: PersistedRecent = {
        id,
        type,
        title,
        icon,
        lastOpenedAt: Date.now(),
        data,
      };
      return [newItem, ...filtered].slice(0, 15);
    });
  }, []);

  const openWindow = useCallback((id: string, type: AppType, title: string, icon: string, data?: WindowData) => {
    updateRecents(id, type, title, icon, data);
    
    setWindows((prevWindows) => {
      const existing = prevWindows.find((w) => w.id === id);
      const nextZ = maxZIndex + 1;
      setMaxZIndex(nextZ);

      if (existing) {
        setActiveWindowId(id);
        return prevWindows.map((w) => 
          w.id === id 
            ? { ...w, isOpen: true, isMinimized: false, zIndex: nextZ, data: data !== undefined ? data : w.data } 
            : w
        );
      } else {
        const staggeredX = 40 + (prevWindows.length * 25) % 300;
        const staggeredY = 40 + (prevWindows.length * 25) % 200;

        const newWindow: WindowState = {
          id,
          type,
          title,
          icon,
          isOpen: true,
          isMinimized: false,
          isMaximized: false,
          zIndex: nextZ,
          constitution: (type in SOVEREIGN_REGISTRY) ? "sovereign" : "managed",
          data,
          position: { x: staggeredX, y: staggeredY },
          width: type === "BROWSER" ? "70%" : (SOVEREIGN_REGISTRY[type]?.defaultWidth ?? 500),
          height: type === "BROWSER" ? "70%" : (SOVEREIGN_REGISTRY[type]?.defaultHeight ?? 400),
          openedAt: Date.now(),
        };
        setActiveWindowId(id);
        return [...prevWindows, newWindow];
      }
    });
  }, [maxZIndex, updateRecents]);

  const closeWindow = useCallback((id: string) => {
    setWindows((prev) => prev.filter((w) => w.id !== id));
    setActiveWindowId((prevId) => (prevId === id ? null : prevId));
  }, []);

  const minimizeWindow = useCallback((id: string) => {
    setWindows((prev) => prev.map((w) => (w.id === id ? { ...w, isMinimized: true } : w)));
    setActiveWindowId((prevId) => (prevId === id ? null : prevId));
  }, []);

  const focusWindow = useCallback((id: string) => {
    // If it's already the active window and it is the highest z-index, do nothing
    if (activeWindowId === id) {
      const win = windows.find(w => w.id === id);
      const isHighest = (win?.zIndex === maxZIndex);
      if (isHighest) return;
    }

    const nextZ = maxZIndex + 1;
    
    if (nextZ > 800) {
      normalizeZIndexes();
      // Functional updater ensures Z-index boundaries remain deterministic even if normalizeZIndexes mutates the array concurrently.
      setWindows((prev) => {
        const newMax = 100 + prev.length + 1;
        return prev.map((w) => (w.id === id ? { ...w, isMinimized: false, zIndex: newMax } : w));
      });
      setMaxZIndex(100 + windows.length + 1);
      setActiveWindowId(id);
      return;
    }

    setMaxZIndex(nextZ);
    setWindows((prev) => prev.map((w) => (w.id === id ? { ...w, isMinimized: false, zIndex: nextZ } : w)));
    setActiveWindowId(id);
  }, [activeWindowId, maxZIndex, windows, normalizeZIndexes]);

  const toggleMaximize = useCallback((id: string) => {
    setWindows((prev) => prev.map(w => w.id === id ? { ...w, isMaximized: !w.isMaximized } : w));
    focusWindow(id);
  }, [focusWindow]);

  const toggleMinimize = useCallback((id: string) => {
    const win = windows.find((w) => w.id === id);
    if (!win) return;

    if (win.isMinimized) {
      setWindows((prev) => prev.map(w => w.id === id ? { ...w, isMinimized: false } : w));
      focusWindow(id);
    } else if (activeWindowId === id) {
      minimizeWindow(id);
    } else {
      focusWindow(id);
    }
  }, [windows, activeWindowId, focusWindow, minimizeWindow]);

  const updateWindowState = useCallback((id: string, patch: Partial<WindowState>) => {
    setWindows((prev) => {
      const win = prev.find(w => w.id === id);
      if (!win) return prev;
      
      const hasChange = Object.keys(patch).some(key => {
        const k = key as keyof WindowState;
        if (k === 'activity' && patch.activity) {
          return patch.activity.dirty !== win.activity?.dirty || 
                 patch.activity.subtitle !== win.activity?.subtitle;
        }
        return patch[k] !== win[k];
      });

      if (!hasChange) return prev;
      return prev.map((w) => (w.id === id ? { ...w, ...patch } : w));
    });
  }, []);

  return {
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
  };
}
