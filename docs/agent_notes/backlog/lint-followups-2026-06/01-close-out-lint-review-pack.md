# Close Out The lint-review-2026-06 Pack

Status: Done (2026-06-12, landed in "docs(lint): archive completed
lint-review-2026-06 pack")
Order: 01
Source: 2026-06-12 close-out review.

## Close-out Notes (2026-06-12)

- Wrote `finished_work/lint-review-2026-06.md`, added the index bullet in
  `finished_work/README.md`, and added the LOG entry covering both the
  pack close-out and the landed coverage-hook throttle (006564e6); the
  stale in-progress note and the pack folder are deleted.
- Reference sweep interpretation: path references into the deleted folder
  were repointed (backlog README, ai-harness-followups,
  harness-review-tasks 00/50, three drift-ai-next-items leaves — the dead
  `11-scripts-coverage-family-map.md` links now point at
  `docs/agent_notes/lint-coverage-map.md` — eslint-max-lines-policy,
  autonomous-agent-iteration-candidates, two finished_work notes, the
  script-configs.js verdict comment, and the zero-baseline test/guide
  example exitPaths, which now use a fictional `example-pack` path).
  Pure-text leaf citations ("lint-review-2026-06 leaf 03e") in the
  append-only debt log, `harness.controls.json` principles (and its
  generated doc), and `lint-coverage-map.md` table cells were kept as
  provenance; they resolve via the finished-work summary and git history.

## Context

All 23 ordered leaves in `docs/agent_notes/backlog/lint-review-2026-06/`
are `Done` and merged to main (merge 1eb011d4). The repo convention for
completed packs is deletion with durable bits preserved: the legacy lint
queues were "consolidated ... and removed" with verdicts "available in git
history" (see the prior pack's index cleanup addendum), one-page summaries
live in `docs/agent_notes/finished_work/`, and `LOG.md` keeps curated
recent history.

Separately, `docs/agent_notes/in_progress/lint-coverage-hook-throttle.md`
is stale: its implementation landed in 006564e6 ("fix(lint-hooks):
throttle partial ratchet notes"), and the note's own closing line says
"When this lands, fold the durable bits into `LOG.md` and delete this
note."

This pack (`lint-followups-2026-06`) already carries forward the prior
pack's still-live watchlist entries (re-triaged 2026-06-12) and starts a
fresh verdict register, so nothing in the old folder is load-bearing for
future work except as history.

## Scope

- Write `docs/agent_notes/finished_work/lint-review-2026-06.md`: a short
  summary of what the pack changed (scripts coverage inversion, ratchet
  drain from 37 to 9 registered ratchets, e2e selector floors, cache
  removal, merge-base preflights, import-cycle verdict), with a pointer to
  git history for the leaves and verdicts.
- Add a `LOG.md` entry (newest on top) covering both the pack completion
  and the landed lint-coverage hook throttle, then delete
  `docs/agent_notes/in_progress/lint-coverage-hook-throttle.md`.
- Delete `docs/agent_notes/backlog/lint-review-2026-06/` entirely. Before
  deleting, `rg -l "lint-review-2026-06"` across the repo and repoint any
  remaining references (docs, guides, configs) at this pack or at the
  finished-work summary.
- Do not delete or rewrite history of `evaluation-verdicts.md` content the
  new pack's register references; cite "git history before the folder was
  removed" the same way the prior pack did for its predecessors.

## Definition Of Done

The old pack folder is gone, no dangling references to it remain, the
stale in-progress note is gone, and `finished_work/` + `LOG.md` carry the
durable summary.

## Verification

- `rg "lint-review-2026-06" --hidden -g '!node_modules'` returns only
  intentional mentions (finished-work summary, LOG entry, this pack's
  provenance notes).
- `bash scripts/doc-length-policy.sh` (or the verify-bundled docs checks)
  passes for the new/edited docs.
- `bun run verify:changed` (docs-only change; stage everything first).
