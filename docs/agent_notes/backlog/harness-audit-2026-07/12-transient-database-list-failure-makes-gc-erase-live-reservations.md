# 12 — A transient database-list failure makes GC erase live reservations

Status: Done
Track: T (tooling) · Priority: P3 · Size: S

> **Amended — 2026-07-13 adversarial triage.** P2 was deflated to P3. Cleanup only iterates tombstoned slugs, stale allocation dropping is partly duplicated, and tombstone loss usually delays database drops; the residual risks are clone-fingerprint loss and a recreated-lane edge.

## Evidence (verified 2026-07-13; re-verify before implementing)

- `scripts/worktree-db.sh:2035` and `scripts/worktree-db.sh:2077` — database discovery failures are collapsed into an empty result with `|| true`.
- `scripts/worktree-db.sh:2079-2090` — phase 3 destructively removes tombstones, fingerprints, and allocations based on that result.
- `scripts/worktree-db.sh:2099` and `scripts/worktree-db.sh:2126` — template discovery and cleanup repeat the failure-as-empty pattern.

Failure: A transient discovery error can be mistaken for an empty database set and erase reservation metadata for tombstoned slugs, causing avoidable re-provisioning and a recreated-lane collision edge.

## Do

Distinguish a successful empty database list from a failed query. Skip destructive phase 3, including template cleanup, when discovery fails and leave all state intact.

## Verify

```
bash scripts/tests/test-worktree-db.sh
```

## Acceptance

- A simulated database-list failure preserves tombstones, fingerprints, and allocations.
- A successful empty list still performs the intended stale cleanup.
