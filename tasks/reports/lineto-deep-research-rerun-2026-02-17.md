# Lineto Deep Research (Rerun after MCP OOM) - 2026-02-17

## Goal
Re-run deep investigation with MCP after previous out-of-memory issue and confirm:
- live network behavior,
- binary gate behavior,
- root cause of style/family accuracy gaps.

## Environment status
- MCP Chrome DevTools session is stable again (no OOM during this run).
- Active pages validated:
  - `https://lineto.com/typefaces/akkurat-mono`
  - `https://lineto.com/typefaces/geigy`
  - `https://lineto.com/typefaces/dmt-var-3-axis`

## Live network findings (MCP)
1. `akkurat-mono` page requests:
   - `GET /api/front/font-cuts/web-font?postscriptNames=AkkuratMonoLL-Regular&...Italic&...Bold&...BoldItalic`
   - Exactly **4** cuts, not 10.
2. `geigy` page requests:
   - `GET /api/front/font-cuts/web-font?...GeigyLL-Lgt ... GeigyLL-BlkItalic`
   - Exactly **10** cuts.
3. `dmt-var-3-axis` page requests:
   - `GET /api/front/font-cuts/web-font?postscriptNames=DMTLLVar-Regular`
   - Exactly **1 variable** cut.

## API reverse-engineering findings (strong)
Authoritative API exists and is public:
- `GET https://lineto.com/api/front/font-families`
- `GET https://lineto.com/api/front/font-families/{id}`

Confirmed examples:
- `id=361` → `Akkurat Mono` (`ref=akkurat-mono`) → 4 cuts
- `id=692` → `Geigy` (`ref=geigy`) → 10 cuts
- `id=721` → `DMT Var [3 Axis]` (`ref=dmt-var`) → 1 cut (`DMTLLVar-Regular`)

Important: this API returns canonical fields:
- `fontShopSets[].fontCuts[].postscriptName`
- `fontShopSets[].fontCuts[].name` (human style name)
- `attributes.isItalic`, `attributes.isVariable`, `attributes.weightClass`

## Root-cause conclusions
1. Binary decoder is still correct (no new contradiction found).
2. Accuracy gap is in **expected profile generation**, not extraction/decode.
3. Current HTML regex profile is noisy:
   - `akkurat-mono` expected profile was inflated to 10 styles.
   - `geigy` expected profile mixed style vocab (`Bld/Blk/Lgt` vs `Bold/Black/Light`) and cross-family noise.
4. `dmt-var-3-axis` miss came from slug-token heuristic, while canonical API already has exact mapping via family metadata.

## Recommendation for Stage 2 implementation
1. Lineto scraper should build `targetProfile` from `api/front/font-families` (+ per-id detail) instead of HTML regex.
2. Match family by priority:
   - exact `ref` from slug,
   - exact normalized `og:title` to API `name`,
   - fallback similarity score.
3. In coverage audit, when session postscript names are present, do not override with weaker catalog style list.
4. Add style alias normalization for Lineto abbreviations:
   - `Lgt -> Light`, `Reg -> Regular`, `Med -> Medium`, `Bld -> Bold`, `Blk -> Black`.

