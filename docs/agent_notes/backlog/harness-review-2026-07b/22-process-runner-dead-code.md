# 22. process-runner.sh is runtime-dead — wire it in or delete it

Status: Proposed — from the 2026-07-06 AI-harness deep dive; NOT implemented. Re-verify file:line before acting.
Lens: quiet-wrappers · Area: hooks-exec · Severity: low · Size: S · Confidence: high
Theme: dead-code · Source: harness review 2026-07-06 (Sonnet breadth + Codex CONFIRMED)

## Problem
`scripts/ai-hooks/process-runner.sh` (`ai_run_logged_with_watchdog`,
`ai_run_terminate_process`) is not sourced by any wired hook body; the
live process/signal logic used by the quiet wrappers is
`scripts/process-tree.sh` (`musi_signal_process_tree`). Its only
reference is a smoke-test-selection stub asserting that editing it
triggers the ai-hooks suite — not that its functions run. Two parallel
process-supervision implementations invite drift, and its
`setsid`-based pattern is arguably the better one (relevant to leaf 21).

## Evidence
- `scripts/ai-hooks/process-runner.sh:33`; no `source`/`.` references from
  any wired body (grep across the tree, confirmed independently by Codex).
- Live path: `scripts/ai-hooks/bun-run-quiet.sh:44` sources
  `scripts/process-tree.sh`; also `.husky/pre-commit:71`, `scripts/verify.sh:65`.
- Stub-only test reference: `scripts/tests/test-test-scripts.sh:595-597`.

## Proposed direction
Decide with the leaf-21 implementer: if leaf 21 adopts the
setsid/pgid-tracking approach, fold process-runner.sh's useful parts into
`process-tree.sh` (one home for process supervision) and delete the file;
otherwise just delete it and its stub reference. Update the ai-hooks
README's file inventory if it lists the file.

## Scope / caveats
Deletion-only path is trivial; check `harness.controls.json` for any
control whose `source` points at the file before removing. One commit.
