# Leaf 35: Codemod Test-Harness Lint Adoption

Status: Drafted 2026-05-20 - parked ratchet-first/drain leaf
Sources:

- `docs/agent_notes/backlog/lint-followups/11-codemod-eslint-coverage.md`
- `docs/agent_notes/backlog/lint-followups/19-scripts-eslint-remaining-families.md`
- `docs/agent_notes/finished_work/lint-hardening-leaf-19-scripts-codemod-test-files-deferral.md`
- `scripts/codemods/concurrency-guard.test.ts`
- `scripts/codemods/expand-barrel.test.ts`
- `scripts/codemods/structured-logging-fix.test.ts`
- `scripts/codemods/trpc-shared-schema-codemod.test.ts`

## Problem

Four under-ceiling codemod test files were probed in Leaf 19 and deferred. The
probe produced 20 ESLint errors in repeating shapes:

- `@typescript-eslint/no-confusing-void-expression` for arrow callbacks that
  implicitly return helper calls.
- `@typescript-eslint/only-throw-error` for literal or non-`Error` throws.
- `vitest/expect-expect` for codemod fixture tests whose assertions live
  inside helper functions.
- One `simple-import-sort/imports` finding.

The files are already in `tsconfig.scripts.json`, so the blocker is test
harness shape rather than project inclusion.

## Scope

Adopt the four codemod test files under ratchet coverage first, then drain them
toward normal ESLint coverage. Do not include the large codemod implementation
files in this leaf.

## Ratchet-First Enforcement

Before changing test helpers or assertions, add ratchets for the current
codemod test-file findings. This should cover the relevant test-quality and
TypeScript rule findings at their current counts so future codemod test work
cannot add more unchecked debt.

If `vitest/expect-expect` or other third-party test rules need ratchet support
that does not exist yet, add the allowlist/runner support first.

Treat `vitest/expect-expect` and
`@typescript-eslint/only-throw-error` as bug-class findings, not slow structural
debt. Ratcheting them is the floor that prevents regression; the drain should be
the first cleanup after the floor lands.

## Candidate Work

- Re-run the lint probe and commit scoped ratchet coverage for the four test
  files at current counts.
- Drain the `expect-expect` and non-`Error` throw findings before lower-signal
  cleanup when the fresh inventory still reports them.
- Extract common fixture-test helpers into a linted
  `scripts/codemods/test-helpers/` module if that reduces duplication.
- Make assertion helpers explicit enough for `vitest/expect-expect`, either by
  keeping direct `expect(...)` calls in each `it(...)` or by adding a small
  named assertion helper to the existing `assertFunctionNames` allowlist.
- Replace literal throws with `Error` instances or assertion helpers that
  preserve the current failure diagnostics.
- Expand void-expression callbacks into block bodies where needed.
- Apply the import-sort fix.
- Add the four files and any new helper modules to the normal scripts lint gate
  after the ratcheted findings drain.

## Exit Criteria

- The four codemod test files have ratchet coverage before test-harness cleanup
  starts.
- New or higher finding counts fail `bun run lint:ratchet`.
- Test-quality bug-class findings have a first-priority drain plan or are fixed
  in the same leaf after the ratchet floor exists.
- Normal `bun run lint` adoption follows after the ratcheted findings drain.
- Codemod fixture tests still fail loudly with useful diffs when before/after
  output diverges.
- Leaf 11's codemod coverage note is updated to show test-harness coverage is
  ratcheted and no longer completely unenforced.

## Verification

- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bash scripts/test-lint-ratchet.sh` if ratchet runner/source support changes
- Temporary-violation probe if any new ratchet scope starts at 0 findings
- `bun run harness:check`
- `bun run docs:harness-controls:check`
- `bun run lint -- --max-warnings=0`
- `bun run typecheck`
- `bun run test:scripts:changed`
- Targeted codemod smoke tests selected by `scripts/test-scripts.sh`
- `bun run verify:changed`
