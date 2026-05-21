# Leaf 11: Codemod ESLint Coverage

Status: Parked after inventory. Follow-up ratchet-first/drain leaves 35-37 were
drafted 2026-05-20 from the broad codemod inventory and Leaf 19 codemod-test
probe.
Sources:

- `docs/agent_notes/backlog/lint-hardening/08-scripts-eslint-coverage.md`
- `docs/agent_notes/in_progress/lint-hardening-leaf-8-codemods.md`
- `docs/agent_notes/backlog/lint-hardening/evaluation-verdicts.md`

## Problem

ESLint coverage was added for drift scripts, but `scripts/codemods/**/*.ts`
remains excluded. The codemod inventory produced 70 findings, including 59
errors and 11 warnings, with structural issues too broad for a single
mechanical coverage flip.

## Scope

Do not re-enable codemod coverage wholesale. Add current-count ratchet coverage
for narrower slices first, then drain findings and turn on normal ESLint
coverage when the remaining baseline is tractable.

Concrete follow-up leaves:

- `35-codemod-test-harness-lint-adoption.md`
- `36-codemod-concurrency-and-logging-lint-adoption.md`
- `37-codemod-barrel-and-trpc-lint-adoption.md`

## Candidate Work

- Apply purely mechanical import/type-import fixes if they reduce inventory
  noise without hiding structural findings.
- Add scoped ratchet coverage before changing codemod tests or implementation
  files so new findings fail while cleanup is in progress.
- Refactor repeated codemod test-harness patterns:
  - void-expression callbacks,
  - non-`Error` throws,
  - missing explicit assertions.
- Split or simplify large codemod modules that trip `complexity`,
  `max-params`, and `local/max-lines`.
- Re-run the temporary ESLint config after each cleanup slice.
- Enable normal ESLint coverage only when the remaining issues are either fixed
  or intentionally scoped with clear ratchet-backed policy.

## Exit Criteria

- A coherent codemod subset is ratcheted and then linted, or the whole codemod
  surface is linted.
- The result does not introduce warning-only committed lint debt or leave a
  cleanup-only gap before enforcement.
- Any deferred family has an updated reason and revisit trigger.

## Verification

- `bun run lint -- --max-warnings=0`
- `bun run typecheck`
- `bun run test:scripts:changed`
- Targeted codemod smoke tests
