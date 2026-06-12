# 03d2: Adopt Lint-Ratchet Runtime Helpers

Status: Done (2026-06-12, landed in "refactor(lint): adopt lint ratchet runtime")
Order: 03d2 (after 03d1)
Parent: `03-zero-baseline-promotion-and-scripts-inversion.md`. Split out of
the former 03d on 2026-06-11.

## Context

The largest single adoption gap inside an already-linted family:
`lintedScriptFiles` re-includes only `scripts/lint-ratchet/lint-ratchet*.ts`,
leaving ~33 helper modules in `scripts/lint-ratchet/` unlinted
(`current-collector.ts`, `diagnostics.ts`, `ratchet-manifest-message.ts`, …).
`ratchet/core-complexity-lint-ratchet-runtime` already covers them via its
`scripts/lint-ratchet/**/*.ts` glob — its disposition says exactly this.
`tsconfig.scripts.json` already includes `scripts/lint-ratchet/**/*.ts`.

Suppression surface (`eslint-config/script-configs.js`) — mostly unbacked
(see parent warning):

- the `lint-ratchet.ts` block (`explicit-function-return-type`,
  `prefer-promise-reject-errors`, `no-nested-ternary`) — all unbacked;
- `lint-ratchet-baseline-parse.ts` / `lint-ratchet-baseline.ts` in the
  `no-unsafe-argument` block — unbacked;
- `lint-ratchet-baseline.ts` in the `no-unnecessary-condition` block —
  unbacked;
- `lint-ratchet.ts` in the `regexp/no-unused-capturing-group` block —
  unbacked (03d1 handled this block's `lint-ratchet-metrics.ts` entry);
- the four `lint-ratchet-*.test.ts` entries in the test-file relax block;
- `lint-ratchet.ts` / `lint-ratchet/lint-ratchet*.ts` in the relaxed CLI
  block (same fix-or-keep policy decision as 03a).

Cross-family note: `ratchet/local-max-lines-runtime` also covers
`scripts/harness-check.ts`, `scripts/lint-agent.ts` (linted, but with
per-file warn caps above the normal max-300), and
`scripts/harness/harness-check-validation.ts` (unlinted until 03g). Narrow
that ratchet here to what normal lint does not yet hold at max-300; 03g
finishes and deletes it.

Coupling: Leaf 09 (message parity) edits `lint-ratchet-baseline.ts`,
`current-collector.ts`, `lint-ratchet-baseline-compare.ts`,
`diagnostics.ts`; Leaf 08 item 1 dedups this family's ratchet globs. Land
those first or rebase deliberately.

## Scope

1. Widen the `lintedScriptFiles` entry to `scripts/lint-ratchet/**/*.ts` and
   probe the full rule surface over the ~33 newly adopted helpers — expect
   real findings; fix, or add a temporary message-count ratchet floor if a
   helper needs staged draining.
2. Remove the suppression entries above; fix surfaced findings or take
   narrow reasoned overrides.
3. Delete `ratchet/core-complexity-lint-ratchet-runtime` once normal lint
   holds an equal-or-stricter complexity floor for the whole family. Narrow
   `ratchet/local-max-lines-runtime` per the cross-family note (03g deletes
   it).
4. `bun run lint:ratchet:update`; scope-diff via `lint:ratchet:summary`.

## Definition Of Done

All of `scripts/lint-ratchet/` (excluding fixtures, if any) is under normal
lint with no suppression entries; the runtime complexity ratchet is deleted
or has a recorded keep-narrow verdict; `ratchet/local-max-lines-runtime`
covers only the files 03g will finish.

## Verification

Umbrella gate set, plus `bash scripts/tests/test-lint-ratchet.sh` and the
lint-ratchet vitest targets — this batch edits the ratchet system's own
sources, so its self-tests are the real gate.

## Notes

- `lintedScriptFiles` now re-includes `scripts/lint-ratchet/**/*.ts`, and the
  lint-ratchet-specific relaxed CLI/test/debt overrides were removed rather
  than replaced with staged ratchets.
- Normal lint now owns the runtime `complexity` floor, so
  `ratchet/core-complexity-lint-ratchet-runtime` was deleted. The generated
  baseline update used `--allow-worse` only because the updater requires an
  explicit reason for any removed baseline id, even this zero-finding one.
- `ratchet/local-max-lines-runtime` now covers only `scripts/harness-check.ts`,
  `scripts/harness/harness-check-validation.ts`, and `scripts/lint-agent.ts`;
  03g remains the deletion point for that cross-family ratchet.
- Updated `docs/agent_notes/lint-coverage-map.md` so lint-ratchet runtime
  helpers and tests are recorded as normal-linted plus the broad
  `ratchet/local-type-assertion-boundary` floor.
