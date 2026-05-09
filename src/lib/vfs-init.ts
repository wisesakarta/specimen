import { VFSNode } from "./os-config";

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
    content: `Specimen Runtime Environment [v${process.env.NEXT_PUBLIC_APP_VERSION || "0.1.5"}]
${process.env.NEXT_PUBLIC_APP_ENV === "development" ? `Build: ${process.env.NEXT_PUBLIC_APP_BUILD || "2026.05.09"}\nEnvironment: development\n` : ""}
High-fidelity font asset retrieval and technical auditing system.

This environment is maintained by the Technical Standard department of Specimen Labs. 
It operates as a sovereign runtime for deterministic asset extraction and structural validation.

Credentials:
- Department: Technical Standard
- Organization: Specimen Labs
- Founder: Karta Wisesa`,
  },
  {
    id: "desktop-foundries",
    name: "foundries.txt",
    type: "file",
    icon: "📄",
    appType: "NOTEPAD",
    content: `Integrated Foundries Inventory:
- 205TF
- A2-Type
- ABC Dinamo
- Abjad Fonts
- Arilla Type
- Blaze Type
- Branding with Type
- Commercial Type
- Co-Type
- Dein Waller
- Displaay
- Due Studio
- Faire Type
- Formula Type
- General Type Studio
- Grilli Type
- Groteskly
- Hanli
- Interval Type
- July Type
- KH Type
- Klim
- Lineto
- Mass-Driver
- MonoLisa
- Narrow Type
- Nodo Type
- Nuform Type
- OH no Type Co
- Optimo
- Pangram Pangram
- Production Type
- René Bieder
- Sascha Bente
- Sharp Type
- Source Type
- Superior Type
- Swiss Typefaces
- The Designers Foundry
- Type Department
- Typefaces Pizza
- Typeji
- Typejockeys
- TypeType
- Typotheque
- Viktor Zumegen
- W Type Foundry`,
  },
  {
    id: "desktop-tech",
    name: "tech-stack.txt",
    type: "file",
    icon: "📄",
    appType: "NOTEPAD",
    content: `Specimen Sovereign Tech Stack
A documented assembly of libraries and engines powering the runtime.

Core Infrastructure:
- Next.js 16 (App Router / Webpack)
- TypeScript 5 (Static Typing)
- Tailwind CSS 4 (Atomic Styling)
- React 18 (Component Architecture)

Specialized Engines:
- Sovereign UI: Custom React + Framer Motion 12
- Terminal Instrument: xterm.js 6 + Fit Addon
- Audio Processing: Webamp 2.2.0 (Winamp Emulation)
- Visual Editor: Monaco Editor 4.7.0
- Painting Utility: JSPaint (Legacy Port)
- Motion Orchestration: GSAP 3.14.2 + Lenis 1.3.17

Data & Extraction Pipeline:
- Font Analysis: opentype.js 1.3.4 + fontkit 2.0.4 + fonteditor-core 2.6.3
- Browser Automation: Puppeteer 24.3 + Stealth Engine
- DOM Parsing: Cheerio 1.2.0
- Compression: adm-zip 0.5.16 + wawoff2 2.0.1 + brotli 1.3.3
- Document Parsing: pdf-parse 2.4.5

Identity & Assets:
- Canonical Typeface: Departure Mono (Sovereign UI)
- Benchmark Standard: Berkeley Mono (Output Reference)
- Iconography: Lucide React + React95 Icons
- UI Design System: React95 Core 9.8.0

To respect the makers: Special thanks to all contributors of the open-source libraries listed above.`,
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
