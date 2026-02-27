NAMING AUDIT REPORT — KH TYPE
Generated: 2026-02-25T17:45:46+07:00

Scope: `tasks/reports/khtype-research-2026-02-25.json`
Execution note: no download executed, no file rename executed.

TYPEFACE SUMMARY

Canonical output filename pattern (proposed):
`kh-type-{typeface-slug}-{style-slug}.{ext}`

Canonical separators:
- Token separator: `-`
- No underscore in canonical output
- Lowercase for all output tokens

Format policy (proposed):
- Output both `.woff2` and `.woff` when both tersedia dari source.
- Basename harus identik; hanya extension yang berbeda.

1) Typeface: `kh-einheit`
- Atomic styles count: 9
- Naming scheme: coded column-weight token (`a100`, `b300`, `c500`) as compact lowercase token.
- Example 1: `kh-type-kh-einheit-a100.woff2`
- Example 2: `kh-type-kh-einheit-b300.woff2`
- Example 3: `kh-type-kh-einheit-c500.woff`

2) Typeface: `kh-giga`
- Atomic styles count: 10
- Naming scheme: weight/italic slug (`light`, `regular-italic`, etc.) in lowercase kebab-case.
- Example 1: `kh-type-kh-giga-light.woff2`
- Example 2: `kh-type-kh-giga-regular-italic.woff2`
- Example 3: `kh-type-kh-giga-black.woff`

3) Typeface: `kh-hekto`
- Atomic styles count: 42
- Naming scheme: sub-family prefix + weight/style (`vert-light`, `lut-book-italic`, `plan-semibold`).
- Example 1: `kh-type-kh-hekto-vert-light.woff2`
- Example 2: `kh-type-kh-hekto-lut-book-italic.woff2`
- Example 3: `kh-type-kh-hekto-plan-black.woff`

4) Typeface: `kh-interference`
- Atomic styles count: 3
- Naming scheme: weight-only slug (`light`, `regular`, `bold`) in lowercase kebab-case.
- Example 1: `kh-type-kh-interference-light.woff2`
- Example 2: `kh-type-kh-interference-regular.woff2`
- Example 3: `kh-type-kh-interference-bold.woff`

5) Typeface: `kh-shutter`
- Atomic styles count: 3
- Naming scheme: weight-only slug (`regular`, `medium`, `bold`) in lowercase kebab-case.
- Example 1: `kh-type-kh-shutter-regular.woff2`
- Example 2: `kh-type-kh-shutter-medium.woff2`
- Example 3: `kh-type-kh-shutter-bold.woff`

6) Typeface: `kh-teka`
- Atomic styles count: 10
- Naming scheme: weight/italic slug (`light`, `medium-italic`, etc.) in lowercase kebab-case.
- Example 1: `kh-type-kh-teka-light.woff2`
- Example 2: `kh-type-kh-teka-medium-italic.woff2`
- Example 3: `kh-type-kh-teka-black.woff`

7) Typeface: `kh-teka-mono`
- Atomic styles count: 14
- Naming scheme: weight/italic slug with `book` and `semibold` variants.
- Example 1: `kh-type-kh-teka-mono-book.woff2`
- Example 2: `kh-type-kh-teka-mono-semibold-italic.woff2`
- Example 3: `kh-type-kh-teka-mono-black.woff`

DECISION LOG

Decision 1: Foundry slug canonicalized as `kh-type`
- Reason: konsisten dengan brand token di source (`KH Type`) dan aman untuk filesystem/URL.
- Trade-off: alternatif `khtype` sedikit lebih pendek, tapi kurang terbaca.

Decision 2: Final filename pattern = `kh-type-{typeface-slug}-{style-slug}.{ext}`
- Reason: deterministic, mudah diaudit, dan tidak tergantung label UI.
- Trade-off: filename lebih panjang.

Decision 3: KH Einheit coded terms dipertahankan compact (`a100`, `b300`, `c500`)
- Reason: 1:1 terhadap semantic source code term; minim transformasi; minim bug mapper.
- Trade-off: lebih sedikit “human readable” dibanding `a-100`, tapi lebih stabil.

Decision 4: KH Hekto sub-family memakai hyphen chaining (`vert-light`, `lut-book-italic`, `plan-medium`)
- Reason: satu separator global (`-`) menghindari variasi parser (`_` vs `-`).
- Trade-off: tidak ada pemisah visual khusus antara typeface dan sub-family selain urutan token.

Decision 5: Italic dinormalisasi jadi suffix `-italic` di style slug
- Reason: konsisten lintas typeface (`light-italic`, `regular-italic`, dst.).
- Trade-off: tidak menyimpan literal spacing source label, tapi lebih aman dan konsisten.

Decision 6: Bundle terms (`complete family`, `complete set`) harus di-exclude total dari output
- Reason: bukan atomic style; jika ikut akan mengacau coverage count dan audit style.
- Trade-off: perlu filter tambahan eksplisit di pipeline.

Decision 7: Dual-format policy (`woff2` + `woff`) dengan basename identik
- Reason: source menunjukkan keduanya tersedia; menjaga compatibility.
- Trade-off: jumlah output file jadi 2x dari atomic style count.

ANOMALY LOG

Anomaly 1: Bundle leakage risk dari field `terms_atomic` pada source JSON
- Impact: pada 6 dari 7 typeface, `terms_atomic` saat ini masih mengandung label `Complete Family`.
- Affected slugs: `kh-giga`, `kh-hekto`, `kh-interference`, `kh-shutter`, `kh-teka`, `kh-teka-mono`.
- Required mitigation: atomic filter jangan percaya `terms_atomic` mentah; pakai rule exclusion `/(complete\s*family|complete\s*set)/i` terhadap `terms_all`.

Anomaly 2: KH Einheit bundle slug-label mismatch
- Evidence: label `Complete set [A, B, C]` memiliki slug `complete-set-a-b`.
- Impact: jika dipakai sebagai identifier bisnis, berpotensi misleading.
- Required mitigation: treat as non-atomic bundle only; jangan dipakai untuk nama output style.

Anomaly 3: Typeface page HTTP 500 on crawl
- URLs: `https://khtype.com/typeface/kh-hekto/`, `https://khtype.com/typeface/kh-teka-mono/`.
- Impact: metadata enrichment dari typeface page tidak selalu reliable.
- Required mitigation: source-of-truth untuk naming tetap di Store API style terms + product endpoint.

Anomaly 4: Typo pada slug style bundle KH Interference
- Evidence: `kh-interference-complete-familiy` (typo `familiy`).
- Impact: jika bundle tidak difilter, filename menjadi noisy/tidak profesional.
- Required mitigation: same as bundle exclusion hard rule.

Audit result: no collision ditemukan untuk canonical style-slug mapping pada 7 typeface setelah bundle exclusion.

OPEN QUESTIONS

1) Foundry prefix final di output mau dikunci `kh-type` atau `khtype`?
- Rekomendasi audit ini: `kh-type`.

2) Engine default format output mau:
- `woff2` only, atau
- `woff2 + woff`?
- Data source menunjukkan keduanya tersedia; butuh keputusan produk final.

3) Untuk KH Einheit coded family, apakah perlu expose mapping business label tambahan?
- Contoh: `a100 -> column A weight 100`.
- Tidak wajib untuk filename, tapi berguna untuk audit/readability.

4) Apakah urutan style di manifest output perlu dipaksa stable sort?
- Rekomendasi: lexical by `{typeface-slug}-{style-slug}` supaya reproducible.

5) Apakah bundle metadata perlu tetap disimpan di log analitik?
- Rekomendasi: ya, simpan di log sebagai `excludedStyles`, tapi jangan pernah jadi output filename.
