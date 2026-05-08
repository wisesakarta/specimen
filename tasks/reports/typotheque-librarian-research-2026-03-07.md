# Typotheque Librarian Research

Date: 2026-03-07
Scope: Passive librarian research for `https://www.typotheque.com/` focused on family pages, runtime assets, structured data endpoints, and specimen coverage. No intrusive steps were used.

## Executive Summary

Typotheque is a strong candidate for a high-precision family scraper without any intrusive tactics.

The site exposes three useful layers of data:
1. Family HTML pages with stable links to specimen PDFs, script variants, and system-overview relations.
2. Runtime webfont requests that reveal the actual preview fonts loaded by the page.
3. Structured Next.js data endpoints under `/_next/data/{buildId}/.../buy.json` and `.../try.json` that expose product, style, variable-font, and licensing metadata.

For scraper design, the `buy.json` and `try.json` endpoints appear to be the highest-value sources. They are significantly richer than raw HTML and are more precise than guessing from CSS alone.

## Observed Architecture

Typotheque family pages are rendered by Next.js and include `__NEXT_DATA__` in the document.

Observed examples:
- `https://www.typotheque.com/fonts/fedra-sans`
- `https://www.typotheque.com/fonts/zed-display`

Relevant page signals observed in the HTML:
- `PDF Specimen`
- `Buy`
- `Try`
- `Compare`
- `System Overview`
- `Available in` script/encoding links such as `/fonts/fedra-sans/arabic`

This means a passive scraper can extract a lot of useful metadata directly from the HTML before it touches any deeper endpoint.

## Family Page Findings

### Fedra Sans

Live page:
- `https://www.typotheque.com/fonts/fedra-sans`

Observed HTML links and relations:
- Specimen PDF:
  - `https://assets.typotheque.com/assets/pdfspecimens/fedra-sans.pdf`
- Script variants:
  - `/fonts/fedra-sans/arabic`
  - `/fonts/fedra-sans/armenian`
  - additional script links are present on the page
- More actions:
  - `Compare`
  - `Try`
  - `Rent` via Fontstand

### Zed Display

Live page:
- `https://www.typotheque.com/fonts/zed-display`

Observed HTML links and relations:
- Specimen PDF:
  - `https://assets.typotheque.com/assets/pdfspecimens/Zed.pdf`
- System overview exposes family relations such as:
  - `/fonts/zed-display-extra-compressed`
  - `/fonts/zed-display-compressed`
  - `/fonts/zed-display-condensed`

This suggests that system-overview blocks are useful for discovering adjacent family products or width branches.

## Runtime Asset Findings

Observed via runtime network inspection on `https://www.typotheque.com/fonts/fedra-sans`.

Non-family or site UI fonts:
- `https://www.typotheque.com/_next/static/media/NovemberWebsite-s.p.4afbf268.woff2`
- `https://www.typotheque.com/fonts/and.woff2`

Actual family preview fonts:
- `https://assets.typotheque.com/assets/variable-fonts/FedraSansVF.woff2?v=5.052`
- `https://assets.typotheque.com/assets/variable-fonts/FedraSansVFItalic.woff2?v=5.052`
- `https://assets.typotheque.com/assets/variable-fonts/FedraSansAltVF.woff2?v=5.052`
- `https://assets.typotheque.com/assets/variable-fonts/FedraSansAltVFItalic.woff2?v=5.052`

This is important because the asset host for actual font payloads is `assets.typotheque.com`, not only `www.typotheque.com`.

## Next.js Data Endpoints

Observed build-specific JSON endpoints:
- `https://www.typotheque.com/_next/data/J0abdkFH-WIcRd6WdweGN/en/fonts.json`
- `https://www.typotheque.com/_next/data/J0abdkFH-WIcRd6WdweGN/en/fonts/fedra-sans/buy.json?slug=fedra-sans`
- `https://www.typotheque.com/_next/data/J0abdkFH-WIcRd6WdweGN/en/fonts/fedra-sans/try.json?slug=fedra-sans`

The exact build ID is expected to change over time. A scraper should therefore read it from `__NEXT_DATA__` or from page source rather than hardcoding it.

## `try.json` Findings

Observed in live payload for Fedra Sans:
- Family title and family URL
- Default style metadata
- Encoding list and language counts
- Variable-font metadata with axes and a concrete `fontURL`
- Trial-flow text indicating downloadable trial fonts and hosted-font availability for 30 days
- Error code `450_too_many_trials`

Example data pattern:
- `family.defaultStyle.variableFont.fontURL`
- `family.defaultStyle.location`
- `family.encodings[]`

Practical implication:
- `try.json` is a reliable source for the primary preview/default style and script coverage.

## `buy.json` Findings

Observed in live payload for Fedra Sans:
- Main family metadata
- Licenses and pricing-option structures
- Product hierarchy with style nodes and child products
- Variable-font metadata
- Per-style `fontURL`
- Axis locations for variable instances
- Subset and script-related metadata

Examples observed directly in the payload:
- `Fedra Serif Display Regular`
  - `fontURL: https://assets.typotheque.com/assets/fonts/48/FedSerDis-Regular.woff2?v=1.000`
- `Fedra Mono Light`
  - `fontURL: https://assets.typotheque.com/assets/variable-fonts/FedraMonoLVariable.woff2?v=3.005`
  - variable `location` values for `wght` and `ital`

Practical implication:
- `buy.json` appears to be the canonical structured catalog for style-to-font mapping.
- It is richer than page HTML and more deterministic than scraping `@font-face` alone.

## Script and Language Coverage Signals

Observed in Fedra Sans `try.json`:
- Arabic
- Armenian
- Bangla
- Chinese
- Cyrillic
- Devanagari
- Georgian
- Greek
- Hebrew
- Japanese
- Korean
- Latin
- Syllabics
- Tamil
- Thai

Each encoding includes a language count field, which is useful as a confidence signal for script support claims.

## Specimen and Documentation Patterns

Observed specimen URLs follow a stable pattern on the asset host:
- `https://assets.typotheque.com/assets/pdfspecimens/{file}.pdf`

Confirmed examples:
- `https://assets.typotheque.com/assets/pdfspecimens/fedra-sans.pdf`
- `https://assets.typotheque.com/assets/pdfspecimens/Zed.pdf`

The family page exposes specimen links in the HTML directly, so a scraper does not need to guess these URLs when they are available on-page.

## Safe Scraper Blueprint

Recommended passive extraction sequence for a future Typotheque scraper:

1. Resolve the family slug from `/fonts/{slug}`.
2. Fetch family HTML.
3. Read `__NEXT_DATA__` to obtain the current build ID.
4. Extract direct page metadata:
   - family name
   - specimen PDF URL
   - script variant links
   - system overview links
5. Fetch:
   - `/_next/data/{buildId}/en/fonts/{slug}/buy.json?slug={slug}`
   - `/_next/data/{buildId}/en/fonts/{slug}/try.json?slug={slug}`
6. Merge and normalize:
   - style titles
   - per-style `fontURL`
   - variable-font entries and axes
   - product/family relations
   - encodings and language counts
   - specimen URLs
7. Classify site UI fonts separately from family fonts so the scraper does not contaminate output with fonts like `NovemberWebsite`.

## Precision Notes

High-confidence targets:
- Family slug
- Specimen PDF URLs exposed by page HTML
- Runtime preview font URLs on `assets.typotheque.com`
- Structured style entries in `buy.json`
- Encoding coverage in `try.json`

Likely contamination sources to exclude:
- `/_next/static/media/...`
- site-wide UI fonts such as `NovemberWebsite`
- unrelated utility fonts served from `www.typotheque.com/fonts/...`

## Sources

Primary live pages and endpoints observed on 2026-03-07:
- `https://www.typotheque.com/fonts/fedra-sans`
- `https://www.typotheque.com/fonts/zed-display`
- `https://assets.typotheque.com/assets/pdfspecimens/fedra-sans.pdf`
- `https://assets.typotheque.com/assets/pdfspecimens/Zed.pdf`
- `https://www.typotheque.com/_next/data/J0abdkFH-WIcRd6WdweGN/en/fonts/fedra-sans/buy.json?slug=fedra-sans`
- `https://www.typotheque.com/_next/data/J0abdkFH-WIcRd6WdweGN/en/fonts/fedra-sans/try.json?slug=fedra-sans`

## Conclusion

Typotheque does not require heuristic-only scraping. The site already exposes enough structured passive data to support a precise family scraper:
- family metadata from HTML
- specimen links from page markup
- actual runtime font assets from network activity
- structured product/style/fontURL data from Next.js JSON endpoints

The main engineering requirement is not aggressive discovery. It is disciplined merging and filtering so the scraper prefers family-product data over site-wide noise.