# Leaf 4: Ratchet Runtime Budget

Status: Resolved (2026-05-19) — measurements recorded; warm budget breached;
next-ratchet decision documented.
Source: `docs/agent_notes/backlog/lint-ratchet-followups.md`

## Resolution

Re-measured 2026-05-19 after Leaves 22 + 23 added two additional ratchets:

- Cold: 9.975s (was 6–8s)
- Warm median: 3.086s (was 1.40–1.55s)

Warm exceeds the original 1–2s budget. The breach is dominated by the
type-aware `strict-boolean-expressions-shared` ratchet whose ESLint cache is
intentionally disabled.

Full re-measurement and the next-step decision tree are recorded in
`docs/agent_notes/finished_work/lint-hardening-review-followup-pr-4-custom-ratchet.md`
("Re-measurement after Leaves 22/23"). The recommended next step is
parallelizing ratchet runs (option 1 there). A new leaf may be promoted from
that if it gets actioned.

## Problem

`lint:ratchet` is now part of CI, `verify.sh`, and pre-commit. Before adding
another ratchet, the team needs current cold and warm runtime data and an
explicit hook-budget decision.

## Scope

Measure `bun run lint:ratchet` runtime on a normal local checkout and record
the numbers in the durable PR 4 note or a new finished-work note.

The decision should answer whether to:

- keep sequential ESLint runs,
- parallelize ratchets,
- combine ratchets into one ESLint invocation, or
- after the 2026-05-20 human clarification, **not** keep additional ratchets
  CI-only. External CI is not currently reliable enough to be the only
  enforcement point, so runtime concerns must be addressed by local runner
  improvements instead.

## Candidate Work

- Measure cold runtime after clearing the relevant ESLint ratchet cache.
- Measure warm runtime immediately after a clean run.
- Measure impact when a source-relevant staged change triggers pre-commit.
- Record machine/context basics: branch, Bun version, whether cache was warm,
  and whether the worktree was otherwise clean.
- Update `docs/agent_notes/finished_work/lint-hardening-review-followup-pr-4-custom-ratchet.md`
  or add a small finished-work note if the measurements are too detailed for
  that file.

## Exit Criteria

- Runtime data is recorded in durable handoff notes.
- The next-ratchet leaf has a clear budget constraint before it is promoted.

## Verification

- `bun run lint:ratchet`
- `bun run verify:changed` when staging a representative source-relevant edit
  is practical.
- `git diff --check`
