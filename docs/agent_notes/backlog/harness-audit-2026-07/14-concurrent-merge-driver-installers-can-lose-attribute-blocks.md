# 14 — Concurrent merge-driver installers can lose attribute blocks

Status: Done
Track: T (tooling) · Priority: P3 · Size: S

> **Amended — 2026-07-13 adversarial triage.** P2 was deflated to P3 because the installers are aggressively self-healing and doctor detects drift. The verified transient harm is one baseline merge occurring without its semantic driver.

## Evidence (verified 2026-07-13; re-verify before implementing)

- `scripts/git/install-baseline-merge-driver.sh:106-123` — the shared common-git-dir attributes file is read, rendered, and replaced without a lock or compare-and-swap.
- Three independently callable installer entry points update the same `info/attributes` file, so their read-modify-write windows can overlap.
- The existing doctor check detects the resulting drift, but only after the lost update.

Failure: Two sibling worktrees can both report successful installation while last-writer-wins replacement briefly drops the other driver block.

## Do

Hold a common-git-dir flock across read, render, compare, and replace, then re-read only after acquiring it. A single transactional dispatcher is also acceptable. Coordinate with [harness-explore leaf 11](../harness-explore-2026-07/11-hook-trio-dedup.md), which addresses installer duplication rather than this race.

## Verify

Extend `scripts/tests/test-lint-ratchet.sh` with two concurrent installer
processes sharing one common-Git-dir attributes file, and assert that both
managed blocks survive; then:

```
bash scripts/tests/test-lint-ratchet.sh
```

## Acceptance

- A concurrent two-installer regression preserves every attribute block.
- The lock is scoped to the common Git directory shared by sibling worktrees.
