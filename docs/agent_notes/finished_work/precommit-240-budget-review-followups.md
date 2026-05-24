# Pre-Commit 240s Budget Review Follow-Ups

Date: 2026-05-23
Branch: `fix/lint-alignment-gaps`

## Summary

Implemented five slices from the review follow-up plan at
`docs/agent_notes/in_progress/precommit-240-budget-review-followups.md`.

### Slice 1: Process-tree cleanup on timeout

Extracted `musi_signal_process_tree` / `musi_child_pids` / `musi_is_integer`
from `scripts/verify-async.sh` into a new shared `scripts/process-tree.sh`.
Both `scripts/verify.sh` and `.husky/pre-commit` now source it and use
recursive process-tree killing on timeout instead of just signaling the
wrapper PID. The shared helper is POSIX-compatible (dash-safe).

Timeout output now says: "Timed out and stopped the verification process
tree. For deliberate long verification, use bun run verify:async[:changed]
and check bun run verify:async:status."

Added a child-process survival test to `test-verify.sh` (test 41) that
logs PIDs from the bun stub and verifies they are gone after the watchdog
fires.

### Slice 2: Full parallel verify mode

Added `verify --parallel` / `bun run verify:parallel`. Uses the same full
commands as sequential `verify` but runs all steps concurrently like
`verify:changed` does. Metadata mode is `parallel-verify`. Stop-policy
recognizes the new mode and maps it to the worktree fingerprint.

Sequential `bun run verify` is preserved for one-failure-at-a-time
debugging.

### Slice 3: Always run test:scripts:changed from pre-commit

Removed pre-commit's narrow trigger regex for script smokes. Pre-commit
now always invokes `test:scripts:changed` with `MUSI_SCRIPTS_CHANGED_FILES`
when any files are staged. The test-scripts runner no-ops quickly when no
smoke subjects match the changed files.

### Slice 5: Smart deletion classification

Only `.husky/*` and `scripts/*` staged deletions trigger the conservative
full script-smoke fallback. Non-script deletions (e.g.
`packages/server/src/example.ts`) now pass the staged file list through to
`test:scripts:changed` instead of forcing a full run.

### Slice 4: Focused tests

Added to `test-test-scripts.sh`:
- `.claude/settings.json` change selects `test-ai-hooks`
- `.codex/hooks.json` change selects `test-ai-hooks`
- `.codex/config.toml` change selects `test-lint-config-sensors`
- `.codex/skills/*/agents/openai.yaml` change selects config sensors
- Non-script deletion does not force full smoke suite

Added to `test-dependency-freshness.sh`:
- Pre-commit invokes `test:scripts:changed` for staged `.claude/settings.json`
- Pre-commit invokes `test:scripts:changed` for staged `.codex/hooks.json`
- Non-script deletion passes staged files through
- Script deletion uses full fallback

## Timing

`verify:parallel` exceeds the 240s hard budget on this worktree due to the
full `test:scripts` step (256s alone). Per-step breakdown:

- `coverage-map`: 8s
- `lint`: 25s
- `typecheck`: 28s
- `ratchet`: 161s
- `test`: killed at 240s (would be ~180s based on prior measurements)
- `scripts`: killed at 240s (256s full run measured separately)

The long pole is `test:scripts` (full suite). `verify:parallel` is useful
for worktrees where the full script suite has already been cached or when
a higher timeout is acceptable (`MUSI_INTERACTIVE_TIMEOUT=360`). For the
default 240s budget, `verify:changed` remains the right edit-loop gate.

## Verification

- `bash scripts/test-verify.sh` (57 tests)
- `bash scripts/test-verify-async.sh` (14 tests)
- `bash scripts/test-test-scripts.sh` (66 tests)
- `bash scripts/test-dependency-freshness.sh` (28 tests)
- `bash scripts/test-ai-hooks.sh`
- `bash scripts/test-verify-logs.sh` (44 tests)
- `bash scripts/test-verify-history.sh` (8 tests)
- `bun run lint:shell`
- `bun run scripts/harness-check.ts`
