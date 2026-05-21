# Leaf 38: Top-Level Script Project Lint Adoption

Date: 2026-05-20

## Summary

Adopted the four Leaf 38 top-level script files into the existing
`tsconfig.scripts.json` type-aware scripts project:

- `scripts/db-status.ts`
- `scripts/harness-emit-envelope.ts`
- `scripts/sensor-blob-size.ts`
- `scripts/sensor-blob-size.test.ts`

The normal ESLint `scripts/**/*` ignore remains in place; these files are now
parseable through the scripts project and floored by ratchets until a later
drain can move them into normal lint coverage.

`scripts/db-status.ts` imports the server Prisma client, which pulls the server
env and generated Prisma client into the scripts program. That is the heaviest
project edge in this leaf, but it is already the live admin script boundary and
the scripts project typecheck passed with the narrow include list.

## Ratchets Added

- `ratchet/core-complexity-top-level-scripts`: 1 finding
- `ratchet/core-no-magic-numbers-top-level-scripts`: 11 findings
- `ratchet/core-preserve-caught-error-top-level-scripts`: 1 finding
- `ratchet/simple-import-sort-imports-top-level-scripts`: 1 finding
- `ratchet/typescript-eslint-no-unsafe-argument-top-level-scripts`: 1 finding
- `ratchet/typescript-eslint-restrict-template-expressions-top-level-scripts`:
  6 findings
- `ratchet/typescript-eslint-unbound-method-top-level-scripts`: 1 finding

The new Leaf 38 entries raised the live ratchet registry baseline from 77 to
99 current findings. All new ratchet scopes start non-zero, so no temporary
zero-finding probe was required.

## Codex Review P2 Follow-Up

Date: 2026-05-21

Codex review flagged that the initial `*-top-level-scripts` ratchet scopes only
listed files with current findings. Because the four Leaf 38 files remain
globally ignored by normal ESLint, that narrow scope would miss new debt in a
zero-finding sibling file.

Follow-up widened every top-level script ratchet to list all four Leaf 38
files. `ratchet/core-no-magic-numbers-top-level-scripts` keeps
`scripts/sensor-blob-size.test.ts` in `files` but excludes it through
`ignores`; the other six ratchets apply to all four files. Baseline counts were
unchanged for every widened ratchet:

- `ratchet/core-complexity-top-level-scripts`: 1 -> 1
- `ratchet/core-no-magic-numbers-top-level-scripts`: 11 -> 11
- `ratchet/core-preserve-caught-error-top-level-scripts`: 1 -> 1
- `ratchet/simple-import-sort-imports-top-level-scripts`: 1 -> 1
- `ratchet/typescript-eslint-no-unsafe-argument-top-level-scripts`: 1 -> 1
- `ratchet/typescript-eslint-restrict-template-expressions-top-level-scripts`:
  6 -> 6
- `ratchet/typescript-eslint-unbound-method-top-level-scripts`: 1 -> 1

Probe proof staged a temporary function in `scripts/db-status.ts` with an
11-branch string `if` chain. `bun run lint:ratchet` failed with one new
`ratchet/core-complexity-top-level-scripts` regression for `complexity`
(baseline 0 -> current 1 on that file). The probe edit was then reverted and
`bun run lint:ratchet` passed again.

## Surprises

The standalone typecheck probe found two project-adoption blockers before the
tsconfig include was safe:

- `scripts/db-status.ts` imported the server Prisma client with a `.ts`
  extension; it now uses the standard `.js` specifier.
- `scripts/sensor-blob-size.ts` sorted a readonly array result; it now copies
  before sorting.

Direct ESLint inventory also required adding the four paths to the existing
scripts-project parser/type-assertion blocks in `eslint.config.js`; this does
not unignore them for normal `bun run lint`.

## Exit Path

Drain the new top-level script ratchets in a later focused cleanup, then add
normal lint re-includes for the files that are clean enough to graduate. The
type-aware scripts-project decision is now done, which unblocks the queued
Leaf 41 ratchet-metric alignment implementation batches.

## Verification

- `./node_modules/.bin/tsc --noEmit ... scripts/db-status.ts scripts/harness-emit-envelope.ts scripts/sensor-blob-size.ts scripts/sensor-blob-size.test.ts`
- `./node_modules/.bin/tsc -p tsconfig.scripts.json --noEmit --pretty false`
- `./node_modules/.bin/eslint --no-ignore --max-warnings=0 scripts/db-status.ts scripts/harness-emit-envelope.ts scripts/sensor-blob-size.ts scripts/sensor-blob-size.test.ts` (inventory; expected 22 current findings)
- `bun run lint:ratchet:update -- --allow-worse --reason "correct Leaf 38 restrict-template-expressions options before commit"`
- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bash scripts/test-lint-ratchet.sh`
- `bun run docs:lint-coverage-map:check`
- `bun run harness:check`
- `bun run docs:harness-controls:check`
- `bash scripts/test-harness-check.sh`
- `bun run lint -- --max-warnings=0`
- `bun run typecheck`
- `bash scripts/test-harness-emit-envelope.sh`
- `bash scripts/vitest.sh run scripts/sensor-blob-size.test.ts`
- `bun run test:scripts:changed`
- `MUSI_INTERACTIVE_TIMEOUT=600 MUSI_INTERACTIVE_WARN_AFTER=540 bun run verify:changed`

Review follow-up gates, rerun after the scope widening and probe revert:

- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bash scripts/test-lint-ratchet.sh`
- `bun run docs:lint-coverage-map:check`
- `bun run harness:check`
- `bun run docs:harness-controls:check`
- `bash scripts/test-harness-check.sh`
- `bun run lint -- --max-warnings=0`
- `bun run typecheck`
