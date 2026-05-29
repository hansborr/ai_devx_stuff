# Leaf 31: code-intel Facade Lint Adoption

Status: Drafted 2026-05-20 - parked ratchet-first/drain leaf
Sources:

- `docs/agent_notes/backlog/lint-followups/19-scripts-eslint-remaining-families.md`
- `scripts/code-intel.ts`
- `scripts/test-code-intel.sh`

## Problem

Leaf 19 slice 4 adopted `scripts/code-intel-server.ts` and
`scripts/logs-audit.test.ts`, but carved out `scripts/code-intel.ts`. The
facade produced one autofixable export-sort finding plus 9
`@typescript-eslint/consistent-type-imports` errors on
`typeof import("./code-intel/...")` annotations.

The 2026-05-20 re-probe confirmed the type-import errors are not autofixable.
They require a manual rewrite of the module type aliases to top-level
`import type` declarations.

## Scope

Single-file adoption for `scripts/code-intel.ts`. Do not refactor the
`scripts/code-intel/**` implementation modules unless the facade rewrite proves
one of their exported types must be named differently.

## Ratchet-First Enforcement

Before rewriting the facade, add ratchet coverage for the current
`@typescript-eslint/consistent-type-imports` findings and any import/export
sort finding that still appears. The ratchet baseline should freeze the current
count so additional type-import debt cannot be added while the manual rewrite
is pending.

If the needed third-party rule is not supported by `lint:ratchet`, extend the
third-party allowlist/runner support first rather than doing a cleanup-only
rewrite.

This is intentionally a short-lived floor, not permission to keep the banned
pattern around. The file is small and the rewrite is known: once the ratchet is
in place, drain the 9 type-import findings in the same promoted leaf whenever
the implementation budget allows.

## Candidate Work

- Re-run the exact lint probe against the current branch and commit scoped
  ratchet baseline coverage for `scripts/code-intel.ts`.
- Replace the facade's `typeof import("./code-intel/...")` annotations with
  top-level type-only imports, for example `import type * as Foo from
  "./code-intel/foo.js"`, or narrower named type imports when clearer.
- Confirm the rewrite does not introduce eager runtime imports. The facade's
  lazy loading and daemon/client boundary behavior must remain unchanged.
- Apply the export-sort autofix or reorder exports manually.
- After the ratcheted findings drain to zero, add `scripts/code-intel.ts` to
  the normal lint gate using the existing script parser/type-assertion blocks.

## Exit Criteria

- `scripts/code-intel.ts` is protected by ratchet coverage before the manual
  type-import rewrite starts.
- New or higher finding counts fail `bun run lint:ratchet`.
- The ratcheted type-import baseline is drained promptly, preferably in this
  same leaf, rather than left as parked debt.
- Normal `bun run lint` adoption follows once the facade is clean.
- Runtime module loading behavior is unchanged; type-only imports must erase
  from emitted JavaScript.
- Leaf 19's code-intel deferral note is closed or replaced with a current
  adoption summary.

## Verification

- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bash scripts/test-lint-ratchet.sh` if ratchet runner/source support changes
- Temporary-violation probe if any new ratchet scope starts at 0 findings
- `bun run harness:check`
- `bun run docs:harness-controls:check`
- `bun run lint -- --max-warnings=0`
- `bun run typecheck`
- `bash scripts/test-code-intel.sh`
- `bun run test:scripts:changed`
- `bun run verify:changed`
