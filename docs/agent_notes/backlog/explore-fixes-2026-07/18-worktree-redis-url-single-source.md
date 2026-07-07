# 18 — Single-source the worktree Redis URL between generator and display

Status: Ready
Track: T (tooling) · Priority: P2 · Size: XS

## Evidence (verified 2026-07-03; re-verify before implementing)

- `scripts/worktree-db.sh:802` (search `redis://redis:6379`) — generates the
  canonical `REDIS_URL=redis://redis:6379/%d` for per-worktree env files.
- `scripts/worktree-new.sh:150` (search same) — re-hardcodes
  `redis://redis:6379/%s` purely for its status printout. If the Redis
  service host/port changes, the printed value silently drifts from the
  generated one.

## Do

Derive the display line from the generator (shared function or constant
sourced by both scripts) so the URL format exists exactly once. No behavior
change intended.

## Verify

```
bash scripts/tests/test-worktree-db.sh && grep -rn 'redis://redis:6379' scripts/ | wc -l
```

## Acceptance

The literal appears in exactly one place under `scripts/`; worktree-db tests
stay green; `worktree-new` prints the same URL as before.
