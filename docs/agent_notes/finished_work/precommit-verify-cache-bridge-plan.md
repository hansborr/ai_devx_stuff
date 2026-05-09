# Pre-Commit / Verify Cache Bridge Plan

Status: Implemented in working tree.
Created: 2026-05-07.
Implemented: 2026-05-07.

## Implementation Summary

The bridge lives in `scripts/verify-metadata.sh`. `scripts/verify.sh` and
`.husky/pre-commit` now share strict marker parsing/writing helpers, and
pre-commit tries `verify:changed` then full `verify` markers after its native
pre-commit marker misses. A bridged skip writes only the normal pre-commit
marker and exits before watchdog/log metadata setup, so existing
`run-meta.json` / `meta/wrapper.json` files are left intact.

Verification: `bash scripts/test-dependency-freshness.sh`,
`bash scripts/test-verify.sh`, `bash scripts/test-verify-logs.sh`,
`bash scripts/test-ai-hooks.sh`, and `bun run verify:changed` passed.

## Problem

`bun run verify:changed` and `.husky/pre-commit` run the same core checks for
most commits, but their success markers are intentionally separate today:

- `verify:changed` writes `/tmp/musi-verify-changed-last`, keyed by
  `HEAD + git diff HEAD + untracked file contents`
  (`ai_worktree_fingerprint`).
- `pre-commit` writes `/tmp/musi-pre-commit-last`, keyed by
  `HEAD + staged diff + relevant tracked/untracked working-tree inputs`
  (`ai_precommit_fingerprint`).

Because pre-commit only trusts its own marker, a contributor can run
`verify:changed`, stage the same files, commit, and then pay for the same
checks again.

The important safety detail: the commands pre-commit runs are working-tree
checks, not pure staged-snapshot checks. `lint:changed`, `test:changed`,
`typecheck`, and `test:scripts:changed` all observe the current worktree or
the changed-files set derived from it. For already-tracked edits, staging
without editing does not change `git diff HEAD`, so a fresh successful
`verify:changed` marker can safely satisfy pre-commit when the current
worktree fingerprint still matches it. New files are stricter: staging a file
that was untracked when `verify:changed` ran changes `ai_worktree_fingerprint`
because the file leaves the untracked-file list. The bridge should fail closed
and rerun in that case.

## Goal

Teach pre-commit to accept a recent successful manual verify marker when it
can prove that the current checked state is the same state that manual verify
checked. Preserve fail-closed behavior for any ambiguity.

Non-goals:

- Do not let async verify jobs write or satisfy pre-commit markers in this
  pass.
- Do not bypass the existing staged-source gate, dependency/schema/doc
  warnings, lock, watchdog, or `FORCE_VERIFY=1`.
- Do not relax correctness by comparing only staged diffs.

## Proposed Design

Add a one-way bridge in `.husky/pre-commit` after the existing pre-commit
marker miss and before the watchdog/tasks start:

1. Keep the current pre-commit marker check first.
2. If it misses and `FORCE_VERIFY` is not set, read both manual verify markers
   (in this priority order, accept the first that proves equivalence):
   - `MUSI_VERIFY_MARKER_CHANGED` / `/tmp/musi-verify-changed-last`
   - `MUSI_VERIFY_MARKER_FULL` / `/tmp/musi-verify-last`
   Both are in scope because full verify is a strict superset of every
   changed-suffix step pre-commit runs (`lint` ⊇ `lint:changed`, `test` ⊇
   `test:changed`, `test:scripts` ⊇ `test:scripts:changed`, `typecheck`
   identical). Implementation cost is the same as honoring one marker.
3. Accept a marker only when all of these are true:
   - marker parses cleanly as `LAST_TS`, `LAST_HEAD`, `LAST_HASH`
   - marker age is within the same freshness window pre-commit uses today
     (120s for the initial implementation)
   - `LAST_HEAD` equals current `git rev-parse HEAD`
   - `LAST_HASH` equals current `ai_worktree_fingerprint "$REPO_ROOT"`
4. On acceptance:
   - print a skip line that names the marker source so it is visually distinct
     from the existing native skip line (`already verified Ns ago at HEAD`),
     for example: `pre-commit: verify:changed passed 37s ago for this
     worktree — skipping (set FORCE_VERIFY=1 to re-run).`
   - atomically write the normal pre-commit marker with current
     `ai_precommit_fingerprint "$REPO_ROOT"` so a repeated commit attempt can
     use the existing fast path
   - exit 0 *without* writing wrapper or step run-meta. The verify run's
     `run-meta.json` is the source of truth for that worktree state; a
     synthetic zero-elapsed wrapper would overwrite it and mislead
     `verify:logs`.
5. If no manual marker proves equivalence, run the existing parallel checks
   unchanged.

This is conservative: it may still rerun after harmless changes to unrelated
untracked files because `ai_worktree_fingerprint` includes all untracked file
contents while `ai_precommit_fingerprint` only includes the curated relevant
set. That asymmetry produces false negatives (extra reruns), never false
positives (incorrect skips), which is the safe direction for a first pass. The
same false-negative behavior applies when a new file is verified while
untracked and then staged before commit.

## Implementation Tasks

- Move marker parsing/writing into small shared helpers in
  `scripts/verify-metadata.sh` so `scripts/verify.sh` and `.husky/pre-commit`
  stop duplicating ad hoc marker parsing.
- Keep the helper shell-compatible with the existing `sh .husky/pre-commit`
  smoke path in `scripts/test-dependency-freshness.sh`. Concretely: use the
  `case "$LAST_TS" in ''|*[!0-9]*) LAST_TS=0 ;; esac` form pre-commit already
  uses, not bash's `[[ =~ ]]` form that `scripts/verify.sh` currently uses;
  and keep `${var:-}` defaults so `set -u` in pre-commit stays safe.
- Add the bridge helper as `musi_try_verify_marker_bridge` (matching the
  `musi_*` prefix already used in `verify-metadata.sh`). Helper checks the
  configured manual markers against `ai_worktree_fingerprint`, returns 0 on
  acceptance after writing the pre-commit marker, returns non-zero otherwise.
- Both `MUSI_VERIFY_MARKER_CHANGED` and `MUSI_VERIFY_MARKER_FULL` are in
  scope. The helper tries the changed-mode marker first; if it does not
  prove equivalence, fall through to the full-mode marker before giving up.
- Update the comments in `scripts/verify.sh` and `.husky/pre-commit`; the old
  statement that the files differ because the fingerprints differ becomes
  incomplete once pre-commit can trust a worktree marker. Add an inline note
  near the bridge call explaining the strict-superset argument for
  `test:scripts:changed` (pre-commit only runs scripts when staged paths
  match `^(.husky/|scripts/)`, but `verify --changed` runs `test:scripts:
  changed` unconditionally and `verify` runs `test:scripts`, so either
  manual marker covers the optional pre-commit step).
- Keep `FORCE_VERIFY=1` as a hard bypass for both native and bridged cache
  hits.

## Test Plan

Add shell smoke coverage, primarily in `scripts/test-dependency-freshness.sh`.
The harness already overrides `MUSI_PRECOMMIT_MARKER` per case; the new tests
must thread `MUSI_VERIFY_MARKER_CHANGED` and `MUSI_VERIFY_MARKER_FULL` the
same way so each sandbox repo controls its own bridge inputs.

- A staged source edit plus a fresh matching `MUSI_VERIFY_MARKER_CHANGED`
  causes pre-commit to skip without invoking the stubbed `bun` commands. The
  skip line names `verify:changed` so the source is unambiguous.
- A tracked source edit verified before staging can bridge after staging, but
  a new file verified while untracked and then staged does not bridge and runs
  checks. This pins the intentional false-negative behavior of
  `ai_worktree_fingerprint`.
- A staged source edit plus a fresh matching `MUSI_VERIFY_MARKER_FULL` causes
  pre-commit to skip identically; the skip line names `verify`. Required, not
  optional — full-mode acceptance ships in the same leaf.
- If the changed-mode marker is stale, corrupt, or otherwise non-matching but
  the full-mode marker matches, pre-commit accepts the full-mode marker. This
  pins the intended fallthrough instead of stopping at the first marker.
- The skip writes the normal pre-commit marker; a second pre-commit invocation
  can use the existing pre-commit cache path (assert via the `already
  verified` skip line, not the bridged one).
- A stale manual marker age causes pre-commit to run checks.
- A malformed manual marker, including missing fields or unknown keys, causes
  pre-commit to run checks.
- A marker with the wrong `HEAD` causes pre-commit to run checks.
- A marker whose `LAST_HASH` no longer equals the current worktree fingerprint
  causes pre-commit to run checks.
- `FORCE_VERIFY=1` causes pre-commit to run checks even when the manual marker
  matches.
- A bridge skip does not write `run-meta.json` or `meta/wrapper.json` (assert
  the files are absent or unchanged from the verify run that produced the
  marker), so `verify:logs` keeps reading the verify wrapper meta.

Regression commands for the implementing agent:

```bash
bash scripts/test-dependency-freshness.sh
bash scripts/test-verify.sh
bash scripts/test-verify-logs.sh
bash scripts/test-ai-hooks.sh
bun run verify:changed
```

Run broader verification if the shared marker helpers touch behavior beyond
the hook and verify wrappers.

## Risks And Edges

- The bridge should not trust a staged fingerprint alone. Manual verification
  ran against the worktree, so the worktree fingerprint is the proof.
- `test:scripts:changed` is safe under this bridge because `verify:changed`
  runs it unconditionally, while pre-commit only runs it for staged hook/script
  edits.
- The 120s window preserves the current pre-commit cache semantics. A future
  leaf can make the TTL configurable or longer if this remains too aggressive.
- There is still the normal local race where files could change while the hook
  is running. This plan does not worsen that race relative to the existing
  marker path.
