# Leaf 8: Next Ratchet Candidate - local/max-lines

Status: Resolved 2026-05-19 - `local/max-lines` ratchet landed; no longer the
standalone next ratchet candidate.
Sources:

- `docs/agent_notes/NEXT.md`
- `docs/agent_notes/backlog/lint-ratchet-followups.md`
- `docs/agent_notes/backlog/lint-hardening/01-zero-warning-lint-gate.md`
- `docs/agent_notes/finished_work/lint-ratchet-local-max-lines-leaf-08.md`

## Problem

`local/max-lines` was the next ratchet candidate after the PR 4 infrastructure
work. It has since landed, so this note is retained as provenance rather than a
promotion pointer.

## Scope

The current promotion pointer lives in `docs/agent_notes/NEXT.md`. Do not use
this historical leaf as permission to add another ratchet automatically.

## Historical Candidate Work

- Inventory current `local/max-lines` findings with the intended ratchet scope.
- Confirm the diagnostic and paired guide explain how to split oversized files.
- Decide whether the baseline should be per-file count, effective-line count,
  or another deterministic measure already exposed by the rule.
- Add a new `lintRatchets` registry entry and manifest control.
- Generate and commit the baseline.
- Record runtime impact using the Leaf 4 measurement pattern.

## Historical Exit Criteria

- `local/max-lines` can no longer get worse in ratcheted scope.
- Existing oversized files remain visible as debt without blocking unrelated
  work.
- Manifest, generated docs, and baseline validation all agree.

## Historical Budget Constraint

This leaf's original budget notes were superseded after Leaves 22/23 landed.
The current PR 4 note records a warm-budget breach after the type-aware
ratchet was added. That does not move ratchets out of pre-commit: local
enforcement is required because external CI is not a reliable enforcement point
for this project. Runtime measurements remain useful for deciding whether to
parallelize or batch ratchet runs, not for making new ratchets CI-only.

## Historical Verification

- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bun run harness:check`
- `bun run docs:harness-controls:check`
- `bun run lint`
- `bun run test:scripts:changed`
- `bun run verify:changed`
