# Leaf 34: drift-ai Inventory-Family Lint Adoption

Status: Drafted 2026-05-20 - parked ratchet-first/drain leaf
Sources:

- `docs/agent_notes/backlog/lint-followups/19-scripts-eslint-remaining-families.md`
- `docs/agent_notes/finished_work/lint-hardening-leaf-19-scripts-drift-ai-small-modules-adoption.md`
- `scripts/drift-ai/config.ts`
- `scripts/drift-ai/duplicates.ts`
- `scripts/drift-ai/duplicates.test.ts`
- `scripts/drift-ai/ghost-files.ts`
- `scripts/drift-ai/ghost-files.test.ts`
- `scripts/drift-ai/current-inventory.ts`
- `scripts/drift-ai/current-inventory.test.ts`

## Problem

The inventory side of `drift-ai` still sits mostly outside ESLint coverage.
Known oversized files include:

- `config.ts` at 515 physical lines.
- `duplicates.ts` at 515 physical lines.
- `duplicates.test.ts` at 696 physical lines.
- `ghost-files.ts` at 687 physical lines.
- `ghost-files.test.ts` at 694 physical lines.

Leaf 32 covers the small `current-inventory` import-sort cleanup. This leaf is
for the larger inventory/reporting modules whose size will likely surface
`local/max-lines`, complexity, or helper-shape findings when linted.

## Scope

Bring `drift-ai` inventory modules under ratchet coverage first, then drain
toward normal lint coverage. Do not include the report-family files owned by
Leaf 33 unless the split creates shared helpers that both families consume.

## Ratchet-First Enforcement

Before extracting helpers or splitting tests, add scoped ratchets for the
inventory-family files at their current counts. At minimum, baseline
`local/max-lines`; add other reasonable rule ratchets surfaced by the current
inventory instead of waiting for a full cleanup.

Coordinate ratchet IDs and file sets with Leaves 32 and 33. A single broader
`drift-ai` ratchet per rule may be simpler than sibling family ratchets when the
same rule applies across under-ceiling, report-family, and inventory files.

## Candidate Work

- Re-run a current lint inventory for the named files before editing.
- Add scoped ratchet entries with current counts committed in
  `lint-ratchet.baseline.json`. For a given rule, avoid overlapping file
  membership with Leaves 32 and 33 unless one broader `drift-ai` ratchet
  intentionally owns the full file set.
- Extract shared filesystem and Git inventory helpers where duplicates and
  ghost-file checks currently repeat traversal or fixture setup.
- Split large tests by scenario family, for example scanner behavior, ignored
  paths, formatter output, and regression fixtures.
- Keep fixture data under existing ignored fixture directories, but keep test
  helpers and production helper modules linted.
- Add files to normal script lint coverage only after the ratcheted findings
  for those files drain to zero.

## Exit Criteria

- The inventory-family files named in this leaf have ratchet coverage before
  cleanup starts, or a blocker names the missing ratchet support required.
- Ratchet ownership is unambiguous and does not duplicate the same rule/file
  pair across the under-ceiling and report-family leaves.
- New or higher finding counts fail `bun run lint:ratchet`.
- Any extracted shared helper is covered by either focused tests or existing
  command-level fixtures.
- No broad `scripts/drift-ai/**/*.ts` normal-lint unignore lands until the full
  directory is clean; ratchet coverage may use broad scopes with precise
  ignores.

## Verification

- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bash scripts/test-lint-ratchet.sh` if ratchet runner/source support changes
- Temporary-violation probe if any new ratchet scope starts at 0 findings
- `bun run harness:check`
- `bun run docs:harness-controls:check`
- `bun run lint -- --max-warnings=0`
- `bun run typecheck`
- `bun run drift:ai --scope current`
- `bun run drift:ai --scope current duplicates`
- `bun run drift:ai --scope current ghost-files`
- Targeted script tests for split inventory helpers
- `bun run test:scripts:changed`
- `bun run verify:changed`
