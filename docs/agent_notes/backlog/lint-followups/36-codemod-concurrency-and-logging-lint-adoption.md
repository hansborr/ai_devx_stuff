# Leaf 36: Codemod Concurrency And Logging Lint Adoption

Status: Drafted 2026-05-20 - parked ratchet-first/drain leaf
Sources:

- `docs/agent_notes/backlog/lint-followups/11-codemod-eslint-coverage.md`
- `scripts/codemods/concurrency-guard.ts`
- `scripts/codemods/structured-logging-fix.ts`
- `scripts/test-codemod-structured-logging-fix.sh`

## Problem

The original codemod ESLint inventory found structural findings too broad for a
single coverage flip: complexity, `max-params`, `local/max-lines`, and
repeated helper patterns. Two implementation files are good first production
codemod candidates because they are self-contained command tools with existing
fixture coverage:

- `scripts/codemods/concurrency-guard.ts` at 884 physical lines.
- `scripts/codemods/structured-logging-fix.ts` at 548 physical lines.

## Scope

Adopt these two implementation files under ratchet coverage first, then drain
and eventually move cleaned files plus extracted helpers into normal lint
coverage. Leave `expand-barrel` and the tRPC shared-schema codemods to Leaf 37.
Leave codemod fixtures ignored.

## Ratchet-First Enforcement

Before splitting large scanners, add ratchets at current counts for reasonable
rules surfaced by inventory, especially `local/max-lines`, `complexity`, and
`max-params`. If core ESLint rules are not yet supported by `lint:ratchet`,
add that support before beginning cleanup.

## Candidate Work

- Re-run a fresh ESLint inventory for the two files before editing.
- Add scoped ratchet entries with current counts committed in
  `lint-ratchet.baseline.json`.
- Split large scanners into focused modules, for example CLI args, path
  discovery, AST predicates, finding classification, and text rewrites.
- Reduce high-complexity functions with named predicates or small strategy
  tables only when the table improves readability.
- Keep command exports and shell smoke entrypoints stable.
- Add these files and new helper modules to the normal scripts lint gate after
  the ratcheted findings drain.

## Exit Criteria

- Both implementation files have ratchet coverage before structural cleanup
  starts, or a blocker names the missing ratchet support required.
- New or higher finding counts fail `bun run lint:ratchet`.
- Normal `bun run lint` adoption follows after the ratcheted findings drain.
- Existing codemod fixture outputs remain stable unless a deliberate behavior
  fix is recorded.
- Leaf 11 is updated with the adopted subset and any remaining implementation
  blockers.

## Verification

- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bash scripts/test-lint-ratchet.sh` if core-rule/source support changes
- Temporary-violation probe if any new ratchet scope starts at 0 findings
- `bun run harness:check`
- `bun run docs:harness-controls:check`
- `bun run lint -- --max-warnings=0`
- `bun run typecheck`
- `bash scripts/test-codemod-structured-logging-fix.sh`
- Any concurrency-guard codemod smoke or targeted test selected by
  `bun run test:scripts:changed`
- `bun run test:scripts:changed`
- `bun run verify:changed`
