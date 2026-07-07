# 11 — Make worktree `.env` writes same-directory atomic

Status: Ready
Track: T (tooling) · Priority: P1 · Size: S

## Evidence (verified 2026-07-03; re-verify before implementing)

- `scripts/worktree-db.sh:822,834` — `write_worktree_env` creates temp
  files with bare `mktemp` (default TMPDIR) and `mv`s them onto the root
  and client `.env` targets (`:840,848`). No cleanup trap for the temps.
- `scripts/worktree-db.sh:1563-1566` — the same file already documents
  why atomic renames require same-filesystem temp files elsewhere.
- `scripts/worktree-db.sh:~910` — the writer runs after per-worktree
  DB/port/Redis allocation, so an interrupted write strands allocated
  resources behind a missing/truncated `.env`.

Cross-filesystem `mv` degrades to copy+unlink (non-atomic); TMPDIR is
commonly a different filesystem (tmpfs) than the repo checkout.

## Do

Create the temp files beside their targets (e.g.
`mktemp "$wt_root/.env.tmp.XXXXXX"`), keep the `mv`, and clean the temps
up on failure (trap or explicit rm on error paths). Cover the writer in
`scripts/tests/test-worktree-db.sh`: happy path produces both `.env`
files, and no `.env.tmp.*` remnant survives a simulated failure.

## Verify

```
bash scripts/tests/test-worktree-db.sh
```

## Acceptance

Both `.env` writes are same-directory atomic renames; interrupted runs
leave no temp remnants; existing worktree provisioning behavior unchanged.
