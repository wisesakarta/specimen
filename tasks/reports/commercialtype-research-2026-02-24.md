# Commercial Type Deep Research (2026-02-24)

## Scope
- Target: `https://commercialtype.com`
- Goal: map architecture for analyzer/downloader/audit integration.
- Method: browser MCP + source module inspection + JSON schema decode.

## Key URL Patterns
- Collection page: `/catalog/<collection-slug>`
  - Example: `/catalog/focal`
- Style page: `/catalog/<collection-slug>/<family-slug>/<style-slug>`
  - Example: `/catalog/focal/focal/light`
- Bootstrap data endpoint (from page dataset): `/json/<data-catalog>`
  - Example resolved from page: `/json/catalog.js/?t=1770323550`

## Important Findings

### 1) Catalog bootstrap is the core source of truth
- `document.body.dataset.catalog` is present on catalog pages.
- Frontend loads data with:
  - `GET /json/${document.body.dataset.catalog}`
- The JSON payload is global and large, containing:
  - `collections`, `families`, `styles`, `variable_fonts`
  - `style_options`, `otf_groups`, `languages`, `scripts`, `axes`

### 2) Internal tuple schemas are stable (decoded from site JS)
- `Collection.create(source, data)`:
  - `source[0]=id`
  - `source[1]=catalog_item_id`
  - `source[2]=name`
  - `source[3]=base_price_index -> data.prices`
  - `source[4]=collection_style_ids`
  - `source[5]=base_price_additions`
- `Family.create(source, data)`:
  - `source[0]=id`
  - `source[1]=catalog_item_id`
  - `source[2]=collection_id`
  - `source[3]=multi_script_collection_id`
  - `source[4]=name`
  - `source[5]=base_price_index -> data.prices`
  - `source[6]=languages_encoded`
  - `source[7]=similar_family_ids`
  - `source[8]=style_option_ids`
  - `source[9]=short_names_flag`
- `Style.create(source, data)`:
  - `source[0]=id`
  - `source[1]=catalog_item_id`
  - `source[2]=family_id`
  - `source[3]=name_index -> data.names`
  - `source[4]=base_price_index -> data.prices`
  - `source[5]=weight_index -> data.weights`
  - `source[6]=italic_style_id`
  - `source[7]=italic_for_id`
  - `source[8]=otf_encoded` (OpenType feature blocks)
  - `source[9]=languages_encoded`
  - `source[10]=family_name_fallback`
  - `source[11]=style_option_ids`
  - `source[12]=position`
  - `source[13]=layers`
  - `source[14]=css_family_suffix`
- `VariableFont.create(source, data)`:
  - mapped through indices `[0..13]` with family/collection binding, axes, contained maps.

### 3) Webfont path formula is explicit in frontend code
- Static style base path:
  - `/webfonts/${family_name_slug}/${familyBaseName}-${styleNameNoSpace}${styleOptionSuffix}${layerSuffix}-Web`
  - Loader requests `.woff2` and `.woff`.
- Variable font path:
  - `/webfonts/${parent_path}${base_name}${style_options_suffix}-VF-Web.woff2`

### 4) Style options alter file suffixes
- If style has no own style options, frontend falls back to family-level options.
- Real example observed:
  - `Graphik Regular` loads `Graphik-Regular-Cy-Gr-Web.woff2`
  - `Cy/Gr` comes from family style options (`Cyrillic`, `Greek`).

### 5) Trial is email-gated
- Frontend opens trial UI via:
  - `GET /trials/open/<type:id>`
- Submit goes to:
  - `POST /trials`
- Response text indicates one-time link sent by email.
- No direct retail package URL exposed in this flow.

### 6) Specimen PDFs are extractable
- Collection pages expose `SPECIMEN` links in DOM.
- Example:
  - `/uploads/.../Focal-family.pdf`
- Multiple specimens can exist on one collection (Graphik showed 12 links).

## Evidence Artifacts
- `tasks/reports/commercialtype-catalog-js.json`
- `tasks/reports/commercialtype-style-data.js`
- `tasks/reports/commercialtype-family-data.js`
- `tasks/reports/commercialtype-collection-data.js`
- `tasks/reports/commercialtype-variable-font-data.js`
- `tasks/reports/commercialtype-font_loader.js`
- `tasks/reports/commercialtype-trial-interface.js`
- `tasks/reports/commercialtype-focal-decode.json`
- `tasks/reports/commercialtype-style-map.json`

## Implementation Direction (Safe + Deterministic)

### Otak (Analyzer)
- Parse target URL to mode:
  - collection URL
  - family/style URL
- Fetch target page HTML and read `data-catalog`.
- Fetch `/json/<data-catalog>` and decode tuples to rich objects.
- Resolve target scope by slug match and build deterministic style set.
- Extract specimen PDFs from HTML (`href*.pdf`) and normalize names.
- Decode languages and OTF feature blocks using:
  - `scripts/languages`
  - `otf_groups`

### Mesin (Downloader)
- Prefer `batch-direct` for `webfonts/*` URLs built from decoded style objects.
- Strict filter by resolved style IDs (no broad domain capture).
- Name outputs from decoded metadata, not URL hashes:
  - `<Family>-<Style>.woff2` (+ converted formats if configured).
- Keep style-option suffix explicit when present:
  - e.g. `Graphik-Regular-Cy-Gr.woff2`.

### Bengkel (Audit)
- Validate:
  - expected style count vs downloaded style count
  - file validity
  - contamination rate (foreign family/style)
  - naming accuracy from decoded metadata
- Attach report in existing naming format (`download-log.json` + audit section).

## Constraint Note
- Public flow observed here reliably exposes tester/webfont assets and specimen PDFs.
- Retail package delivery remains license/auth flow dependent and is not directly exposed by the public trial endpoint.
## Edge Cases to Handle
- Not all families belong to a named collection path.
  - From decoded catalog snapshot:
    - `families=295`
    - `withCollection=225`
    - `withNoCollection=70`
- Therefore style URL reconstruction must support both forms:
  - 3-segment: `/catalog/<collection>/<family>/<style>`
  - 2-segment fallback: `/catalog/<family>/<style>`
- Some style rows reference missing/legacy family IDs and rely on `family_name` fallback field.
  - From snapshot: `styles=3093`, `styleWithMissingFamily=92`.
  - Analyzer should keep these rows but mark relation confidence as `fallback`.
