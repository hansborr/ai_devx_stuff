# Worktree Provisioning 2026-07 — Task Pack

Status: Task index
Created: 2026-07-15

Source: a 2026-07-15 review of the autonomous drain-lane recipe (agent memory)
against main. Every recurring lane-orchestration workaround was re-verified at
HEAD first; the ones already fixed on main were dropped rather than filed —
init's shared-dist build (`ensure_shared_output`), the land.sh sibling-main
preflight, and the worktree-aware commit wrapper with its bounded commit-queue
wait in `git-commit-quiet.sh`. What remains is the provisioning cost itself
plus two lifecycle sharp edges.

Adjacent: `harness-sweep-2026-07` leaf 45 carries the still-open commit-guard
remainder (policy-matcher target resolution, tidy-hook worktree-awareness,
marker-vanish tripwire); its Evidence block was truthed-up the same day this
pack was filed.

## Task List

Track: **T** tooling/config.

| # | Task | Track | Size | Priority | Status |
| --- | --- | --- | --- | --- | --- |
| 01 | [Reflink-clone lane dependencies in worktree:init (btrfs)](./01-reflink-lane-provisioning.md) | T | M | P2 | Done — early-stop re-scoped to same-filesystem guidance plus freshness fingerprints |
| 02 | [worktree:new failure recovery: clean up the created branch or print exact commands](./02-worktree-new-failure-recovery.md) | T | S | P3 | Done |
| 03 | [worktree:drop: full teardown, runnable from anywhere](./03-worktree-drop-full-teardown.md) | T | M | P3 | Done |

## Recommended Order

1. 01 first — it is the direct ask (make `worktree:new` fast on btrfs) and
   settles where lanes should live before the lifecycle leaves touch teardown
   docs.
2. 02 and 03 are independent of 01 and of each other.

## Promotion Rules

1. Promote one leaf at a time; read its Evidence block and re-verify every
   citation at HEAD before editing — line numbers drift.
2. Keep each leaf to one commit unless the leaf says otherwise; update this
   index's Status column in the same commit that finishes a leaf.
