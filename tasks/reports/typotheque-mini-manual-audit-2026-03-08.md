# Typotheque Mini Audit (3 Slugs)

Generated: 2026-03-08
Source run: `tasks/reports/typotheque-mini-2026-03-08T04-00-47-889Z.json`

## Scope
- zed-text
- zed-icons
- fedra-sans

## Result Snapshot

| Slug | Quality Status | Expected Styles | Matched | Missing | Coverage | Family Coverage | Desktop Valid Fonts | Ligature Signal |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| zed-text | pass | 72 | 72 | 0 | 100% | 100% | 73 | `liga,dlig,calt` on 100% files |
| zed-icons | pass | 1* | 1 | 0 | 100% | interpreted as covered (see note) | 37 | no OpenType feature tags (icon font profile) |
| fedra-sans | pass | 50 | 50 | 0 | 100% | 100% | 54 | `liga,dlig,calt` on 100% files |

\* `zed-icons` target profile currently declares one expected style (`Zed Icons Regular Large`), while observed output contains 36 realized variants from VF explosion.

## Detailed Findings

### 1) zed-text
Output directory:
`D:\01PROJECTS\ACTIVE\SPECIMEN\downloads\typotheque-mini-2026-03-08t04-00-47-889z\zed-text\typotheque\zed-text`

- Variant/family coverage:
  - Expected styles: 72
  - Matched styles: 72
  - Missing: 0
  - `styleMetrics` null entries: 0 (all expected styles backed by real validated files)
  - Family observed: `Zed Text` (fully aligned)
- Glyph/feature/ligature:
  - Glyph count: min=max=avg 2523
  - cmap entries: min=max=avg 1306
  - Feature count: min=max=avg 39
  - Dominant tags include `liga`, `dlig`, `calt`, `ss01..ss15`, numeric features (`lnum`, `onum`, `pnum`, `tnum`)
  - Ligature tags:
    - `liga`: 100%
    - `dlig`: 100%
    - `calt`: 100%

Verdict: coverage variant + metadata quality very strong.

### 2) zed-icons
Output directory:
`D:\01PROJECTS\ACTIVE\SPECIMEN\downloads\typotheque-mini-2026-03-08t04-00-47-889z\zed-icons\typotheque\zed-icons`

- Variant/family coverage:
  - Quality expected style model: 1 style, matched 1
  - Observed rendered variants in output: 36 icon variants (`Round`/non-round, weights, `Large/Small`)
  - Base VF instance count: 36 (checked from `Zed-Icons-Regular.woff2`)
  - Family observed: `Zed Icons`
- Glyph/feature/ligature:
  - Glyph count: min=max=avg 2006
  - cmap entries: min=max=avg 1822
  - Feature count: 0 across desktop files
  - No ligature tags present (`liga/dlig/rlig/clig/calt` all 0%)

Verdict: variant output appears complete for icon VF (36/36), but quality expected-style profile is under-modeled (currently too minimal).

### 3) fedra-sans
Output directory:
`D:\01PROJECTS\ACTIVE\SPECIMEN\downloads\typotheque-mini-2026-03-08t04-00-47-889z\fedra-sans\typotheque\fedra-sans`

- Variant/family coverage:
  - Expected styles: 50
  - Matched styles: 50
  - Missing: 0
  - `styleMetrics` null entries: 0
  - Expected families observed fully:
    - `Fedra Sans`
    - `Fedra Sans Alt`
    - `Fedra Sans Display`
- Glyph/feature/ligature:
  - Glyph count: min 934, max 1743, avg 1554.69
  - cmap entries: min 384, max 895, avg 802.93
  - Feature count: min 7, max 36, avg 29.06
  - Frequent tags: `liga`, `dlig`, `calt`, `case`, `kern`, `ordn`, plus numeric + small caps sets on many styles
  - Ligature tags:
    - `liga`: 100%
    - `dlig`: 100%
    - `calt`: 100%

Verdict: family and style coverage complete; metadata richness good and consistent.

## Notes
- `specimen-log` status for `zed-text` and `fedra-sans` is `warn` but without explicit warn reasons. This looks like a logging/status consistency issue rather than a missing-PDF issue (specimen PDF present).
- For `zed-icons`, parser/profile should be tuned so expected styles reflect full icon variant space, not only one style label.
