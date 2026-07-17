# 11 — Numeric but impossible worktree allocations pass validation

Status: Done
Track: T (tooling) · Priority: P3 · Size: S

> **Amended — 2026-07-13 adversarial triage.** P1/M was deflated to P3/S. Object-shape validation and guarded capture now block the observed corruption paths; the remaining gap is defense in depth for hand-edited registries or out-of-band writers.

## Evidence (verified 2026-07-13; re-verify before implementing)

- `scripts/worktree-db.sh:99-107` — valid server-port, client-port, and Redis database bands are defined.
- `scripts/worktree-db.sh:1953-1957` — an existing slug allocation is returned without semantic range or collision validation.
- `scripts/worktree-db.sh:1987-1995` — resolution checks only that three fields are numeric.
- `scripts/worktree-db.sh:272-281` — current JSON shape validation prevents earlier truncation/corruption classes but not impossible numeric values.

Failure: A syntactically valid hand-edited registry can assign unusable or duplicate resources and pass initialization validation.

## Do

Validate all allocation entries against configured ranges and uniqueness before use or replacement. Reject invalid registries without rewriting them, and retain the existing shape guards.

## Verify

```
bash scripts/tests/test-worktree-db.sh
```

## Acceptance

- Out-of-band allocations outside every resource band are rejected.
- Duplicate ports or Redis databases across live slugs are rejected without mutating state.
