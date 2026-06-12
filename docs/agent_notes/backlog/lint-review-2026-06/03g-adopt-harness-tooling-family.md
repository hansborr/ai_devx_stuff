# 03g: Adopt Harness Tooling Family

Status: Done (2026-06-12, landed in "refactor(lint): adopt harness tooling
family into normal lint")

Completion notes:

- All nine unadopted files joined normal lint; the seven individual
  `scripts/harness/` entries in `lintedScriptFiles` collapsed into one
  `scripts/harness/**/*.ts` glob (the whole directory is linted now), and
  `harness-audit.ts` + `lint-agent-fix-text.ts` were added to
  `tsconfig.scripts.json`.
- Probe surfaced 22 findings; all were fixed, none ratcheted. Notables:
  `harness-audit.ts` (366 effective lines) split its report assembly and
  rendering into `scripts/harness/harness-audit-report.ts` (CLI re-exports
  the surface, so test imports were untouched); four complexity findings
  (11-15) resolved by helper extraction; `harness-check-validation.ts`
  max-params resolved with a shared `ManifestCheckContext`.
- The `regexp/no-unused-capturing-group` off for `harness-check.ts` was
  stale — zero findings on removal.
- Relaxed-CLI options settled by FIXING, not keeping: without the block the
  three harness files showed only four magic-number `2`s (named constants
  now); `restrict-template-expressions allowNumber` and `max-params 6` hid
  nothing. No keep verdict needed; the block now covers only
  `scripts/logs-audit.ts` pending 03h.
- Re-measure confirmed every family file under the max-300 cap
  (largest: `lint-agent.ts` at 290), so both the cap-390/cap-450
  `maxLinesPolicy.exceptions` and the
  `local-max-lines-generate-harness-controls` + `local-max-lines-runtime`
  ratchets were deleted outright (manifest + generated doc + coverage map
  updated; baseline refreshed via `--allow-worse` rename/removal path).
- `harness-diagnostics-output.ts`'s `process.env` read joined the
  process-primitive allowlist: the module implements the
  `HARNESS_DIAGNOSTICS_OUTPUT` sidecar contract, so the read is the
  boundary. Its test now uses `vi.stubEnv`/`vi.unstubAllEnvs` (drift-ai
  test idiom) instead of `delete process.env[...]`.
Order: 03g
Parent: `03-zero-baseline-promotion-and-scripts-inversion.md`.

## Context

Unadopted files (verified 2026-06-11):

- `scripts/harness-audit.ts` and `scripts/lint-agent-fix-text.ts` — neither
  is in `lintedScriptFiles` NOR in `tsconfig.scripts.json` (the only two
  adoption targets in this pack that also need tsconfig entries);
- seven `scripts/harness/` helpers: `control-field-validation.ts` (+ test),
  `generate-harness-controls-validation.ts`, `harness-audit.test.ts`,
  `harness-check-validation.ts`, `harness-diagnostics-output.ts` (+ test).
  `scripts/harness/**/*.ts` is already in `tsconfig.scripts.json`.

Already-linted family members with suppression debt
(`eslint-config/script-configs.js`):

- `harness-check.ts` and `lint-agent.ts`: `complexity: "off"` — UNBACKED
  (no complexity ratchet covers them; probe expecting live findings);
- `harness-check.ts` in the `regexp/no-unused-capturing-group` block —
  unbacked;
- `generate-harness-controls.ts`: `complexity: "off"` — unbacked — plus
  `ratchet/local-max-lines-generate-harness-controls` (zero); the legacy
  family map said "split helpers before normal lint adoption if the file is
  still over policy" — re-measure first;
- `harness-check.ts`, `lint-agent.ts`, `generate-harness-controls.ts`
  entries in the relaxed CLI block (fix-or-keep decision, as in 03a).

Cross-family note: `ratchet/local-max-lines-runtime` (narrowed by 03d2)
still covers `harness-check-validation.ts` plus any harness CLI files whose
normal-lint warn caps sit above the max-300 floor. This batch settles those
caps and deletes the ratchet.

Coupling: Leaf 02 touches `scripts/harness/generate-verify-steps.ts` and the
controls manifest; the watchlist's harness-controls execution-model entry
touches the same generator. Coordinate if either is in flight.

## Scope

1. Add the unadopted files to `lintedScriptFiles` (and `harness-audit.ts` +
   `lint-agent-fix-text.ts` to `tsconfig.scripts.json`); probe the full rule
   surface and fix findings.
2. Remove the unbacked `complexity` and regexp offs; fix surfaced findings
   or add a temporary message-count ratchet floor if a file needs staged
   draining.
3. Re-measure `generate-harness-controls.ts` against the normal max-lines
   cap; split if over, then drain
   `ratchet/local-max-lines-generate-harness-controls`.
4. Settle the relaxed-CLI-options entries (fix or documented keep).
5. Finish `ratchet/local-max-lines-runtime`: bring its remaining files under
   the normal max-300 cap (or record a keep-narrow verdict), then delete it.
6. `bun run lint:ratchet:update`; scope-diff via `lint:ratchet:summary`.

## Definition Of Done

Every `.ts` file under `scripts/harness/` plus `harness-audit.ts`,
`harness-check.ts`, `lint-agent.ts`, `lint-agent-fix-text.ts`, and
`generate-harness-controls.ts` is under normal lint; no unbacked complexity
or regexp offs remain for the family; the generate-harness-controls and
runtime max-lines ratchets are drained.

## Verification

Umbrella gate set, plus `bun run harness:check`,
`bun run docs:harness-controls:check`, and the harness vitest targets
(`generate-verify-steps.test.ts`, `generate-hook-wiring.test.ts`,
`harness-audit.test.ts`, …) — this family generates verify steps and hook
wiring, so generator drift checks are load-bearing.
