# Due Studio (due-studio.com) Librarian Research

Date: 2026-03-11

## Scope

Goal: identify where Due Studio exposes font assets (trial + preview webfonts) and specimen PDFs so we can build a precise scraper (without guessing) and avoid false claims about “retail” coverage.

## Site Tech / Surface

- Platform: **Webflow** (static HTML, `webflow.*.js`, `cdn.prod.website-files.com`).
- Key IDs observed in HTML:
  - `data-wf-site="6032522b994d4a7ce92d47bd"`
  - Typeface CMS collection: `data-wf-collection="6216061f801c0b23e9019622"`
- `GET /robots.txt` returns 200 but **empty**.
- `GET /sitemap.xml` returns **404** (so cataloging should not rely on sitemap).

## Primary Routes

- Catalog: `https://www.due-studio.com/typefaces`
  - Lists all families (11) with detail pages at `/typefaces/<slug>`.
  - Exposes a global trial bundle ZIP:
    - `https://www.dropbox.com/s/8wwt8w96lk1vgi4/2S%20Trials.zip?dl=0`
- Licensing + trial policy: `https://www.due-studio.com/typefaces-information`
  - Explains: files delivery is via email after payment (no public “retail download” endpoint on site).
  - Trial policy: trial fonts are **limited character set** and **non-commercial**.
  - EULA PDF link:
    - `https://www.dropbox.com/s/h58l6gju0iczzxt/2S_EULA_Generale_1.2.pdf?dl=0`
- Detail pages: `https://www.due-studio.com/typefaces/<slug>`
  - Contains typetester UI, style list, stylistic sets, and a specimen PDF download link.
  - “Buy” is a **request form** (not a checkout); delivery is described as email-based.

## Asset Topology (Observed)

### 1) Specimen PDFs (Public)

Each family page includes exactly **one** specimen PDF, hosted on Webflow’s asset CDN:

- Pattern:
  - `https://cdn.prod.website-files.com/60351989d1ef1023fa5007f9/<assetId>_<name>.pdf`

### 2) Web Preview Fonts (Public, WOFF)

Family pages embed `@font-face` pointing to Dropbox’s raw-content domain.

Observed URL patterns:

- Legacy:
  - `https://dl.dropboxusercontent.com/s/<id>/<File>.woff?raw=1`
- Newer (Dropbox “scl/fi” style):
  - `https://dl.dropboxusercontent.com/scl/fi/<id>/<File>.woff?rlkey=<...>&dl=0?raw=1`

Important gotchas:

- Many pages contain **HTML entities** inside CSS strings, e.g. `&amp;dl=0...`.
  - Scraper must normalize (best: HTML-decode the entire inline `<style>` block before parsing).
- Many pages contain **bogus placeholder “fonts”**:
  - `<link rel="preload" href="?raw=1" as="font" ...>`
  - `src: url("?raw=1") format("woff");`
  - This causes the browser to request `.../typefaces/<slug>?raw=1` as if it were a font.
  - Scraper must ignore any non-absolute font URL candidates (especially `?raw=1`).
- `type="font/woff2"` is used in preloads even when the extension is `.woff`.
  - Do not trust the `type=` attribute; use the URL and/or response headers.
- Duplicates + dead links exist and must be handled:
  - Example: **Grotta** includes 2 candidates for `Grotta-Regular.woff`; one candidate 404s in real browsing.
  - Strategy: group by filename, try candidates until you get a 200.

Concrete validation (Grotta Regular):
- `https://dl.dropboxusercontent.com/scl/fi/wxitgpre7p1pghh46ik31/Grotta-Regular.woff?...` => **404**
- `https://dl.dropboxusercontent.com/scl/fi/9ltdzii38fkjgtanzlpqe/Grotta-Regular.woff?...` => **200**

### 3) Trial Fonts (Public via Dropbox, Subset By Design)

Every family has a “Trial” button to a public Dropbox folder share (`dropbox.com/sh/...` or `dropbox.com/scl/fo/...`).

Observed content (sampled on the Decay trial folder):

- Trial EULA PDF (example: `2S_EULA_Trial_1.2.pdf`)
- Trial font files in **OTF** and **TTF**
- Optional subfolders (example: `Variable/`)

Critical policy detail (from `typefaces-information`):

- Trial fonts are limited to a **basic set** (upper/lowercase, figures, limited punctuation) and **cannot be used** for commercial/portfolio/academic use.
- Therefore, trial downloads are **not** full retail glyph coverage and should be labeled as such.

### 4) Retail Fonts (Not Publicly Exposed)

Due Studio’s own documentation states files are delivered by email after payment, and the “Buy” flow is a request form.

Conclusion: we can build a perfect scraper for:

- specimen PDFs
- preview webfonts
- trial bundles

But we should not claim “retail font acquisition” from public pages.

## Catalog Inventory (11 Families)

Summary extracted from live HTML (see JSON artifact below).

Columns:
- `trial`: Dropbox folder share exists on the page
- `preview webfont files`: unique filenames (after grouping by filename; duplicates not double-counted)

| slug | trial | specimen pdf | preview webfont files | notes |
|---|---:|---:|---:|---|
| analo-grotesk | yes | 1 | 1 | page copy mentions 269 glyphs |
| autaut-grotesk | yes | 1 | 5 | page copy mentions 730 glyphs |
| decay | yes | 1 | 2 | styles mention “Variable font” (not exposed as preview webfont) |
| grotta | yes | 1 | 14 | duplicate `Grotta-Regular.woff` candidates; at least one 404 |
| kovskij-display | yes | 1 | 1 |  |
| lay-grotesk | yes | 1 | 5 | page copy mentions 785 glyphs |
| neue-brucke | yes | 1 | 1 | duplicate `NeueBrucke-Regular.woff` candidates (2 URLs) |
| nodo | yes | 1 | 1 |  |
| plat-mono | yes | 1 | 4 | duplicate `PlatMono-Regular.woff` candidates (2 URLs); page copy mentions 4 styles |
| pvf-display | yes | 1 | 1 |  |
| slack-light | yes | 1 | 1 | page copy mentions 530 glyphs |

## MonoLisa-Parity Research Notes (Mandatory Reference)

MonoLisa’s “perfect” scraper is fundamentally:

1. Fetch a canonical source (CSS/HTML)
2. Extract `@font-face` blocks into structured entries
3. Normalize/rewrite URLs deterministically
4. Build an explicit `targetProfile` (expected styles/features thresholds)

Due Studio can (and should) follow the same structure, with a different canonical source:

- Canonical source: **per-family HTML** at `/typefaces/<slug>` (Webflow renders the required CSS inline).
- Instead of MonoLisa payload rewrite, we apply a **Dropbox URL normalizer + candidate selector**:
  - HTML-decode (`&amp;` etc.)
  - remove bogus placeholders (`?raw=1`)
  - sanitize trailing `)`/`;`
  - group by filename
  - test candidate URLs (200 wins; fallback to next)

Extra advantage vs generic: Due Studio pages publish a *human* ground-truth style list, so we can build a strict quality gate like MonoLisa’s `expectedStaticStyles`:

- Each family page contains an info grid with:
  - `Styles` → comma-separated list (e.g. `Regular, Medium, Semibold, Bold, Black`)
  - `Designer`, `Release`, `Encoding`
- This is parseable from static HTML (no JS required) and can drive:
  - `expectedStyles`
  - `expectedStyleCount`
  - `strictMissingStyles` (with one special-case: when `Styles` mentions “Variable font”, preview webfonts may still omit it)

Stylistic sets on Due Studio pages:
- Many pages include template handlers for `ss00`..`ss20` in the UI HTML.
- This is **not** reliable proof that the binary fonts actually implement those OpenType features.
- Treat UI ss-list as *presentation controls*, not as an audit requirement. Real feature audit should come from downloaded font tables (GSUB/GPOS).

## Scraper Blueprint (For Later Implementation)

1. Cataloging:
   - Fetch `https://www.due-studio.com/typefaces`
   - Extract unique `/typefaces/<slug>` links.

2. Per-family extraction (`/typefaces/<slug>`):
   - Specimen:
     - Collect the single `cdn.prod.website-files.com/.../*.pdf` link.
   - Preview webfonts:
     - Parse inline `@font-face` blocks (MonoLisa-style: `extractBlocks()` + `pick()` helpers) and/or `<link rel="preload" as="font">`.
     - Keep only absolute `https://dl.dropboxusercontent.com/...` URLs with `.woff` (and `.woff2` if present later).
     - HTML-decode entities first.
     - Ignore placeholders like `?raw=1`.
     - Group by filename and test candidates (prefer HTTP 200; fallback to next URL).
   - Trial:
     - Extract the Dropbox share folder URL containing `dl=0` (normalize entities).

3. Trial acquisition:
   - Dropbox share pages are JS-heavy and may show consent banners; a browser-based approach is the most reliable way to:
     - download the folder as a ZIP (if available), or
     - enumerate files (including subfolders like `Variable/`) and download them.
   - Always include the trial EULA PDF when present.

4. Labeling expectations:
   - Mark assets clearly:
     - `trial` = subset by design (limited glyph set)
     - `web-preview` = WOFF used for on-site tester (may differ from retail)
   - Avoid reporting “full glyph coverage” unless you can verify from the binary tables (OS/2, cmap, GSUB/GPOS) and it matches the foundry claims.

## Artifacts

- Inventory JSON (live crawl, per-family assets + preview URL candidates grouped by filename):
  - `tasks/reports/due-studio-typefaces-inventory-2026-03-11.json`
- Detail JSON (adds `stylesText/styles`, `glyphMention`, and per-file candidate URL groups):
  - `tasks/reports/due-studio-typefaces-detail-2026-03-11.json`
