# Status

**Last updated**: 2026-05-09 (code-intel Slice D runner extraction)
**Roadmap position**: DX5-DX8 closed. The `feature/devx2` merge-review queue
(MR1-MR5, FU1-FU5) and the `codebase-review-next-cycle.md` checklist
(CR1-CR21) are archived in `finished_work/`.
**Test suite**: Green at last merge. Exact counts belong in `LOG.md` or task
notes.

## What's in progress

Active branch: `feat/harness-improvements-v4` (unpushed). Work landed on it
covers two parked initiatives — see the linked notes for the full inventory:

1. **Cache-budget verification**, slices 1-4 — see
   `finished_work/cache-budget-verification-plan.md`. Slice 5 (typecheck
   optimization) stays conditional on measurements; conditional follow-ups
   live in `backlog/cache-budget-followups.md`.
2. **AI harness improvements** — see `finished_work/ai-harness-improvements.md`
   for the harness map, narrow guides, lint sensors, codemods, Stop-hook
   replay, and module breadcrumbs. Conditional follow-ups live in
   `backlog/ai-harness-followups.md`.

Active in-progress notes (open one only when its scope matches your task):

- `in_progress/agent-hook-git-safety.md` — `scripts/ai-hooks/policy.sh`
  blocks history rewrites, destructive Git/GitHub mutations, pushes to
  `main` / `master`, and raw shell `grep`.
- `in_progress/codex-test-output-summarization.md` — Codex test-output
  summarization, implemented in working tree.
- `in_progress/code-intel-ux-fixes.md` — prior pass landed (`def --name`,
  identifier snapping, `dependents --project` / `--exclude-tests`, depth
  marker, JSON output, scripts coverage). 2026-05-09 follow-ups landed
  `--limit`, shorter dependent labels, candidate test labels, subcommand help,
  `tests --limit` priority ordering, `def --name` near-match hints, and
  dependents package summaries. 2026-05-09 Slice D extraction is complete:
  shared types/errors, formatting, CLI parsing/help, workspace resolver logic,
  path/JSON helpers, source/project discovery, definition/export queries,
  graph queries, import graph construction, test-file predicates, and the
  runner/dispatcher now live in linted `scripts/code-intel/` modules.
  Remaining module extraction, `refs`, and daemon mode work is larger and
  should be promoted explicitly. Pick up only when retiering or on human
  request — the active `NEXT.md` leaf is independent.

`finished_work/code-intel-review-followups.md` is the canonical archive of
the v1 + review follow-ups landing. `backlog/code-intel-followups.md` and
`backlog/code-intel-daemon-options.md` hold the remaining conditional work.

`finished_work/precommit-verify-cache-bridge-plan.md` documents the
pre-commit ↔ verify cache bridge that is implemented in the working tree.

## Next leaf

Promoted in `NEXT.md`: add the module-doc refresh guide. Consult
`backlog/ai-harness-followups.md` when promoting subsequent leaves.

## Read Next

- `NEXT.md` — prioritized queue.
- `DECISIONS.md` — only when changing a cross-cutting pattern (split by
  domain into `decisions-{concurrency,auth,realtime,schemas,services,build}.md`).
- `LOG.md` or `finished_work/README.md` — only when you need retained
  history.
- `backlog/README.md` — only when re-triaging parked work.
- `backlog/ai-harness-followups.md` — source for future harness leaves
  after the current `NEXT.md` item lands.

## Handoff

1. Read this file, then `NEXT.md`.
2. If `NEXT.md` names an active note, open only that note.
3. If `NEXT.md` is empty, wait for human re-triage or promote exactly one
   ready leaf from `backlog/README.md`.
4. Read `backlog/README.md` only when promoting the next workstream or a
   human asks for re-triage.
5. When work lands, retain only durable handoff history and update this
   file only if the snapshot changed. If a session ends mid-flight, update
   the matching `in_progress` note and this section so the next agent can
   resume without guessing.
