/**
 * Specimen WebOS Configuration
 * Defines the Virtual File System (VFS) and App Registry.
 */

export type AppType = "SPECIMEN" | "EXPLORER" | "NOTEPAD" | "BROWSER" | "WEBAMP" | "MONACO_EDITOR" | "JSPAINT" | "ABOUT";

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
}

export const SOVEREIGN_REGISTRY: Partial<Record<AppType, SovereignRegistryEntry>> = {
  WEBAMP: { defaultWidth: 275, defaultHeight: 348, spatial: "full" },
  MONACO_EDITOR: { defaultWidth: 640, defaultHeight: 440, spatial: "vessel" },
  JSPAINT: { defaultWidth: 780, defaultHeight: 520, spatial: "vessel" },
  NOTEPAD: { defaultWidth: 400, defaultHeight: 300, spatial: "vessel" },
};

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

export const DEFAULT_VFS: VFSNode[] = [
  {
    id: "desktop-mycomputer",
    name: "My Computer",
    type: "folder",
    icon: "🖥️",
    children: [],
  },
  {
    id: "desktop-specimen",
    name: "Specimen Analyzer",
    type: "file",
    icon: "🔍",
    appType: "SPECIMEN",
  },
  {
    id: "desktop-docs",
    name: "My Documents",
    type: "folder",
    icon: "📁",
    children: [
      {
        id: "doc-foundry-collections",
        name: "Font Collections",
        type: "folder",
        icon: "🔡",
        children: [
          {
            id: "coll-sascha",
            name: "Sascha Bente",
            type: "folder",
            icon: "📁",
            children: [
              { id: "font-sb-viadukt", name: "SB Viadukt.zip", type: "file", icon: "📦" },
              { id: "font-sb-modern", name: "SB Modern.zip", type: "file", icon: "📦" },
            ]
          },
          {
            id: "coll-monolisa",
            name: "MonoLisa",
            type: "folder",
            icon: "📁",
            children: [
              { id: "font-monolisa-plus", name: "MonoLisa Plus.zip", type: "file", icon: "📦" },
            ]
          },
          {
            id: "coll-abcdinamo",
            name: "ABC Dinamo",
            type: "folder",
            icon: "📁",
            children: [
              { id: "font-favorit", name: "Favorit.zip", type: "file", icon: "📦" },
              { id: "font-monument", name: "Monument Grotesk.zip", type: "file", icon: "📦" },
            ]
          }
        ]
      },
      {
        id: "doc-skins",
        name: "Skins",
        type: "folder",
        icon: "🎨",
        children: [
          {
            id: "skin-deus-ex",
            name: "Deus Ex Amp.wsz",
            type: "file",
            icon: "📦",
            metadata: { skinUrl: "/assets/skins/Deus_Ex_Amp_by_AJ.wsz" }
          },
          {
            id: "skin-excel",
            name: "Excel Skin.wsz",
            type: "file",
            icon: "📦",
            metadata: { skinUrl: "/assets/skins/Excel_Skin.wsz" }
          },
          {
            id: "skin-major-tom",
            name: "Major Tom Remix.wsz",
            type: "file",
            icon: "📦",
            metadata: { skinUrl: "/assets/skins/Major_Tom Remix.wsz" }
          },
          {
            id: "skin-microchip",
            name: "Microchip 2.wsz",
            type: "file",
            icon: "📦",
            metadata: { skinUrl: "/assets/skins/Microchip_2.wsz" }
          },
          {
            id: "skin-necromech",
            name: "Necromech.wsz",
            type: "file",
            icon: "📦",
            metadata: { skinUrl: "/assets/skins/Necromech.wsz" }
          },
          {
            id: "skin-nucleo",
            name: "Nucleo NLog 2G1.wsz",
            type: "file",
            icon: "📦",
            metadata: { skinUrl: "/assets/skins/Nucleo-NLog-2G1.wsz" }
          },
          {
            id: "skin-petrol",
            name: "Petrol Flange.wsz",
            type: "file",
            icon: "📦",
            metadata: { skinUrl: "/assets/skins/Petrol_Flange.wsz" }
          },
          {
            id: "skin-spilt-milk",
            name: "Spilt Milk.wsz",
            type: "file",
            icon: "📦",
            metadata: { skinUrl: "/assets/skins/Spilt_Milk.wsz" }
          },
          {
            id: "skin-cube",
            name: "The Cube v2.wsz",
            type: "file",
            icon: "📦",
            metadata: { skinUrl: "/assets/skins/the_Cube_v2_by_Kuki.wsz" }
          },
          {
            id: "skin-winamp5",
            name: "Winamp5 Classified v5.5.wsz",
            type: "file",
            icon: "📦",
            metadata: { skinUrl: "/assets/skins/Winamp5_Classified_v5.5.wsz" }
          },
          {
            id: "skin-winamp98",
            name: "Winamp98 plus IE5.wsz",
            type: "file",
            icon: "📦",
            metadata: { skinUrl: "/assets/skins/Winamp98_plus_IE5.wsz" }
          }
        ]
      },
    ],
  },
  {
    id: "desktop-browser",
    name: "Internet Explorer",
    type: "file",
    icon: "🌐",
    appType: "BROWSER",
  },
  {
    id: "desktop-music",
    name: "Winamp",
    type: "file",
    icon: "⚡",
    appType: "WEBAMP",
  },
  {
    id: "desktop-editor",
    name: "Monaco Editor",
    type: "file",
    icon: "🗂️",
    appType: "MONACO_EDITOR",
  },
  {
    id: "desktop-notepad",
    name: "Notepad",
    type: "file",
    icon: "📝",
    appType: "NOTEPAD",
  },
  {
    id: "desktop-about",
    name: "about.txt",
    type: "file",
    icon: "📄",
    appType: "NOTEPAD",
    content: `Specimen v2.0
Technical Standard compliant font extraction system.

Mission: Achieve the perfectness in smallest detail possible.
Architecture: Otak / Mesin / Bengkel.`,
  },
  {
    id: "desktop-foundries",
    name: "foundries.txt",
    type: "file",
    icon: "📄",
    appType: "NOTEPAD",
    content: `SUPPORTED FOUNDRIES:
- Sascha Bente
- MonoLisa
- ABC Dinamo
- Klim Type Foundry
- Lineto
- Pangram Pangram
- Grilli Type
- W Type Foundry
- Superior Type
- Swiss Typefaces
- OH no Type Co
- 205TF
- A2-Type
- Co-Type`,
  },
  {
    id: "desktop-tech",
    name: "tech-stack.txt",
    type: "file",
    icon: "📄",
    appType: "NOTEPAD",
    content: `TECH STACK:
- Framework: Next.js 15 (App Router)
- Language: TypeScript
- Styling: Tailwind CSS
- Animation: Framer Motion
- Desktop Engine: Custom Win95 React Engine
- Font Extraction: Fonttools (Python) / Browser Intercept`,
  },
  {
    id: "desktop-paint",
    name: "Paint",
    type: "file",
    icon: "🎨",
    appType: "JSPAINT",
  },
  {
    id: "desktop-trash",
    name: "Recycle Bin",
    type: "folder",
    icon: "🗑️",
    children: [],
  },
];
