# Lint Ratchet Leaf 08 - Local Max Lines

Date: 2026-05-19

Added `local/max-lines` to the lint ratchet registry as
`ratchet/local-max-lines`.

## Scope Decision

`eslint.config.js` applies `local/max-lines` with default options
`{ max: 300, skipBlankLines: true, skipComments: true }`, then disables it for
tests/specs and assigns higher exact-file caps to the known large files.

The ratchet tracks only the default-options scope. It explicitly ignores the
test/spec patterns and every exact-file higher-cap override so the ratchet does
not run `local/max-lines` with options different from the ESLint gate it tracks.

Inventory notes:

- `bun run lint -- --quiet 2>&1 | rg 'local/max-lines' | wc -l`: `0`.
- `bun run lint -- --format json` also found `0` `local/max-lines` messages.
- A probe using the default 300-line option across the package/e2e/script
  surface found 20 files, all covered by exact higher-cap overrides.

## Shipped

- Added `ratchet/local-max-lines` to `scripts/lint-ratchet-config.ts`.
- Regenerated `lint-ratchet.baseline.json`; the new entry has `0` current
  findings.
- Added the matching `kind: "ratchet"` control to `harness.controls.json`.
- Regenerated `docs/generated/harness-controls.md`.
- Updated `docs/guides/lint-ratchet.md` with the new ratchet and scope note.
- Updated script smoke fixtures that copy the live ratchet registry.

## Runtime

Measured on this devcontainer after clearing
`node_modules/.cache/eslint-ratchet`.

- Cold `bun run lint:ratchet`: `real 8.217s`, `user 15.552s`, `sys 1.153s`.
- Warm `bun run lint:ratchet`: `real 1.595s`, `user 2.203s`, `sys 0.412s`.

The warm two-ratchet run stayed within the Leaf 08 budget.

## Verification

- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bun run harness:check`
- `bun run docs:harness-controls:check`
- `bun run lint`
- `bun run test:scripts:changed`
- `bun run typecheck`
- `bun run verify:changed` (`OK`, 224s; emitted the soft-budget warning above
  210s and remained under the 240s hard budget)
