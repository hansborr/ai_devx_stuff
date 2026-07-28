# Consolidate `land.sh` Flow-Test Ownership

Status: Implemented — 2026-07-22
Date: 2026-07-21
Priority: P2
Size: M
Risk: low-medium

## Problem

`scripts/tests/test-land.sh` is the natural owner of `scripts/land.sh`, but
`scripts/tests/test-pre-push.sh` also copies and executes `land.sh`, maintains a
second Bun stub, and pins the same install / harness / Prisma / verify flow.
The two fixtures use different event formats and express overlapping behavior
independently. A focused `test-land.sh` run can therefore pass while the scripts
slot later fails on a stale expectation in `test-pre-push.sh`.

This has already caused two late repairs: `0f584804` added the Prisma preflight
to the pre-push suite's stale land sequences, and `dff40db9` added the frozen
install and merged-main reconciliation calls there after the corresponding
`land.sh` changes had landed elsewhere.

## Evidence

- `scripts/land.sh:297-343` owns the locked install, `harness:check`, Prisma
  generation, and full-verify sequence; `scripts/land.sh:410-416` owns the
  post-merge dependency reconciliation.
- `scripts/tests/test-land.sh:58-169` has a land-specific Bun stub with semantic
  event records. Its fast-path case asserts verify cardinality and tree identity
  at `scripts/tests/test-land.sh:315-351`, and the rest of that suite owns the
  land failure, merge-tree, race, and recovery cases.
- `scripts/tests/test-pre-push.sh:74-114` defines a different Bun stub. Exact
  whole-log assertions at `scripts/tests/test-pre-push.sh:438-439`,
  `scripts/tests/test-pre-push.sh:467-468`, and
  `scripts/tests/test-pre-push.sh:748-749` independently pin the same land call
  order.
- Both smokes appear in `direct_fixture_git_smokes` at
  `scripts/tests/test-test-scripts.sh:542-549`, but that array only checks that
  fixture-Git smokes clear inherited hook environment. It does not own changed
  selection. Selection is derived from each smoke's `# smoke-subjects:` header
  into `scripts/path-policy/path-policy-smoke-subjects-data.ts`; today both
  headers name `scripts/land.sh`.

## Scope

- Make `scripts/tests/test-land.sh` the single owner of `land.sh` execution-flow
  behavior, including preflight ordering, failure short-circuiting, branch mode,
  and post-merge reconciliation.
- Move any unique land behavior currently covered only in
  `scripts/tests/test-pre-push.sh` into the land suite before removing the
  duplicate fixture cases. In particular, port the current harness-failure
  short-circuit, harness-success sequence through Prisma generation and verify,
  and successful `--branch` post-merge frozen-install reconciliation. Preserve
  their failure classifications and ordering assertions.
- Keep `scripts/tests/test-pre-push.sh` focused on the pre-push and post-commit
  hooks. It may assert that hook guidance names `land.sh`; it must not maintain a
  second model of `land.sh`'s Bun-call sequence.
- Remove `scripts/land.sh` from `test-pre-push.sh`'s `# smoke-subjects:` header,
  keep it in `test-land.sh`, and run `bun run test:scripts:subjects` to regenerate
  `scripts/path-policy/path-policy-smoke-subjects-data.ts` and the generated
  smoke fixture. Do not hand-edit either generated output. The
  `direct_fixture_git_smokes` entries remain because both suites still create
  Git fixtures.
- A shared fixture/event helper is acceptable where it removes incidental stub
  duplication, but it must not leave two independently authored expectations
  for the canonical land sequence.

## Acceptance

- Adding, removing, or reordering one `land.sh` Bun invocation requires changes
  only in the authoritative land suite. That suite may keep multiple
  scenario-specific expectations; the invariant is one owning suite, not one
  giant whole-flow expectation.
- `scripts/tests/test-pre-push.sh` no longer copies or executes `scripts/land.sh`
  to test land flow and contains no exact land Bun-log expectation.
- Before any pre-push fixture is deleted, focused land regressions explicitly
  cover the current harness failure, harness success through Prisma and verify,
  and successful branch-mode merged-main dependency reconciliation behavior.
- Changed-test selection for `scripts/land.sh` runs `test-land.sh`. Pre-push and
  post-commit changes continue to run `test-pre-push.sh`; a selection fixture
  proves `scripts/land.sh` alone no longer selects `test-pre-push.sh`.
- Focused `test-land.sh`, `test-pre-push.sh`, and test-selection smokes pass, as
  does the complete scripts slot.

## Boundaries and sequencing

- This is test-ownership consolidation, not permission to change `land.sh`'s
  install, verification, merge, exit-code, or recovery contracts.
- Preserve hook-specific coverage in `test-pre-push.sh`; only land-specific
  fixture setup and assertions move.
- Move unique cases before deleting their old forms so the refactor never has a
  coverage gap.

## Implemented design

The authoritative contract stays local to `scripts/tests/test-land.sh`: its
semantic Bun event stub records locked installs, harness checks, Prisma
generation, and verify calls with repository and tree context. Scenario-specific
assertions own the successful call order, harness-failure short circuit,
failure classification, branch cleanup, and merged-main dependency
reconciliation. Each recognized invocation must match its complete argv shape;
changed arguments and unknown Bun commands are recorded with their full argv and
fail closed. A focused stub-contract regression pins that behavior, preserving
the removed pre-push stub's ability to expose newly added or changed Bun calls.
The formerly pre-push-only sibling-worktree, branch-argument, and post-verify
branch-movement cases moved into the same suite before their old fixtures were
removed.

No shared fixture helper was introduced. Once land execution left
`test-pre-push.sh`, that suite no longer needed a Bun stub at all; sharing the
land stub would therefore add indirection without removing duplication.
`test-pre-push.sh` retains only hook behavior, including its user-facing repair
guidance naming `bash scripts/land.sh`.

Changed-test ownership is likewise single-sourced from the smoke headers:
`scripts/land.sh` remains a subject of `test-land.sh` and is no longer a subject
of `test-pre-push.sh`. A runner regression proves a land-only change selects
only the land smoke; the generated subject data was refreshed from those
headers.
