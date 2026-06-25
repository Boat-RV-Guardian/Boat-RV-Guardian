<!-- See AGENTS.md (working contract) and docs/TESTING.md (gates + smoke test). -->

## What & why

<!-- One or two sentences: what this changes and the reason. -->

## Checklist

- [ ] Scoped to a small, reviewable change (one logical change)
- [ ] New logic has unit tests / bug fix has a failing-before test (or: UI-only, exempt)
- [ ] `cd dashboard && npx tsc -b` passes
- [ ] `cd dashboard && npm test` passes
- [ ] `cd worker && npx wrangler deploy --dry-run` passes (if worker touched)
- [ ] `cd worker && npm test` passes (if worker touched)
- [ ] `cd dashboard && npm run build` runs clean (for non-trivial dashboard changes)
- [ ] Invariants respected: UTC-store/`lt_tz`-display time policy; per-vehicle entitlements;
      server-side enforcement for anything protecting a resource/paid feature
- [ ] Version-bumped all 7 files (only if this is a release — see CLAUDE.md)
- [ ] `open-tasks.md` updated (items checked / decisions recorded)

## Safety (flood → shutoff → push)

- [ ] Does **not** touch the safety chain — OR — touches it and includes a regression test + is
      flagged for the hardware smoke test (docs/TESTING.md)
