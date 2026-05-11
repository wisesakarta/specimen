## Summary

<!-- Describe the change in 2-3 sentences: what it does and why. -->

## Change category

- [ ] `fix/<name>` — Bug resolution
- [ ] `feature/<name>` — New capability or scraper
- [ ] `refactor/<name>` — Structural change (no new behavior)
- [ ] `chore:` — Maintenance, housekeeping, version bump

## Pre-merge checklist

- [ ] `npx tsc --noEmit` — zero errors
- [ ] No stray `.html`, `.log`, `.json`, `.cjs` files committed
- [ ] For scraper changes: stress tested across all families at the foundry
- [ ] No overlapping `canHandle()` logic with existing scrapers
- [ ] Artifact naming follows the Berkeley Mono standard (`Foundry_-_Family/TTF/...`)

## Smoke test result

<!-- For scraper changes, paste the relevant smoke test output line:
[N/48] Foundry Name -> https://foundryname.com/typefaces/family
  [PASS] scraper=Foundry Name Scraper fonts=48 92.4s
-->
