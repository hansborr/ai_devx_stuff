# 38. Add the next `strict-boolean-expressions` scope slice: a ratchet over `packages/server/src/services`

Status: Proposed — from the 2026-07-01 AI-harness review; NOT implemented. Re-verify file:line before acting.
Lens: lint-rules · Area: server · Severity: med · Size: S · Confidence: high
Theme: staged-strictness-rollout · Source: Musi AI-harness review 2026-07-01 (multi-agent + Codex second opinion + web research)

## Problem
`@typescript-eslint/strict-boolean-expressions` is deliberately off in normal lint, with
staged rollout via ratchet slices as the stated strategy. Both existing slices have drained to
(or started at) zero and now just hold floors — the staged rollout has stalled at two scopes.
Truthiness bugs on `0`/`""`/nullable values are exactly the class agents introduce in rules
logic (HP/quantity/slot-count checks), and `services/` is where that logic lives per AGENTS.md.
The platform's whole purpose is that the next slice is cheap; not adding slices is the failure
mode.

## Evidence
- Both ratchet ids verified in `scripts/lint-ratchet/lint-ratchet-config.ts`:
  `ratchet/strict-boolean-expressions-server-encounter-combat` (lines 168-202, files
  `packages/server/src/services/encounter-combat/**`) and
  `ratchet/strict-boolean-expressions-shared` (lines 204-238, files
  `packages/shared/src/**`). Both use the same strict `ruleOptions` (only
  `allowNullableObject: true`), `mode: "no-new"`, `parserProfile: "type-aware-ts"`.
- Both baselines sit at zero findings: `lint-ratchet.baseline.json` `items: {}` for both ids
  (verified 2026-07-01).
- Both carry `zeroBaselineDisposition: { kind: "intentional-ratchet-only" }` — the documented
  intent is scope-by-scope extension, not promotion of the rule package-wide
  (lint-ratchet-config.ts:198-201, 234-237).
- Rollout mechanics documented at `docs/guides/lint-ratchet.md`, "Adding a new rule to an
  already linted area" (registry entry → harness-controls manifest row → baseline update →
  coverage-map row → violation probe).

## Proposed direction
Add `ratchet/strict-boolean-expressions-server-services`: files
`packages/server/src/services/**/*.{ts,tsx}`, ignores mirroring the encounter-combat entry's
test/generated excludes PLUS `packages/server/src/services/encounter-combat/**` (already owned
by the existing slice — overlapping ratchets would double-report and couple two baselines).
Same `ruleOptions`, `mode: "no-new"`, `target: 0`, `zeroBaselineDisposition:
intentional-ratchet-only` with a reason naming the next slice (routers) as the exit path.
Run `lint:ratchet:update`, review and commit whatever baseline it finds — the finding count is
unknown until baselined; that is normal for this platform and requires zero new machinery.
Alternative shape worth 5 minutes' consideration at implementation time: widen the
encounter-combat entry's `files` to all of `services/` and re-baseline, retiring one registry
row instead of adding one — cleaner registry, but it rewrites an existing baseline identity;
follow whichever the ratchet guide's baseline-identity section prefers.

## Scope / caveats
- This leaf is deliberately one slice, not a rollout plan; routers/`utils` are the natural
  follow-on slices once services drains.
- Type-aware parsing over all of `services/` is the priciest profile the runner has — the
  guide's own advice applies: re-measure `bun run lint:ratchet` runtime after adding, and stop
  if it gets painful (docs/guides/lint-ratchet.md, batching paragraph).
- Registration checklist (all mandatory, per the shipped set-state-in-effect precedent):
  registry entry, `harness.controls.json` row by hand, `bun run docs:harness-controls`,
  coverage-map row + `bun run docs:lint-coverage-map:check`, temporary-violation probe,
  `bun run lint:ratchet`.
- One small commit: registry entry + baseline + manifest/coverage rows.
