# Leaf 33: drift-ai Report-Family Lint Adoption

Status: Drafted 2026-05-20 - parked ratchet-first/drain leaf
Sources:

- `docs/agent_notes/backlog/lint-followups/19-scripts-eslint-remaining-families.md`
- `scripts/drift-ai/comments.ts`
- `scripts/drift-ai/comments.test.ts`
- `scripts/drift-ai/harness-freshness.ts`
- `scripts/drift-ai/harness-freshness.test.ts`
- `scripts/drift-ai/suppressions.ts`
- `scripts/drift-ai/suppressions.test.ts`

## Problem

The broader `scripts/drift-ai/**/*.ts` adoption stayed deferred because several
files exceed the default 300 effective-line `local/max-lines` ceiling. The
report/checking side of the tool is a coherent first split:

- `comments.test.ts` is 387 physical lines.
- `harness-freshness.ts` is 365 physical lines.
- `suppressions.ts` is 466 physical lines.
- `suppressions.test.ts` is 332 physical lines.
- `comments.ts` is under the physical-line ceiling but currently carries the
  complexity finding tracked in Leaf 32.

## Scope

Bring the report/checking family under ratchet coverage first, then drain it
toward normal lint coverage: comments, harness freshness, and suppressions.
Leave config, duplicates, and ghost-file inventory modules to Leaf 34.

## Ratchet-First Enforcement

Before splitting files or tests, add ratchets for the report/checking family at
current counts. At minimum, ratchet `local/max-lines` for oversized files and
ratchet any high-signal findings surfaced by a fresh inventory. Cleanup and
normal lint adoption should lower the baseline after the floor exists.

Coordinate ratchet IDs and file sets with Leaves 32 and 34. A single
rule-specific `scripts/drift-ai/**` ratchet may be clearer than three sibling
ratchets if the fresh inventory shows overlapping files or shared cleanup.

## Candidate Work

- Re-run lint inventory for the family after Leaf 32, or fold Leaf 32's
  remaining `comments.ts` cleanup here if it has not landed.
- Add scoped ratchet entries for current report-family findings before any
  structural split. For a given rule, either use disjoint report-family file
  sets or drain a broader `drift-ai` ratchet established by Leaf 41.
- Split large implementation files by concern:
  - parsing/report models,
  - candidate discovery,
  - finding construction,
  - CLI-facing orchestration.
- Split oversized test files into fixture builders and focused spec files, or
  extract shared test helpers under `scripts/drift-ai/test-helpers/`.
- Keep each extracted helper linted rather than moving code into an ignored
  directory.
- Add exact files or directory-level unignores only after the ratcheted
  findings drain to zero.

## Exit Criteria

- All report-family files named in this leaf have ratchet coverage for current
  findings before cleanup starts.
- Ratchet ownership does not overlap confusingly with Leaves 32 and 34 for the
  same rule/file pair.
- New or higher finding counts fail `bun run lint:ratchet`.
- Normal `bun run lint` adoption follows after the ratchet baseline drains.
- If a file must remain over 300 effective lines, the leaf records a fresh
  baseline/drain plan rather than leaving it unenforced.
- Drift report output remains stable or fixture changes are reviewed.

## Verification

- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bash scripts/test-lint-ratchet.sh` if ratchet runner/source support changes
- Temporary-violation probe if any new ratchet scope starts at 0 findings
- `bun run harness:check`
- `bun run docs:harness-controls:check`
- `bun run lint -- --max-warnings=0`
- `bun run typecheck`
- `bun run drift:ai --scope current comments`
- `bun run drift:ai --scope current suppressions`
- `bun run drift:ai harness-freshness`
- Targeted script tests for the split modules
- `bun run test:scripts:changed`
- `bun run verify:changed`
