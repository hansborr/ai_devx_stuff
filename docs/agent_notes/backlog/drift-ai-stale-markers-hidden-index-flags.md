# drift:ai stale markers hidden index flags

Status: Backlog
Date: 2026-05-31

## Context

Review of task 27 noted that
`git status --porcelain --untracked-files=all -- <path>` is still not a complete
proof that working-tree marker line numbers match `HEAD`. Files marked
`assume-unchanged` or `skip-worktree` can hide local divergence from ordinary
status output, which means stale-marker blame could still age a shifted worktree
line against `HEAD`.

## Possible follow-up

If this edge case matters, add a stricter trust check before stale-marker blame.
Options include treating `git ls-files -v -- <path>` hidden index flags as
unsafe, or comparing the scanned worktree content with `HEAD:<path>` before
blame. Keep the existing degradation behavior: unsafe files should skip blame and
not qualify from counts alone.
