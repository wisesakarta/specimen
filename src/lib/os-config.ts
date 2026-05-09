/**
 * Specimen WebOS Configuration
 * Defines the Virtual File System (VFS) and App Registry.
 */

export type AppType = "SPECIMEN" | "EXPLORER" | "NOTEPAD" | "BROWSER" | "WEBAMP" | "MONACO_EDITOR" | "JSPAINT" | "ABOUT" | "TERMINAL";

/**
 * PHASE 8 — WINDOWSTATE TYPE HARDENING
 * 
 * Formalizing the data structures for each application type to eliminate 'any' drift.
 */
export interface NotepadData {
  content: string;
}

export interface ExplorerData {
  viewStack: Array<{
    kind: "my-computer" | "desktop" | "active-sessions" | "recent-items" | "vfs";
    nodeId?: string;
    selectedId?: string;
  }>;
}

export interface BrowserData {
  url?: string;
}

export interface WebampData {
  skinUrl?: string;
}

export interface MonacoData {
  content?: string;
  language?: string;
}

export interface JSPaintData {
  image?: string;
}

export interface SpecimenData {
  foundryName?: string;
  originalUrl?: string;
  targetUrl?: string;
  fonts: any[]; // Keep fonts as any[] for now as it's complex
  downloadResult?: {
    downloaded: any[];
    skipped: any[];
  };
}

export interface VFSNode {
  id: string;
  name: string;
  type: "file" | "folder";
  icon: string;
  appType?: AppType;
  content?: string; // For text files
  children?: VFSNode[]; // For folders
  metadata?: any;
}

export type WindowData = 
  | NotepadData 
  | ExplorerData 
  | BrowserData 
  | WebampData 
  | MonacoData 
  | JSPaintData 
  | SpecimenData 
  | VFSNode
  | string 
  | null;


/**
 * Sovereign Runtime Registry
 *
 * A sovereign runtime is a third-party or self-contained runtime that:
 * - Owns its own lifecycle (mount, suspend, resume, destroy)
 * - Must survive shell minimize without being unmounted
 * - Communicates with the shell via a standard 5-callback interface
 *
 * Spatial sovereignty class determines shell vessel behavior:
 *   "full"   — runtime owns positioning, chrome, and drag (e.g. Webamp, DOSBox)
 *   "vessel" — shell vessel owns positioning, chrome, and drag (e.g. Monaco, xterm.js)
 *
 * To register a new sovereign runtime:
 * 1. Add its AppType here with default dimensions and spatial class
 * 2. Add a case to SovereignRuntimeHost.tsx
 * 3. Implement the SovereignRuntimeProps interface in the runtime component
 *    - "vessel" runtimes: implement content only (no title bar — shell provides chrome)
 *    - "full" runtimes: implement complete window chrome and self-drag
 *
 * Registered: WEBAMP (full), MONACO_EDITOR (vessel), JSPAINT (vessel)
 * Future candidates: DOSBOX (full), TERMINAL (vessel)
 */
export interface SovereignRegistryEntry {
  defaultWidth: number;
  defaultHeight: number;
  /** Spatial sovereignty class — determines whether shell or runtime owns positioning. */
  spatial: "full" | "vessel";
  /** Default icon for procedural spawning */
  defaultIcon?: string;
}

export const SOVEREIGN_REGISTRY: Partial<Record<AppType, SovereignRegistryEntry>> = {
  WEBAMP: { defaultWidth: 275, defaultHeight: 348, spatial: "full", defaultIcon: "⚡" },
  MONACO_EDITOR: { defaultWidth: 640, defaultHeight: 440, spatial: "vessel", defaultIcon: "🗂️" },
  JSPAINT: { defaultWidth: 780, defaultHeight: 520, spatial: "vessel", defaultIcon: "🎨" },
  NOTEPAD: { defaultWidth: 400, defaultHeight: 300, spatial: "vessel", defaultIcon: "📝" },
  TERMINAL: { defaultWidth: 600, defaultHeight: 400, spatial: "vessel", defaultIcon: "⌨️" },
  BROWSER: { defaultWidth: 800, defaultHeight: 600, spatial: "vessel", defaultIcon: "🌐" },
};



