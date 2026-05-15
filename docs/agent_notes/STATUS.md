# Status

**Last updated**: 2026-05-15 (Playwright harness surface restored in reference copy)
**Branch**: `chore/port-upstream-devx-20a9636f` (local)
**Verification**: No tests run in this reference repo by request; diff hygiene only.

## Current Queue

- No active leaf is promoted. Re-triage before starting another drift,
  BatonLoop, or Playwright harness leaf.
- Landed current-state workflow: config loading, current inventory,
  current-mode ghost/duplicates/comments coverage, deterministic chunk output,
  and `docs/ai-harness.md` coverage.
- Restored the upstream Playwright harness surface for reference use:
  tracked Claude/Codex `playwright-cli` skills, e2e guide, Playwright lint
  wiring, role-first selector rule, locator drift script, Playwright config,
  and the upstream `e2e/` examples.

## Active Notes

- `docs/agent_notes/in_progress/drift-ai-current-scope.md` is landed context;
  keep it only for historical design detail until archived.
- `docs/agent_notes/in_progress/batonloop-queue.md` is parked; its ready
  checklist was fully landed.
- `docs/agent_notes/in_progress/shell-migration.md` is parked until
  re-promoted.
- `docs/agent_notes/in_progress/ai-drift-sensors.md` is parked context for
  Leaf 6 (evaluate promotion) only — not the active leaf.
- `docs/agent_notes/in_progress/worktree-local-observability.md` is parked
  context until a future observability leaf is promoted.
- `docs/agent_notes/finished_work/a11y-tree-playwright-plan.md` is the durable
  Playwright harness rationale.

## Cold Reads

- Read `NEXT.md` after this file.
- Read `docs/agent_notes/in_progress/drift-ai-current-scope.md` only when
  changing or re-triaging drift:ai current-state behavior.
- Read `DECISIONS.md` only when changing a cross-cutting pattern.
- Read `LOG.md`, `finished_work/README.md`, or `backlog/README.md` only for
  retained history, archived operational detail, or explicit re-triage.
- The AI drift sensors note is preserved at
  `docs/agent_notes/in_progress/ai-drift-sensors.md` for future context, but
  is not the active queue.

## Handoff

The promoted drift:ai current-state leaf is complete and the Playwright harness
reference surface has been restored. `NEXT.md` intentionally has no ready leaf;
re-triage before promoting the next workstream.
