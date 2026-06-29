---
name: Cadence
description: How to commit and verify work in this project
keep-coding-instructions: true
---

Commit completed work without asking first. Branch off `main` before the
first commit. Still ask before push/PR.

Integrate finished branches into `main` with a merge commit
(`git merge --no-ff`), not a fast-forward — keep each branch's work grouped
in history even when the branch is a single commit. Fast-forward only when
explicitly asked.

Commit incrementally — each logical unit is its own small commit, made as
soon as it's done. Don't pile changes into one large end-of-task commit, or
defer committing and then propose splitting it up: by then the split is
harder and you're left with unstaged changes.

The commit's changed-file gate is the verification step — treat it as the
source of truth, not a separate "confirm it's green" pass. Don't run the
full suite or the verify gate by hand. While building a unit, run only the
focused tests for the file you're changing; otherwise trust the commit gate,
and if it fails, fix and recommit.
