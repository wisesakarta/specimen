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
    name: "Specimen",
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
    icon: "📋",
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
    name: "about",
    type: "file",
    icon: "📄",
    appType: "NOTEPAD",
    content: `Specimen 95

A sovereign operating system running inside the browser.
Built by Technical Standard.

This is not a retro-themed website. This is a runtime environment
that restores operational coherence to software design.

Every window, every bevel, every interaction is authored with intent.

Version ${process.env.NEXT_PUBLIC_APP_VERSION || "2.1.0"}
${process.env.NEXT_PUBLIC_APP_ENV === "development" ? `Build: ${process.env.NEXT_PUBLIC_APP_BUILD || "local"}\n` : ""}
---
Technical Standard
specimen.krtalabs.xyz`,
  },
  {
    id: "desktop-foundries",
    name: "foundries",
    type: "file",
    icon: "📄",
    appType: "NOTEPAD",
    content: `Specimen Analyzer

Specimen includes a built-in font analysis engine capable of
inspecting webfont delivery from type foundries worldwide.

Use the Specimen app (Start > Programs > Specimen) to analyze
any foundry URL and retrieve font metadata, glyph counts,
OpenType features, and specimen PDFs.

Supported platforms: Fontdue, Shopify, custom CDN, and more.`,
  },
  {
    id: "desktop-tech",
    name: "tech-stack",
    type: "file",
    icon: "📄",
    appType: "NOTEPAD",
    content: `Specimen 95 — Acknowledgments

This operating system is made possible by open-source software.
We honor the makers.

Core:
- Next.js 16 (Vercel)
- React 18 (Meta)
- TypeScript 5 (Microsoft)
- Tailwind CSS 4 (Tailwind Labs)

Citizens:
- xterm.js 6 — Terminal emulation
- Webamp 2.2.0 — Winamp in the browser (Jordan Eldredge)
- Monaco Editor 4.7.0 — Code editing (Microsoft)
- JS Paint — Classic Paint recreation (Isaiah Odhner)
- Framer Motion 12 — Animation engine

Pipeline:
- opentype.js, fontkit, fonteditor-core — Font analysis
- Puppeteer 24 — Browser automation (Google)
- Cheerio — DOM parsing
- adm-zip, wawoff2, brotli — Compression

Typography:
- W95FA — MS Sans Serif recreation (Alina Sava, SIL OFL)
- Departure Mono — Monospace typeface (Tobias Fried)

Icons:
- React95 Icons (MIT)
- trapd00r/win95-winxp_icons — shell32.dll extraction

Thank you to every contributor who made their work free and open.`,
  },
  {
    id: "desktop-paint",
    name: "Paint",
    type: "file",
    icon: "🎨",
    appType: "JSPAINT",
  },
  {
    id: "desktop-doom",
    name: "DOOM",
    type: "file",
    icon: "🎮",
    appType: "DOOM",
  },
  {
    id: "desktop-skifree",
    name: "SkiFree",
    type: "file",
    icon: "⛷️",
    appType: "SKIFREE",
  },
  {
    id: "desktop-trash",
    name: "Recycle Bin",
    type: "folder",
    icon: "🗑️",
    children: [],
  },
];
