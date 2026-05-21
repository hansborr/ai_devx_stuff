# Leaf 41j: Coverage Map ESLint Reach

Date: 2026-05-21

## Gap

`scripts/lint-coverage-map-check.ts` proved that tracked files were accounted
for by some map row, but it did not prove that rows marked `linted` were
actually reached by ESLint. The reviewer repro was
`scripts/codemods/tsconfig.json`: it was tracked and accounted for by the root
tsconfig map row, while `eslint --print-config scripts/codemods/tsconfig.json`
returned `undefined`.

## Check

The map checker now has an `eslint-reach-missing` finding for `linted` rows
whose ESLint-managed tracked files do not resolve an ESLint config. The full
package script passes `--check-eslint-reach`; staged/pre-commit mode still
passes `--staged`, which disables the reach gate so the cheap hook path stays
fast.

The reach implementation uses `new ESLint({ cwd }).calculateConfigForFile()`
with a per-file promise cache instead of spawning `eslint --print-config` for
each file. The full map check measured about 1.5-1.7s in this workspace; the
staged path measured about 0.13-0.15s and does not instantiate the reach gate.
The JS API helper lives in
`scripts/lint-coverage-map-check-eslint-reach.ts` so the main checker stays
under its existing max-lines and complexity ratchets. That split also removed
the checker source from the existing `typescript-eslint/require-await`
singleton baseline, so `lint-ratchet.baseline.json` was lowered rather than
leaving stale debt.

## Rows Fixed

- Root tsconfig row: split
  `tsconfig.{json,base,configs,e2e,scripts}.json` into exact root file paths so
  it no longer expands to `**/tsconfig...` and accidentally accounts for nested
  parser-project files.
- `scripts/codemods/tsconfig.json`: added an `excluded` row. Rationale: the
  global `scripts/**/*` ignore intentionally overrides the JSON config block,
  and this file is a parser project file read by typescript-eslint, not source
  that needs ESLint linting.
- `scripts/lint-coverage-map-check-eslint-reach.ts`: added as a normal-linted
  helper row after splitting the reach implementation out of the main checker.

## Regression Coverage

`scripts/lint-coverage-map-check.test.ts` now injects a synthetic reach checker
and asserts that a `linted` row with an unreachable file emits
`eslint-reach-missing`. A companion test proves `staged: true` skips the slow
reach gate.

## Verification

Targeted preflight passed:

- `bun test scripts/lint-coverage-map-check.test.ts`
- `bun run docs:lint-coverage-map:check`
- `bun run docs:lint-coverage-map:check -- --staged`
- `bun run lint -- --max-warnings=0`
- `bun run lint:ratchet`
- `bun run lint:ratchet:update`
- `bun run lint:ratchet:check-baseline`

Full requested verification was run before commit; see the commit context for
the command list.
