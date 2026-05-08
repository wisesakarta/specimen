# Production Type Deep Research Report
Generated: 2026-02-28T01:27:47+07:00

## Scope
- Target: `https://productiontype.com/`
- Goal: map every actionable corridor for scraper design (catalog discovery, style coverage, asset quality, specimen docs, and delivery/auth gates).
- Method: MCP Chrome DevTools network+DOM tracing, endpoint probing, sitemap crawl, bundle reverse mapping, binary font inspection (fontTools).

## 1) Site Architecture (Verified)
- Stack: Next.js App Router + RSC (`content-type: text/x-component`).
- Locale-aware route tree observed: `/[locale]` (example runtime locale `en-us`).
- RSC headers used by site:
  - `rsc: 1`
  - `next-router-state-tree`
  - `next-router-prefetch`
  - `next-url`
- Matched paths seen in live requests:
  - `/[locale].rsc`
  - `/[locale]/fonts`
  - `/[locale]/buy/[...path].rsc`

Evidence:
- `tasks/reports/productiontype-rsc-req131.response.txt`
- `tasks/reports/productiontype-rsc-font-mars-req222.response.txt`
- `tasks/reports/productiontype-buy-rsc-req297.response.txt`
- `tasks/reports/productiontype-buy-rsc-req305.response.txt`

## 2) URL Surface Mapping (Sitemap + Robots)
- `sitemap.xml` URLs total: **475**
- Top route buckets:
  - `article`: 177
  - `font`: 138
  - `product`: 51
  - `profile`: 50
  - `portfolio`: 27
- `font` route decomposition:
  - total font URLs: **138**
  - top-level font pages (`/font/{slug}`): **49**
  - nested font pages (`/font/{family}/{subfamily...}` or beta trees): **89**
- `robots.txt`:
  - `Disallow: /api/` and `/account/` (crawl policy), but API endpoints are still callable when method/body/auth are correct.

Evidence:
- `tasks/reports/productiontype-sitemap.xml`
- `tasks/reports/productiontype-robots.txt`

## 3) Catalog Data Corridor (High-value)
### 3.1 Next Action endpoint
- Request pattern captured:
  - `POST https://productiontype.com/fonts`
  - header `next-action: f7c9e2c4583f08976916fd8068127f56ecead0e4`
  - body format: `[
    "query.page%3D{n}"
  ]`
- This returns structured payload used by frontend list rendering, including style metadata and `fontFilePath`.

### 3.2 Pagination behavior
- Tested pages 1..12 using the same `next-action` contract.
- Non-empty pages: **1..10**
- Empty payload pages: **11+**
- `resultsCount` consistently observed: **114**

Evidence:
- `tasks/reports/productiontype-post-fonts-req151.request.txt`
- `tasks/reports/productiontype-post-fonts-req151.response.txt`

## 4) Font Asset Tiers (Critical for quality)
Public CDN style assets follow this pattern:
- `/cdn/fonts/{family}/{style}/{version}/{File}.{tier}.woff2`
- tiers observed:
  - `.name.woff2`
  - `.display.woff2`
  - `.tester.woff2`

### 4.1 Binary quality comparison (same style)
Sample: `MarsCondensedWeb-Regular`
- `name`: size 3165 bytes, glyphs 27, GSUB features 0
- `display`: size 8393 bytes, glyphs 76, GSUB features 1 (`frac`)
- `tester`: size 53557 bytes, glyphs 744, GSUB features 22 (`liga`, `ccmp`, `ss01..`, etc.)

Conclusion:
- `.tester.woff2` is the only web tier with near-full feature richness.
- `.name` and `.display` are aggressive subsets.

### 4.2 Naming table behavior
- `name` table in all three tiers is intentionally obfuscated (`.\x7f`, `\x7f`).
- Reliable naming must be URL/metadata-driven, not internal name records.

### 4.3 Direct retail-like filename probing
- Variants like `.otf/.ttf/.woff/.woff2` without known tier suffix return `403` on tested sample paths.
- Indicates gated/non-public delivery for desktop packages.

## 5) Commerce/API Corridor (Live traced)
After valid selection on `/buy/mars?...` (company size + desktop license), flow produced:
1. `POST /api/shopify/cart`
2. `POST /api/shopify/cart/attributes`
3. `POST /api/shopify/cart/lines`
4. redirect/data refresh to `/cart`

Important payload facts:
- cart lines carry `merchandiseId` (Shopify ProductVariant GID) + license/family attributes.
- cart response returns `checkoutUrl` on `checkout.productiontype.com`.

Evidence files (saved from MCP network):
- `tasks/reports/productiontype-api-shopify-cart-req341.request.txt`
- `tasks/reports/productiontype-api-shopify-cart-req341.response.txt`
- `tasks/reports/productiontype-api-shopify-cart-attributes-req348.request.txt`
- `tasks/reports/productiontype-api-shopify-cart-attributes-req348.response.txt`
- `tasks/reports/productiontype-api-shopify-cart-lines-req349.request.txt`
- `tasks/reports/productiontype-api-shopify-cart-lines-req349.response.txt`

## 6) Internal Endpoints From Bundle (Reverse mapped)
From buy chunk references + live probing:
- `/api/shlink`
  - `GET` => 405
  - `POST {"url":...}` => 200 (returns short link)
- `/api/ofl`
  - `GET` => 405
  - `POST {}` => 400 `Missing params`
  - `POST {"styles":[...]}` => 401 `Invalid access token`
- `/api/quote/request`
  - `GET` => 405
  - `POST {}` => 400 `Missing params`

Interpretation:
- `/api/ofl` is authenticated and style-driven; not anonymously callable for download retrieval.
- buy page code shows `/api/ofl` used by “Request download” flow (for signed-in path), and success UI says download is delivered asynchronously by email.

Evidence:
- `tasks/reports/productiontype-chunk-buy-page.js`

## 7) Specimen/Technical PDF Coverage
Regex scan over HTML of all font URLs (`/font/...` from sitemap):
- font URLs scanned: **138**
- URLs containing at least one PDF: **112**
- unique PDF links discovered: **55**

Top-level family pages (`/font/{slug}`):
- top-level scanned: **49**
- with PDF: **48**
- only top-level missing PDF in scan: `https://productiontype.com/font/house-of-cassandre`

PDF host pattern:
- `https://cdn.sanity.io/files/qd7iq686/production/{hash}.pdf`

## 8) Practical Scraper Implications (Actionable)
1. Catalog discovery should prioritize `POST /fonts` with `next-action` over brittle DOM scraping.
2. For maximal public glyph/features quality, prefer `.tester.woff2` whenever available.
3. Normalization must be URL/metadata-driven because font name tables are obfuscated.
4. Retail desktop retrieval cannot be inferred from public CDN filename guessing (`403` barrier).
5. Shop/cart endpoints are good for product/license metadata and checkout orchestration, not direct anonymous font package extraction.
6. Specimen pipeline should include PDF extraction from font page HTML (Sanity PDF links), with dedupe by URL hash.

## 9) Confidence + Remaining Blind Spots
High confidence:
- route mapping, endpoint contracts, cart flow, asset tier behavior, specimen PDF extraction.

Open blind spots (auth-gated by design):
- exact authenticated `/api/ofl` response schema on valid user token.
- post-checkout delivery internals (retail package fulfillment path).

## Artifact Index (this session)
- `tasks/reports/productiontype-api-shopify-cart-req341.request.txt`
- `tasks/reports/productiontype-api-shopify-cart-req341.response.txt`
- `tasks/reports/productiontype-api-shopify-cart-attributes-req348.request.txt`
- `tasks/reports/productiontype-api-shopify-cart-attributes-req348.response.txt`
- `tasks/reports/productiontype-api-shopify-cart-lines-req349.request.txt`
- `tasks/reports/productiontype-api-shopify-cart-lines-req349.response.txt`
- `tasks/reports/productiontype-post-fonts-req151.request.txt`
- `tasks/reports/productiontype-post-fonts-req151.response.txt`
- `tasks/reports/productiontype-sitemap.xml`
- `tasks/reports/productiontype-robots.txt`
- `tasks/reports/productiontype-chunk-buy-page.js`
- `tasks/reports/productiontype-chunk-font-family-page.js`
- `tasks/reports/productiontype-chunk-fonts-page.js`
- `tasks/reports/productiontype-rsc-req131.response.txt`
- `tasks/reports/productiontype-rsc-font-mars-req222.response.txt`
- `tasks/reports/productiontype-buy-rsc-req297.response.txt`
- `tasks/reports/productiontype-buy-rsc-req305.response.txt`
