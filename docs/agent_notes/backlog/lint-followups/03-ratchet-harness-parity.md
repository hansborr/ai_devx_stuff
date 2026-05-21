# Leaf 3: Ratchet Harness Parity

Status: Resolved — both gaps closed in earlier work (verified 2026-05-19)
Source: `docs/agent_notes/backlog/lint-ratchet-followups.md`

## Resolution

Both gaps were already implemented before this leaf was opened:

- **Gap 1 (reverse parity in harness:check)**: `scripts/harness-check.ts`
  imports `lintRatchets`, builds `ratchetIds`, and `checkRatchetParity()`
  fails when a registry entry is missing from the manifest. Fixture
  coverage exists in `scripts/test-harness-check.sh`
  (`mutate_missing_ratchet_control`).
- **Gap 2 (manifest source-relevance)**: `.husky/pre-commit` (lines
  ~107 and ~232), `scripts/verify-metadata.sh` (line ~40), and
  `scripts/test-scripts.sh` (line ~91) all treat
  `harness.controls.json` as source-relevant. Coverage in
  `scripts/test-test-scripts.sh` and `scripts/test-dependency-freshness.sh`.

No further work needed. Codex evaluation 2026-05-19 confirmed.


## Problem

The ratchet manifest wiring is not fully symmetric. `harness:check` should
prove every exported ratchet registry entry has a matching manifest control,
and local gates should run when the manifest itself changes.

## Scope

Close two parity gaps:

- reverse parity in `harness:check`: every exported `lintRatchets` entry must
  have a matching `kind: "ratchet"` control in `harness.controls.json`;
- `harness.controls.json` should count as source-relevant for pre-commit and
  changed verification selection so manifest-only edits do not skip local
  gates.

Likely files:

- `scripts/harness-check.ts`
- `scripts/test-harness-check.sh`
- `.husky/pre-commit`
- `scripts/dependency-freshness.sh` or the relevant changed-path helper
- `harness.controls.json`

## Candidate Work

- Add a live ratchet registry read in `harness-check.ts`.
- Assert each registry id exists in the manifest with `kind: "ratchet"` and
  the expected invocation/source/guide shape.
- Add fixture coverage for a missing ratchet manifest control.
- Add manifest-only path relevance coverage for pre-commit or the shared
  changed-file helper used by pre-commit.
- Refresh generated harness docs if any control descriptions change.

## Exit Criteria

- A new ratchet cannot be added without a manifest control.
- A `harness.controls.json`-only staged edit runs the relevant local gates.
- Existing harness controls still validate on the real tree.

## Verification

- `bun run harness:check`
- `bun run docs:harness-controls:check`
- `bash scripts/test-harness-check.sh`
- Targeted pre-commit/path-relevance smoke
- `bun run test:scripts:changed`
