# Project Context: Saka Font Scrapper

**Updated:** 2026-02-10

## 1. Project Identity
- **Name:** Saka Font Scrapper / Font Fetcher Web
- **Mission:** Analyze, extract, and organize font assets for internal design and technical research workflows.

## 2. Core Architecture

### Application Stack
- **Framework:** Next.js 16 (App Router)
- **Language:** TypeScript
- **Extraction:** Puppeteer (stealth), Cheerio, direct fetch pipeline
- **Font Processing:** `fonteditor-core`, Python `fontTools` via `tools/convert-font.py`

### Execution Modes
1. **Scraper + Batch Direct**
   - `src/lib/scrapers/*` resolves foundry strategy.
   - `src/lib/server/font-downloader.ts` handles direct download and conversion.
2. **Browser Intercept**
   - `src/lib/server/browser-downloader.ts` captures dynamic font streams for protected sites.

## 3. Current Implementation Status (Phase 1)
- `analyze-url` API is active and routes to scraper registry.
- Download API supports `browser-intercept` and `batch-direct`.
- Zip delivery is implemented in `src/app/api/font-download/route.ts`.
- Temporary staging and cleanup are implemented (`.temp-staging`, `ZipService.autoCleanup`).

## 4. Known Operational Constraint
- Large variable fonts can make progress appear stalled during conversion.
- Main reason: per-file conversion/explode phase is CPU-heavy and batch UI progress is not streamed item-by-item yet.

## 5. Phase 2 Starting Baseline
The following documents are now the main source of direction:
- `TECHNICAL_BLUEPRINT_ABCDINAMO.md`
- `STRATEGIC_ANALYSIS.md`

## 6. Directory Map
- `src/lib/scrapers/`: Foundry-specific scrape logic
- `src/lib/server/`: Download, interception, conversion, packaging
- `src/app/api/`: API routes for analyze and download
- `tools/`: Python diagnostics and conversion utilities
- `.temp-staging/`: Temporary working directory before zip delivery
- `downloads/`: Optional persisted output path
