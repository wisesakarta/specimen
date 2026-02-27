# TYPE DEPARTMENT — DEEP LIBRARIAN RESEARCH (AKSARA)
Generated: 2026-02-26

## Scope
- Target: `https://type-department.com/`
- Method: MCP Chrome DevTools + public endpoint crawl + full product-page crawl
- Dataset: `tasks/reports/type-department-research-2026-02-26.json`

## Key Findings
- Platform is Shopify (public JSON endpoints are open and stable).
- Product catalog is large and mixed:
  - `148` products in `products.json`
  - `149` product URLs in sitemap (includes homepage entry)
  - `129` collection URLs in sitemap
- Product pages usually expose a free-trial CTA:
  - `121` products with `trial-zip` links
  - `129` products with any `.zip` link
- Preview/tester font source is mostly Firebase-hosted WOFF:
  - `135` product pages embed Firebase font URLs in HTML
  - max observed = `16` styles on one page (`melange`)
- Specimen/technical PDF signals:
  - `0` product pages with specimen/technical CTA
  - license CTA exists on all sampled products, but points mostly to licensing pages/guide links.

## URL & Endpoint Map
- Product page: `/products/{handle}`
- Product JSON: `/products/{handle}.js`
- Catalog JSON: `/products.json?limit=250`
- Collection JSON: `/collections/{handle}/products.json?limit=250`
- Search suggest: `/search/suggest.json?q={q}&resources[type]=product`
- Cart API signals: `/cart.js`, `/cart.json`, `/cart/add.js`
- Sitemap index: `/sitemap.xml`
- Important: do **not** call `/sitemap_products_1.xml` directly (returns 400 without query params). Always use sitemap nodes discovered from `/sitemap.xml`.

## Naming Patterns
- Handle pattern: kebab-case (`[a-z0-9-]+`), but includes noisy internal products:
  - e.g. `option-set-369847-select-3`, `option-set-369847-select-2`
- Style option naming is inconsistent across products:
  - canonical-like: `Regular`, `Medium`, `Light Italic`, `Black`
  - noisy variants: `Semi Bold`, `Demi italic`, `Font Family`, etc.
- License option naming is also inconsistent:
  - `Desktop License` vs `Desktop`
  - `App/Game` vs `App / Game`
  - `Logo/Mark` vs `Logo / Mark`

## Asset Source Behavior
- Trial/demo packages are mostly on Shopify CDN (`cdn.shopify.com/...files/...zip`).
- Some pages use direct desktop file links (`.otf`) instead of ZIP.
- Many pages expose Firebase WOFF links for browser tester preview only (`firebasestorage.googleapis.com/...fontsL/...woff`).
- Several free-font or edge products have no usable ZIP anchor at all.

## Brain / Machine / Workshop Blueprint

### Brain (selection + intelligence)
- Entry source of truth:
  1. `/products.json?limit=250`
  2. product sitemap URLs from `/sitemap.xml`
  3. optional collection JSON for scoped crawl
- Product eligibility rules:
  - include `product_type` in `{Font, Free Fonts}` or has font-like options/tags
  - exclude known noise handles (`option-set-*`) by rule
- Family/style extraction:
  - base family from product `title`
  - style set from product variants (`option2`), normalized via token map
- License axis extraction:
  - read variant `option1` and normalize to canonical tokens (`desktop`, `web`, `app-game`, `broadcasting`, `logo-mark`, `non-profit`)

### Machine (downloader + parser)
- Primary acquisition order:
  1. HTML anchor extraction for `.zip`, `.otf`, `.ttf`
  2. classify by intent token (`trial|demo|test|free`) in URL/text
  3. fallback to Firebase WOFF list only as preview-level source (low fidelity)
- Hard rule:
  - do not treat Firebase tester WOFF as retail-equivalent payload
- Per product output should contain:
  - `sourceType`: `trial-zip` | `demo-zip` | `direct-otf/ttf` | `preview-woff-fallback`
  - `provenance` URL and classification reason

### Workshop (normalization + quality gate)
- Filename canonical proposal:
  - `type-department-{handle}-{style-slug}.{ext}`
- Style normalization map needed for noisy labels:
  - `semi bold -> semibold`
  - `demi italic -> demi-italic`
  - `font family -> family`
- Quality gate tiers:
  - `pass`: has packaged source (`zip/otf/ttf`) + style mapping coverage >= target threshold
  - `warn`: only preview WOFF source
  - `fail`: no downloadable asset source
- Expected fail/warn candidates already identified in JSON (`noZip` and no-firebase/no-asset rows).

## Constraints Confirmed
- Public endpoints do not expose authenticated retail delivery package directly.
- Download links on product pages are mostly trial/demo-oriented assets.
- No reliable specimen/technical PDF channel found from product pages in current crawl.

## Recommended Next Step
- Implement `src/lib/scrapers/type-department.ts` with:
  - Shopify JSON ingestion
  - HTML asset extraction
  - strict source provenance labeling
  - noise-handle exclusion
  - style/license canonicalization table
