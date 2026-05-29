# Leaf 39: Ratchet Runtime Script Lint Adoption

Status: Drafted 2026-05-20 - parked ratchet-first/drain leaf
Sources:

- `docs/agent_notes/backlog/lint-followups/19-scripts-eslint-remaining-families.md`
- `scripts/harness-check.ts`
- `scripts/lint-agent.ts`
- `scripts/lint-ratchet.ts`
- `scripts/lint-ratchet-baseline.ts`
- `scripts/lint-ratchet-baseline.test.ts`

## Problem

Leaf 19 adopted the small `scripts/lint-ratchet-config.ts` file but left the
ratchet runtime and adjacent harness scripts parked. Current physical sizes are
well above the default `local/max-lines` ceiling for several files:

- `harness-check.ts` at 529 lines.
- `lint-agent.ts` at 332 lines.
- `lint-ratchet.ts` at 846 lines.
- `lint-ratchet-baseline.ts` at 880 lines.
- `lint-ratchet-baseline.test.ts` at 657 lines.

These files now define CI and pre-commit enforcement behavior. They should be
linted, but a broad adoption is likely to surface max-lines, complexity, and
test-shape findings.

## Scope

Adopt the ratchet runtime and directly adjacent harness/agent TypeScript files
under ratchet coverage first, then drain toward normal lint coverage. Split
this leaf if the fresh inventory shows the ratchet CLI and baseline parser need
separate implementation passes.

Do not include unrelated diagnostics scripts or `logs-audit.ts` in this leaf.

## Ratchet-First Enforcement

Before refactoring the ratchet runtime, make the runtime files themselves
ratcheted. At minimum, ratchet `local/max-lines`; add complexity, max-params,
type-import, and test-quality ratchets where inventory shows findings. If the
runner needs core-rule support to ratchet itself, add and test that support as
the first commit.

## Candidate Work

- Re-run current lint inventory for the named files.
- Add scoped ratchet entries with current counts committed in
  `lint-ratchet.baseline.json`.
- Split ratchet runtime concerns:
  - CLI arg parsing and usage errors,
  - generated ESLint config construction,
  - cache path/key management,
  - ESLint execution/output parsing,
  - envelope/finding construction.
- Split baseline parsing/validation from baseline formatting/update decisions
  if that gets the parser under line and complexity ceilings.
- Split large tests by parser, registry validation, current/baseline compare,
  and CLI smoke behavior.
- Add cleaned files and helper modules to normal scripts lint coverage after
  the ratcheted findings drain.

## Exit Criteria

- At least one coherent ratchet runtime subset has current-count ratchet
  coverage, with a fresh inventory recorded for anything that remains
  unratcheted.
- New or higher finding counts fail `bun run lint:ratchet`.
- Existing ratchet behavior and cache/baseline semantics are unchanged except
  for deliberately tested fixes.
- Normal `bun run lint` adoption follows after the ratcheted findings drain.

## Verification

- `bun run lint -- --max-warnings=0`
- `bun run typecheck`
- `bash scripts/test-lint-ratchet.sh`
- Temporary-violation probe if any new ratchet scope starts at 0 findings
- `bash scripts/test-lint-agent.sh`
- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bun run harness:check`
- `bun run docs:harness-controls:check`
- `bun run test:scripts:changed`
- `bun run verify:changed`
