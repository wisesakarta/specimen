# Engine Identifier Rebrand Protocol — Specimen
Generated: 2026-02-27

## Objective
Rebrand engine identifier from legacy tokens (`aksara`, `saka`) to canonical token (`specimen`) without breaking scraper/downloader behavior, browser intercept, and existing automation scripts.

## Canonical Identifier
- Product/engine canonical ID: `specimen`
- Legacy aliases (compat only): `aksara`, `saka`

## Non-Breaking Protocol
1. Dual-read phase
- Reader logic must accept new + legacy keys.
- Example implemented: browser executable path env reads `SPECIMEN_BROWSER_PATH` then `AKSARA_BROWSER_PATH`, then `PUPPETEER_EXECUTABLE_PATH`.

2. Dual-write phase
- When writing new runtime markers/metadata, write canonical key first.
- Keep legacy key writes where old workflows might still rely on them.
- Scope: temporary compatibility window.

3. Cutover phase
- After smoke-test pass across critical foundries, deprecate legacy aliases.
- Remove legacy writes first, keep legacy reads for one release cycle.
- Final step: remove legacy reads.

## Safety Gates
- Do not change downloader protocol enums or request payload schema in rebrand phase.
- Do not change file extraction logic, conversion logic, or foundry-specific parsing logic.
- Run `npm run -s typecheck` after each identifier batch.
- Smoke test minimum:
  - 1 browser-intercept flow
  - 1 batch-direct flow
  - 1 zip extraction flow

## Identifier Mapping (Current)
- npm package name: `specimen` (updated)
- browser env var (canonical): `SPECIMEN_BROWSER_PATH` (added)
- browser env var (legacy): `AKSARA_BROWSER_PATH` (retained)
- UI theme localStorage: reads `specimen-theme`, fallback `aksara-theme`, fallback `saka-theme` (already in place)

## Git / Repository Rename Notes
Local code rebrand is independent from remote repository rename.
To switch remote safely after new repo exists:
```bash
git remote set-url origin <NEW_REPO_URL>
git remote -v
```

Recommended order:
1. Finish code-level identifier migration with compatibility.
2. Validate smoke tests.
3. Rename remote repository URL.
4. Rename local directory last.
