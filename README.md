# Specimen

**Sovereign Runtime Environment — Font asset retrieval and structural auditing for type professionals.**

[Live Runtime](https://specimen.krtalabs.xyz) · [Commercial Licensing](COMMERCIAL-LICENSE.md)

---

Specimen is an operating system running inside the browser. It is not a retro-themed website. It is a materially coherent, deterministic runtime environment built on Win95 operational physics — designed to retrieve, convert, and audit font assets from 40+ independent type foundries with machine-grade precision.

The system rejects generic interface homogenization and velocity-driven engineering shortcuts. Every bevel, every font download, and every folder structure is the result of deliberate, documented architectural decisions.

---

## Capabilities

| Capability | Description |
|---|---|
| Scraper Registry | 40+ foundry-specific extraction strategies: Direct CDN, Fontdue GraphQL, Shopify, browser intercept |
| Format Normalization | Automated pipeline: woff2 → TTF, OTF, woff via Python fonttools |
| Virtual File System | Session-based VFS for deterministic asset staging and retrieval |
| Berkeley Mono Output | Sovereign artifact naming: `Foundry_-_Family/TTF/OTF/Webfonts/Woff2/` |
| Browser Intercept | Playwright + stealth extraction for DRM-gated and JS-rendered delivery |
| Jobs Architecture | Async job queue for long-running downloads; polling + ZIP delivery |

---

## Architecture — Brain / Machine / Workshop

```
URL Input
  │
  ▼  /api/analyze-url → Scraper Registry → ScrapeResult
  │
  ▼  /api/jobs → Job Queue → font-downloader.ts
                               │
                               ├── batch-direct      (CDN fonts, direct URLs)
                               └── browser-intercept (Playwright, DRM-gated)
                               │
                               └── organizeOutputByFormat() → ZIP
```

| Layer | Path | Responsibility |
|---|---|---|
| Brain | `src/lib/server/services/` | Validation, QA, protocol selection |
| Machine | `src/lib/server/font-downloader.ts` | Download, convert, organize |
| Workshop | `tools/`, `tasks/` | Smoke tests, debug tooling |

---

## Stack

- **Runtime**: Next.js 15 / Node.js 22 / TypeScript
- **Shell**: Framer Motion · W95FA typeface · CSS custom properties
- **Extraction**: Playwright · Puppeteer-stealth · Cheerio
- **Format pipeline**: Python 3.11 · fonttools · fonteditor-core · opentype.js
- **Terminal**: xterm.js
- **Audio**: Webamp

---

## Requirements

- Node.js 22+
- Python 3.11+ with `fonttools` (`pip install fonttools brotli`)
- Docker (recommended for production)

---

## Quick Start

### Local development

```bash
npm install
npm run dev
```

Runtime at `http://localhost:3000`.

### Production

```bash
docker compose up --build -d
```

Runtime on port 8085. Domain routing via Cloudflare Tunnel or Tailscale.

---

## Quality assurance

```bash
npm run typecheck      # TypeScript validation — must pass before any commit
npm run qa:baseline    # Typecheck + foundry health check
npm run smoke          # Full 48-foundry E2E smoke test against production
```

Pre-commit requirements:
- Zero TypeScript errors (`npx tsc --noEmit`)
- No stray debug files or log artifacts in root workspace
- Artifact naming follows the Berkeley Mono standard

---

## License

Distributed under **PolyForm Noncommercial 1.0.0**. See [LICENSE](LICENSE).

Commercial use is not permitted under that license. For commercial licensing inquiries, see [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md).

Copyright © 2026 Specimen Labs / Technical Standard.
