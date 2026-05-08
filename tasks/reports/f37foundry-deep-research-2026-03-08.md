# F37 Foundry Deep Librarian Research (2026-03-08)

## Scope
- Target: `https://www.f37foundry.com/`
- Method: browser instrumentation via MCP Chrome (network capture, runtime script injection, route traversal), plus local JS chunk inspection.
- Session date: March 8, 2026.

## Executive Summary
- F37 stack is **Next.js + dual GraphQL backends**:
  - Commerce/session/cart: `https://api.f37foundry.com/graphql`
  - Catalog/content/metadata: `https://graphql.datocms.com/` (public bearer token observed in client requests)
- Font delivery is split:
  - Preview subsets: `https://cdn.f37foundry.com/fonts/public/...`
  - Full website-loaded style assets: `https://cdn.f37foundry.com/fonts/licensed/...`
- Trial download access is account-gated:
  - Guest access to `/account/trial-downloads` redirects to `/login?redirect=/account/trial-downloads`.

## Verified Architecture
1. Frontend
- Next.js static chunks and data routes:
  - `/_next/static/chunks/*.js`
  - `/_next/data/{buildId}/...`
- Runtime injection confirmed:
  - `buildId`: `410GmJeaGiTIO6zUbL_oE`
  - page: `/fonts/[slug]`

2. API Layer
- `api.f37foundry.com/graphql` handles:
  - user session identity
  - cart
  - buying options/pricing
  - logout/session mutation
- `graphql.datocms.com` handles:
  - font-by-slug metadata
  - OpenType feature registry
  - fonts-in-use
  - page SEO/meta and global IDs

## Request Map (Captured)

### A. Commerce GraphQL (`api.f37foundry.com/graphql`)
- `UserId`
  - reqid: `33`, `71`, `332`, `364`
  - guest response: `AUTHENTICATION_ERROR` (`viewer field requires authentication`)
- `Cart`
  - reqid: `34`, `333`
  - returns cart id/currency/items/subtotal
- `BuyingOptions`
  - reqid: `116`, `117`
  - input variable: `fontId`
  - returns pricing matrices for `style` and `family` across `basic/web/app/social/logo`
- `UserLogout`
  - reqid: `331`
  - guest response: `USER_ERROR` (`User was not found or was not logged in.`)

### B. Content GraphQL (`graphql.datocms.com`)
- `FontBySlug`
  - reqid: `93`
  - returns deep metadata:
    - styles, axes, instances, metrics
    - glyphs and `glyphCount`
    - `opentypeFeatures`
    - script variants
    - `specimen.url` (PDF)
    - typetester presets
- `ChildFontsSummary`
  - reqid: `94`
  - query by parent id
- `OpentypeFeatures`
  - reqid: `100`
  - feature tags registry (`liga`, `ss01`, `tnum`, etc.)
- `FontsInUseByFontId`
  - reqid: `101`
- `PageSEO`
  - reqid: `120`
  - includes `_seoMetaTags` + fonts/custom-fonts/products IDs

## Next Data Route Behavior
- `/_next/data/.../fonts/f37-analog.json?slug=f37-analog` (reqid `91`)
- `/_next/data/.../buying-options/f37-analog.json?slug=f37-analog` (reqid `119`)

Observation:
- Despite `.json` route and `x-nextjs-data:1`, response body is HTML document payload with large inline `@font-face`.

## Font Asset Topology

1. Public subset preview fonts
- Pattern:
  - `https://cdn.f37foundry.com/fonts/public/{family}/{style}/U+... .woff2`
- Typical use:
  - homepage/library preview
  - minimal glyph ranges

2. Licensed path assets
- Pattern:
  - `https://cdn.f37foundry.com/fonts/licensed/{family}/{style}.woff2`
- Seen on font detail pages and typetester CSS.
- Includes static styles and variable font (`*-VF.woff2`) when available.

3. Runtime script injection result (font page)
- Injected extraction output:
  - `styleTagCount`: `3`
  - `fontFaceCount`: `169`
  - unique CDN font URLs discovered from CSS: `88`

## Trial Flow and Access Control
- Route `https://www.f37foundry.com/account/trial-downloads` redirects guest to login.
- Login page explicitly states account benefits include access to latest trial fonts.
- Therefore, unauthenticated scraper cannot reliably enumerate/download trial package assets from this route.

## Local Artifact Inventory
- Network-derived chunks:
  - `tasks/reports/f37-artifacts/chunks-all/*.js`
- Additional sampled chunks:
  - `tasks/reports/f37-artifacts/395-ee65f3d14e8772d4.js`
  - `tasks/reports/f37-artifacts/8169-e15996acfbb0ca31.js`
  - `tasks/reports/f37-artifacts/d37e5859-ee86f483f5020cbf.js`
  - `tasks/reports/f37-artifacts/ea88be26.f9ec65a00601ad5a.js`

## Implementation Guidance (Scraper Blueprint)

1. Primary source of truth for metadata
- Use Dato GraphQL `FontBySlug` as canonical catalog metadata.
- Extract:
  - family/script structure
  - style list (+ variable flag)
  - specimen PDF URL
  - glyph/features/language metadata

2. Pricing/cart layer
- Use commerce GraphQL only for pricing/cart semantics:
  - `BuyingOptions`
  - `Cart`
- Do not use it as primary source for style taxonomy (metadata is richer in Dato).

3. Font file capture strategy
- Distinguish by URL signature:
  - `/fonts/public/` => preview subset (low confidence)
  - `/fonts/licensed/` => style assets used in site typetester (higher confidence)
- For artifact naming, strip transport noise and keep:
  - family slug
  - style token
  - extension

4. Trial handling
- Add explicit gate state:
  - `trial_access: locked_guest` when redirected to login.
- Avoid false negatives by reporting “auth required” rather than “no trial assets”.

5. Specimen coverage
- Pull `font.specimen.url` directly from Dato response.
- This should be mandatory in F37 pipeline to avoid missing specimen PDFs.

## Risks / Constraints
- Public Dato token and schema can change at any time; implement retries + schema tolerance.
- Some `/licensed/` assets may still represent web-optimized packages, not commercial full desktop bundles.
- Trial assets are not fully discoverable in guest mode.

## Current Conclusion
- Research is complete for guest-access engineering coverage of F37.
- We now have a concrete operation map, route behavior, asset topology, and implementation path for a robust F37 scraper.
