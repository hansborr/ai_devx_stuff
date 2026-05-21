# Leaf 37: Codemod Barrel And tRPC Lint Adoption

Status: Drafted 2026-05-20 - parked ratchet-first/drain leaf
Sources:

- `docs/agent_notes/backlog/lint-followups/11-codemod-eslint-coverage.md`
- `scripts/codemods/expand-barrel.ts`
- `scripts/codemods/lib/trpc-shared-schema.ts`
- `scripts/codemods/trpc-shared-input.ts`
- `scripts/codemods/trpc-shared-output.ts`
- `scripts/codemods/trpc-shared-schema-codemod.test.ts`
- `scripts/test-codemod-trpc-shared-input.sh`
- `scripts/test-codemod-trpc-shared-output.sh`

## Problem

The remaining implementation-heavy codemods are still outside normal lint
coverage and are likely to trip the same structural rules recorded in the
codemod inventory:

- `scripts/codemods/expand-barrel.ts` at 1130 physical lines.
- `scripts/codemods/lib/trpc-shared-schema.ts` as the shared helper imported by
  the tRPC shared-schema codemods.
- `scripts/codemods/trpc-shared-input.ts` at 385 physical lines.
- `scripts/codemods/trpc-shared-output.ts` at 395 physical lines.

These codemods encode important migration policy, so they should not remain a
permanent lint exception.

## Scope

Adopt `expand-barrel`, the tRPC shared-schema codemods, and the shared
`scripts/codemods/lib/trpc-shared-schema.ts` helper under ratchet coverage
first, then clean and promote them toward normal lint coverage. This leaf may
split again after inventory; `expand-barrel.ts` alone may be too large for one
implementation pass.

Do not lint `scripts/codemods/fixtures/**`; fixtures remain generated or
historical before/after snapshots per Leaf 27.

## Ratchet-First Enforcement

Before refactoring these implementation files, add ratchets at current counts
for reasonable findings surfaced by the fresh inventory. At minimum, this
should cover `local/max-lines`; include complexity, max-params, type-import,
and import-sort style findings where the ratchet runner can express them.

## Candidate Work

- Re-run a fresh lint inventory for the three implementation files, the shared
  helper, and the tRPC shared-schema test.
- Add scoped ratchet entries for the current findings before cleanup.
- For `expand-barrel.ts`, split symbol collection, import rewriting, mock
  rewriting, package discovery, and CLI orchestration into linted modules.
- For tRPC codemods, extract shared schema/import helpers that are duplicated
  between input and output migrations.
- Keep public codemod functions and shell smoke commands stable.
- Add cleaned files and helper modules to normal scripts lint coverage after
  the ratcheted findings drain.

## Exit Criteria

- A coherent subset of the barrel/tRPC codemod implementation/helper files has
  ratchet coverage, or the leaf splits with a fresh per-file inventory and
  ratchet plan.
- New or higher finding counts fail `bun run lint:ratchet`.
- No codemod fixture directory is accidentally pulled into normal lint.
- Existing codemod smoke tests still cover the transformed output.

## Verification

- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bash scripts/test-lint-ratchet.sh` if ratchet runner/source support changes
- Temporary-violation probe if any new ratchet scope starts at 0 findings
- `bun run harness:check`
- `bun run docs:harness-controls:check`
- `bun run lint -- --max-warnings=0`
- `bun run typecheck`
- `bash scripts/test-codemod-trpc-shared-input.sh`
- `bash scripts/test-codemod-trpc-shared-output.sh`
- Any expand-barrel smoke selected by `bun run test:scripts:changed`
- `bun run test:scripts:changed`
- `bun run verify:changed`
