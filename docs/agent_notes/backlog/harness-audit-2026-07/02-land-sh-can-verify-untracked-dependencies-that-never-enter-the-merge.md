# 02 — `land.sh` can verify untracked dependencies that never enter the merge

Status: Done
Track: T (tooling) · Priority: P2 · Size: S

> **Amended — 2026-07-13 adversarial triage.** P1/M was deflated to P2/S because normal pre-commit rejects source-relevant untracked files. The reachable residual is landing after `--no-verify`, a merge commit, a post-commit file creation, or path-policy misclassification.

## Evidence (verified 2026-07-13; re-verify before implementing)

- `scripts/land.sh:168-171` — the landing preflight rejects tracked and staged changes but not untracked files.
- `scripts/land.sh:248-258` — full verification runs in the live worktree, where an untracked dependency can satisfy imports.
- `scripts/land.sh:307-318` — the final proof compares Git trees, not the verified filesystem.
- `.husky/pre-commit:279` — the ordinary commit path already calls `musi_changed_gate_fail_if_unstaged`, limiting but not eliminating reachability.

Failure: A candidate commit can verify against an untracked source dependency that is absent from the tree later merged into the protected branch.

## Do

Call `musi_changed_gate_fail_if_unstaged` from `land.sh` before verification; the script already sources `scripts/lib/verify-metadata.sh`. Keep the check source-policy-aware and cover a source-relevant untracked dependency.

## Verify

```
bash scripts/tests/test-land.sh
```

## Acceptance

- Landing fails before verification when source-relevant untracked files exist.
- A clean candidate Git tree still follows the existing landing path.
