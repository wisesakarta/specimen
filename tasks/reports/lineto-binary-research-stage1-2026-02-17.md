# Lineto Binary Research - Stage 1 (2026-02-17)

## Scope
- Verify live Lineto gate payload format at binary level.
- Validate current decoder assumptions in `src/lib/server/browser-downloader.ts`.
- Identify analyzer mismatch sources before any logic changes.

## Evidence
- Structured JSON report: `tasks/reports/lineto-binary-research-1771359252446.json`
- HTML snapshots used for parser inspection:
  - `tasks/tmp/lineto-dmt-var-3-axis.html`
  - `tasks/tmp/lineto-akkurat-mono.html`
  - `tasks/tmp/lineto-geigy.html`

## Binary format findings
1. Lineto gate endpoint is:
   - `/api/front/font-cuts/web-font?postscriptNames=...`
2. Single `postscriptNames` response:
   - Returns one encoded binary blob (no chunk envelope).
3. Multi `postscriptNames` response:
   - Returns chunked payload: repeated `[u32_be chunk_length][chunk_bytes]`.
   - Parsed chunk count matched requested name count in tested samples.
4. Per-chunk obfuscation:
   - Each byte is shifted by `+len(postscriptName)`.
   - Decoding by applying delta `-len(postscriptName)` restores valid font signatures.
   - Example:
     - Raw first bytes for `AkkuratLL-Regular` (len 17): `11 12 11 11 ...`
     - Decoded bytes: `00 01 00 00 ...` (valid TrueType header)
5. Decoder assumption in code is correct:
   - `splitLinetoChunkedPayload` + `applyByteShift(-(postscriptName.length))` matches live payload behavior.

## Analyzer/root-cause findings (accuracy, not decoder)
1. `dmt-var-3-axis`:
   - Current HTML postscript extractor produced `expectedPostscriptNames=[]`.
   - But page HTML does contain `DMTLLVar-Regular`.
   - Root cause: token matching is too strict against slug normalization.
2. `akkurat-mono`:
   - Extractor can over-collect `AkkuratLL-*` names (from broader page data) and bias expected catalog.
   - Runtime capture still recovers actual `AkkuratMonoLL-*`, but expected metrics become noisy.
3. Net effect:
   - Binary decode path is healthy.
   - Main Lineto weakness is pre-download expectation modeling (postscript extraction precision), not gate decryption.

## Current behavior check (runtime)
- Direct run on `https://lineto.com/typefaces/dmt-var-3-axis` now produced valid output in:
  - `downloads/lineto-com-dmt-var-3-axis`
- Session captured `DMTLLVar-Regular` and converter expanded to multiple instances.

## Recommended Stage 2 (no code yet)
1. Replace/upgrade Lineto expected-postscript extraction:
   - Prefer structured source (Nuxt payload parse) or improved token strategy:
   - Require slug token subsequence match (e.g. `akkurat` + `mono`) instead of prefix-only.
2. Add expected-profile quality levels:
   - `high-confidence` when parser is precise.
   - `low-confidence` fallback when extracted names are weak.
3. Keep decoder unchanged unless Stage 2 uncovers a new payload variant.
