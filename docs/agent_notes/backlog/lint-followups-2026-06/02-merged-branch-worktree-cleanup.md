# Remove Leftover Lint-Review Worktree And Merged Branches

Status: Done (2026-06-12, landed in "chore(git): remove merged lint-review
worktree and branches")
Order: 02
Source: 2026-06-12 close-out review.

## Context

The lint-review baton loop left a worktree and a set of fully merged
branches behind. Verified 2026-06-12:

- `worktrees/lint-review` is clean (`git -C worktrees/lint-review status
  --short` is empty) and checked out on `chore/lint-review-2026-06`, which
  is fully merged into main.
- `git branch --merged main` also lists: `feat/drift-ai-next-items-pack-review`,
  `feat/drift-ai-semgrep-onboarding`, `feat/lint-improvements`,
  `feat/scripts-hooks-reorg-design`, `feat/scripts-hooks-reorg-impl`,
  `feat/scripts-hooks-reorg-notes`, `feat/semgrep`,
  `feat/ux-audit-live-play-2026-06`, `fix/drift-ai-bin-override-precedence`.
- NOT merged (do not touch): `chore/react-lints` (checked out in
  `worktrees/exploration`), `docs/react-lints`,
  `chore/git-amend-block-investigation`, `feat/scripts-hooks-reorg-design`
  variants not in the merged list, and the
  `experiment/lint-ratchet-{left,right}-20260605102039` pair.

## Scope

- Re-run the verification commands above before acting; the snapshot is
  from 2026-06-12.
- `git worktree remove worktrees/lint-review` (only if still clean), then
  delete `chore/lint-review-2026-06`.
- Delete every branch that `git branch --merged main` lists, except `main`
  and any branch checked out in a remaining worktree.
- For unmerged branches: do NOT delete. Append a short inventory (branch,
  last commit date, one-line guess at intent) to this leaf's Notes so a
  human can decide; the experiment pair from 2026-06-05 is the main
  candidate for a human kill decision.

## Definition Of Done

No worktree points at a merged branch, `git branch --merged main` lists
only `main` and worktree-pinned branches, and the unmerged-branch
inventory is recorded in Notes.

## Verification

- `git worktree list` shows only `/workspace` and `worktrees/exploration`.
- `git branch --merged main` is only `main` (plus worktree-pinned
  branches, if any remain by design).
- `git -C worktrees/exploration status --short` unchanged before/after
  (prove the cleanup did not touch the live worktree).

## Notes (2026-06-12 execution)

- Re-verified before acting: `worktrees/lint-review` was clean on
  `chore/lint-review-2026-06`; `worktrees/exploration` status was empty
  before and after the cleanup.
- Removed `worktrees/lint-review` and deleted 13 fully merged branches —
  the 10 from the Context snapshot plus 3 that merged after it was taken:
  `feat/backlog-followup-packs`, `feat/lint-followups-leaf01-closeout`,
  `feat/lint-followups-pinned-decisions`. `git branch --merged main` now
  lists only `main`.
- Unmerged-branch inventory (branch — last commit date — intent guess),
  left for a human decision per Scope; none were touched:
  - `chore/git-amend-block-investigation` — 2026-05-31 — notes on a git
    amend-block bypass concern; likely fold into a doc and kill.
  - `chore/react-lints` — 2026-06-05 — live in `worktrees/exploration`;
    do not touch.
  - `docs/react-lints` — 2026-06-05 — useEffect research/guardrails plan;
    sibling of `chore/react-lints`, decide together with it.
  - `experiment/lint-ratchet-left-20260605102039` — 2026-06-05 — half of a
    throwaway ratchet merge-behavior test pair; main kill candidate.
  - `experiment/lint-ratchet-right-20260605102039` — 2026-06-05 — other
    half of the pair; same kill decision.
  - `feat/semgrep-portable-scan-leaf` — 2026-06-04 — backlog leaf for a
    portable semgrep AI-repo scan; check whether the leaf landed via
    another branch before killing.
  - `feat/semgrep-security-sensor-evaluation` — 2026-06-04 — semgrep
    security sensor evaluation verdict; same check as above.
  - `fix/drift-ai-prototype-plumbing` — 2026-06-05 — drift-ai prototype
    command plumbing fixes; may be superseded by merged drift-ai work.
  - `fix/hook-blocking` — 2026-05-31 — hook-blocking fix with a merge of
    main; stale, verify superseded before killing.
  - `fix/lint-brainstorming` — 2026-06-03 — agent ratchet guidance
    tweaks; likely superseded by the lint-review pack.
  - `spike/biome-fast-edit-loop` — 2026-05-26 — biome fast-edit-loop
    spike notes; oldest branch, likely record-and-kill.
  - `temp` — 2026-06-04 — carries the same commit subjects as
    `feat/semgrep-portable-scan-leaf` with different hashes (rebase
    leftover); strong kill candidate once that branch is decided.
