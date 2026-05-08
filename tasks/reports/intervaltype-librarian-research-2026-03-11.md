# Interval Type (intervaltype.com) Librarian Research

Date: 2026-03-11

## Scope

Goal: identify where Interval Type exposes font assets + specimen PDFs on public pages so we can build a precise scraper (without guessing).

## Site Tech / Surface

- Platform: WordPress + WooCommerce.
- WordPress lives under `/app/` (e.g. `/app/plugins/...`, `/app/themes/...`, `/app/uploads/...`).
- Public catalog endpoint:
  - `GET https://intervaltype.com/wp-json/wp/v2/product?per_page=100&page=1&_fields=slug,link,title`
  - Current total: 23 products (typefaces / families).

## Primary Asset Patterns (Observed)

### 1) Specimen PDFs

Product pages commonly embed a specimen PDF under:

- `/app/uploads/YYYY/MM/<Something>-Specimen*.pdf`

Example (Algorytm Clear):

- `https://intervaltype.com/app/uploads/2025/06/AlgorytmClear-Specimen.pdf`

### 2) Webfont Preview Assets (WOFF/WOFF2)

Product pages include inline CSS `@font-face` definitions referencing files in `/app/uploads/...`:

- `/app/uploads/YYYY/MM/<Family>-<Style>.woff`
- `/app/uploads/YYYY/MM/<Family>-<Style>.woff2`

These are the most reliable public signals for per-style coverage because they enumerate per-weight/per-style faces.

### 3) “Full Family WEB” ZIP Packages

Many product pages also reference a zip (often named “Full Family WEB”):

- `/app/uploads/YYYY/MM/<Family>-Full-Family-WEB.zip` (and variants like `...Web.zip`)

Important detail: on-page CSS sometimes declares the ZIP inside `@font-face src:url(...zip) format("woff")` which is not a valid browser font source. This strongly suggests the ZIP is for download (or for a custom JS unzip flow), while real preview rendering uses the WOFF/WOFF2 faces.

We should treat ZIP as an optional additional asset to download/extract (when present), but not depend on it for coverage.

## Product Inventory (WP REST catalog)

Below is a scan summary of each product page for:
- `zip`: number of `/app/uploads/*.zip` URLs found
- `pdf`: number of `/app/uploads/*.pdf` URLs found (typically specimen)
- `woff`: number of `/app/uploads/*.woff|woff2` URLs found
- `@font-face`: count of `@font-face` blocks on the page

| slug | zip | pdf | woff | @font-face |
|---|---:|---:|---:|---:|
| algorytm | 1 | 1 | 16 | 17 |
| algorytm-clear | 1 | 1 | 12 | 13 |
| algorytm-flip | 1 | 1 | 8 | 9 |
| algorytm-mono | 1 | 1 | 6 | 7 |
| algorytm-soft | 1 | 1 | 8 | 9 |
| algorytm-sport | 0 | 1 | 1 | 1 |
| englisch | 0 | 1 | 13 | 13 |
| factor-a-mono | 1 | 1 | 5 | 6 |
| factor-a-variable | 1 | 1 | 56 | 57 |
| factor-b | 0 | 1 | 6 | 7 |
| oceanic | 1 | 1 | 12 | 13 |
| oceanic-gothic | 1 | 1 | 12 | 13 |
| oceanic-grotesk | 1 | 1 | 12 | 13 |
| oceanic-grotesk-compact | 1 | 1 | 12 | 13 |
| oceanic-grotesk-condensed | 1 | 1 | 12 | 13 |
| oceanic-text | 1 | 1 | 10 | 11 |
| oceanictext-mono | 0 | 1 | 4 | 5 |
| riegla | 0 | 1 | 10 | 11 |
| riegraf | 0 | 1 | 10 | 11 |
| rooftop | 1 | 1 | 96 | 97 |
| rooftop-mono | 0 | 1 | 3 | 4 |
| rooftop-old | 0 | 1 | 16 | 17 |
| stravinsky | 0 | 1 | 7 | 7 |

Notes:
- Some specimen PDFs are shared across related products (e.g. `Oceanic_Specimen_2024.pdf` appears for both Oceanic and Oceanic Text).
- ZIP matches in HTML may include a trailing `)` due to `url(...zip)` syntax; extraction should sanitize by trimming trailing `)`/`;`.

## Scraper Design Implications (For Later Implementation)

1. Cataloging:
   - Use WP REST `wp/v2/product` to list all product links (family pages).

2. Font extraction:
   - Parse product HTML for `@font-face` blocks.
   - Only accept `src` URLs under `/app/uploads/` (to avoid theme/fonts noise).
   - Collect `.woff2` + `.woff` assets; group by `font-family`, `font-weight`, `font-style`.
   - Optionally also collect the “Full Family WEB” `.zip` if present:
     - Download + extract fonts inside (woff/woff2/ttf/otf if present) and de-duplicate with per-face assets.

3. Specimen extraction:
   - Pull specimen PDFs from `/app/uploads/*.pdf` but filter to “Specimen” relevance (exclude generic license PDFs if any).

4. Quality & coverage:
   - Expected styles should be derived from the `@font-face` inventory (weight/style pairs), not from text copy.
   - Keep `strictMissingStyles=true` when the page enumerates faces (most pages do).

