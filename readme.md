# Aksara

Internal utility for analyzing foundry pages and collecting font assets into structured ZIP packages.
Developed by `Saka Studio & Engineering`.

## Current Status
- Phase 1 implemented: scraper routing, download engine, zip delivery, and staging cleanup.
- Phase 2 planning baseline:
  - `TECHNICAL_BLUEPRINT_ABCDINAMO.md`
  - `STRATEGIC_ANALYSIS.md`

## Features
- URL analysis via scraper registry (`/api/analyze-url`)
- Foundry-specific extraction strategies (direct URL and browser intercept)
- Batch direct download with format conversion (`woff2` -> `ttf`/`woff`, optional `otf`)
- ZIP response delivery from API
- Temporary folder cleanup after delivery

## Requirements
- Node.js 20+
- Python 3 with `fonttools` (for conversion pipeline)

## Run
```bash
npm install
npm run dev
```
Open `http://localhost:3000`.

## Repo Hygiene (Before Commit)
```bash
npm run cleanup:workspace:dry
npm run cleanup:workspace
npm run qa:baseline
```

- `cleanup:workspace` removes ad-hoc debug artifacts (`tmp-*`, `.tmp-*`, `.temp-*`, logs, `__pycache__`).
- `downloads/` remains local and is ignored by git.

## Workflow
1. Paste target URL in UI.
2. Run analyze.
3. Start download.
4. System downloads and processes fonts.
5. ZIP is delivered to browser download.

## Output Behavior
- Default: work files in `.temp-staging/` then zipped and cleaned.
- Optional persisted output: `downloads/` when `outputFolder` is set.

## Notes
- Some variable fonts are heavy and can make progress look stuck during conversion.
- License and usage compliance for collected fonts remains user/team responsibility.

## License
- This project is distributed under **PolyForm Noncommercial 1.0.0**. See `LICENSE`.
- Required notices are listed in `NOTICE`.
- Commercial usage requires a separate agreement. See `COMMERCIAL-LICENSE.md`.
