# Shell Migration Coordination

Status: Leaf 0A landed; Leaf 0B ready.
Date: 2026-05-10
Source: `/home/node/shell_migration.md`

## Goal

Migrate load-bearing Musi shell scripts to typed Bun/TypeScript modules in
small, parity-backed leaves. Preserve public command names, hook envelopes,
state-file formats, exit codes, and human-facing output unless a separate
decision explicitly changes that behavior.

This note tracks the Musi-local TypeScript migration. If the work is later
reframed as a shared harness for TypeScript, Rust, and Python projects, pause
this plan and re-triage the Rust CLI variant described in the source draft.

## Guardrails

- Keep `.claude/hooks/*.sh`, `.codex/hooks/*.sh`, and `.husky/pre-commit` as
  shell adapters. They may eventually exec TS entries, but they remain the
  boundary files.
- Do not repoint production commands before parity coverage exists for that
  surface.
- Do not combine snapshot/parity fixture creation with a behavior port when the
  target is high risk.
- Preserve existing on-disk state formats for verify caches, worktree state,
  hook state, and log markers until a separate migration is approved.
- Risky phases need an escape hatch before default flips: hooks get
  `MUSI_HOOK_BACKEND`, worktree provisioning gets `MUSI_WORKTREE_BACKEND`.

## Current Baseline

- Root `vitest.config.ts` already includes the `scripts` project, and
  `scripts/vitest.config.ts` already exists.
- `bun run test:scripts` and `bun run test:scripts:changed` still use the
  bash smoke runner. Keep that unchanged for the first migration leaves.
- Several TS script tests already run under the scripts Vitest project, such as
  `scripts/code-intel.test.ts`, `scripts/drift-ai.test.ts`, and
  `scripts/logs-audit.test.ts`.
- Leaf 0A broadened the scripts Vitest project to include recursive
  `scripts/**/*.test.ts` files and pinned `test:changed` routing for both
  top-level and nested script tests.
- `scripts/db-status.ts` already exists beside `scripts/db-status.sh`; parity
  coverage must land before the public command is repointed.

## Ready Now

### Leaf 0B: Shared Script Utility Scaffolding

Add only the shared script utility scaffolding needed by the first migrated
script path, with focused tests.

Scope:

- Inspect the first target script path before adding helpers; prefer the
  smallest utility surface that removes real duplication for the upcoming
  parity work.
- Add focused scripts Vitest coverage for any new helper.
- Keep helper APIs local to `scripts/` and avoid creating abstractions for
  future phases until a concrete caller exists.

Out of scope:

- Repointing production commands, hooks, Husky, or `test:scripts`.
- Porting `db:status`, `db:migration-safety`, hook, verify, or worktree
  behavior.
- Changing persisted state-file formats or command output.

Exit criteria:

- New shared script helper code, if needed, is covered by focused Vitest tests.
- No public command behavior changes.

## Later Leaves

- Add parity coverage for the current `db:status` script path before behavior
  changes.
- Add fixture parity coverage for the current
  `scripts/migration-safety-scan.sh` behavior before porting it.
- Port the migration-safety scanner core to a typed script while keeping public
  `db:migration-safety` behavior unchanged.
- Switch `db:migration-safety` to the typed scanner and retire replaced
  shell-specific test coverage.
- Add a hook snapshot-oracle fixture set for representative Claude and Codex
  hook payloads before rewriting hook logic.
- Later phase families remain parked in the source draft: pattern scanners,
  lightweight wrappers, verify cache and viewer, agent hooks, worktree
  provisioning, doctor, and cleanup.

## Completed

### Leaf 0A: Scripts Vitest Wiring Baseline

Completed 2026-05-10. Review found a concrete gap: the scripts Vitest project
included only enumerated nested test directories plus root tests, and
`test:changed` only routed known script subtrees. Landed recursive
`scripts/**/*.test.ts` project selection, recursive test coverage exclusion,
top-level plus nested script-test changed routing, and a smoke case for a
generic nested script test. No public commands, hooks, Husky, or `test:scripts`
were repointed.

## Watch Points

- The source draft's Phase 0 expected scripts Vitest project wiring to be
  absent, but this checkout already has that project. Treat the first leaf as a
  baseline audit unless a concrete coverage gap appears.
- Keep migration leaves smaller than full phases. A good leaf is one command
  skeleton, one fixture set, one parity surface, or one narrow implementation
  slice.
- Hook and worktree rewrites are explicitly not first-week work unless a human
  re-triages the plan.
