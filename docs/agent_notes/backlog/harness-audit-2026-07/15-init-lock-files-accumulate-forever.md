# 15 — `init-*.lock` files accumulate forever

Status: Done
Track: T (tooling) · Priority: P3 · Size: XS

> **Confirmed — 2026-07-13 adversarial triage.** The verifier found 82 accumulated files and confirmed GC never removes them. The fix must not unlink a flock file while another process may still hold or wait on its inode.

## Evidence (verified 2026-07-13; re-verify before implementing)

- `scripts/worktree-db.sh:968` and `scripts/worktree-db.sh:1146` — initialization creates a per-slug `init-*.lock` file.
- `scripts/worktree-db.sh:1997-2141` — garbage collection has no phase that removes obsolete init locks.
- At verification time, 82 such lock files were present in shared state.

Failure: Per-slug coordination artifacts grow without bound and leave stale state that obscures which worktrees are live.

## Do

Either use a single shared init lock or remove only locks for slugs with no live worktree while holding `gc.lock`. Do not delete a per-slug flock file that may have a concurrent holder or waiter, because unlinking it creates a second-inode race.

## Verify

```
bash scripts/tests/test-worktree-db.sh
```

## Acceptance

- Obsolete init locks are reclaimed without allowing two locks for one logical slug.
- Live or contended slug locks are never unlinked.
