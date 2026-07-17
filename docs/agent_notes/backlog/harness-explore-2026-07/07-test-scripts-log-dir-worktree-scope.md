# 07 — test-scripts log dir is /tmp-global, not worktree-scoped

Status: Done
Track: T (tooling) · Priority: P2 · Size: XS

> **Confirmed — 2026-07-11 adversarial triage.** All evidence verified at HEAD
> with no line drift, and the failure is reachable (per-smoke logs use stable
> names truncated at start, and `test:scripts` runs as verify/pre-commit slots
> with nothing setting `MUSI_SCRIPTS_LOG_DIR`). The worktree-scoped pattern to
> copy is `musi_standard_verify_log_dir` → `musi_standard_state_path` +
> `musi_worktree_key` (`verify-metadata.sh:139,99,59`). Implementation notes:
> `test-scripts.sh` currently sources only `lib/changed-base.sh`, so the fix
> must also source `lib/verify-metadata.sh` (dash-compatible by design) to reuse
> the state-path helpers; and `scripts/tests/test-test-scripts.sh` always sets
> `MUSI_SCRIPTS_LOG_DIR` explicitly in existing cases, so add a *new* assertion
> for the worktree-scoped default rather than expecting existing cases to break.

## Evidence (verified 2026-07-11; re-verify before implementing)

- `scripts/test-scripts.sh:222` — defaults to
  `MUSI_SCRIPTS_LOG_DIR:-/tmp/musi-test-scripts-logs`, shared by every
  worktree on the machine.
- The verify log dir is already worktree-scoped (see the wrapper/log pathing
  in `scripts/verify.sh` / `scripts/lib/verify-metadata.sh`), which is the
  pattern to copy.

Failure: two worktrees running `test:scripts` (e.g. parallel lane gates)
write into one log dir and clobber each other's tails, making failure
diagnostics misleading.

## Do

Scope the default log dir per worktree (fingerprint or path-derived subdir),
matching the verify log convention; keep the env override.

## Verify

```
bash scripts/tests/test-test-scripts.sh
```

## Acceptance

Concurrent `test:scripts` runs in different worktrees never share a log dir.
