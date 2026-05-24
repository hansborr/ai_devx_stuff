# Verification Follow-Ups After Budget Review

Status: ready for implementation
Filed: 2026-05-23
Branch context: `fix/lint-alignment-gaps`
Related:

- `docs/agent_notes/finished_work/precommit-240-budget-review-followups.md`
- `docs/agent_notes/backlog/cache-budget-followups.md`
- `docs/agent_notes/backlog/claude-cache-spanning-commands.md`

## Scope

The five pre-commit budget follow-up slices landed, but review found two
remaining behavior gaps and a few documentation corrections:

1. `verify:async` success markers are private, so pre-commit cannot reuse a
   successful async run.
2. Mixed staged deletions can hide deleted config paths from
   `test:scripts:changed`.
3. The generated/harness wording for `verify:parallel` overclaims the default
   240s budget benefit.
4. `STATUS.md` / `NEXT.md` need to mention this new in-progress follow-up while
   it exists.

Keep this as a focused follow-up, not a new lint-hardening cycle.

## Preferred Implementation Shape

This follow-up should lock in two small shared abstractions rather than adding
more parallel shell snippets to `.husky/pre-commit`, `scripts/verify.sh`, and
`scripts/verify-async.sh`.

### Shared Verify Marker Paths

The standard foreground marker paths should have one shared definition. Today
`verify.sh` and `verify-metadata.sh` both know the defaults, and the async
promotion fix would otherwise add a third copy.

Preferred shape:

- Add small helpers or exported default variables in `scripts/verify-metadata.sh`
  for the standard changed/full marker paths.
- Keep `MUSI_VERIFY_MARKER_CHANGED` and `MUSI_VERIFY_MARKER_FULL` as the
  payload marker overrides used by `verify.sh`.
- Use distinct names for standard promotion targets, for example
  `MUSI_VERIFY_STANDARD_MARKER_CHANGED` and
  `MUSI_VERIFY_STANDARD_MARKER_FULL`, or helper functions that apply those
  env overrides.
- Have `verify.sh`, `verify-metadata.sh`, and `verify-async.sh` all consume
  the shared helper/defaults instead of spelling `/tmp/musi-verify-*-last`
  in multiple places.

Acceptance check: after the implementation, the default standard marker paths
should be defined in one place, with tests still able to override marker paths
for isolated fixtures.

### Shared Script-Smoke Staged-Input Builder

`pre-commit` and `verify:changed` currently carry similar staged-file
classification logic. That duplication is what let ACMR-only forwarding drift
from deleted-file semantics. Fix this by extracting one small helper that both
wrappers use to prepare the script-smoke environment.

Preferred shape:

- Put the helper in an already-sourced shell module such as
  `scripts/verify-metadata.sh`, or in a small new POSIX-compatible script
  sourced by both wrappers.
- The helper should produce the full staged path set (`ACMRD`), the deleted
  subset (`D`), and whether a `.husky/*` or `scripts/*` deletion requires full
  fallback.
- `pre-commit` and `verify:changed` should call the helper instead of each
  open-coding their own `git diff --cached --name-only` decision tree.
- `test-scripts.sh` should keep ownership of mapping paths to smoke tests; the
  shared helper should only collect/classify staged input and choose whether
  to pass env vars or use the full fallback.

Acceptance check: after the implementation, there should not be two independent
copies of the staged script-smoke selection logic in `.husky/pre-commit` and
`scripts/verify.sh`.

## Issue 1: Async Verify Marker Bridge Gap

When a foreground `verify:changed` or pre-commit times out at 240s, the
timeout message tells the agent:

```text
Timed out and stopped the verification process tree.
For deliberate long verification, use bun run verify:async[:changed] and check bun run verify:async:status.
logs: /tmp/musi-pre-commit-logs
inspect: bun run verify:logs budget
```

If the agent follows this advice, runs `bun run verify:async:changed`, waits
for it to succeed, and then retries `git commit`, pre-commit re-runs
everything from scratch. The async success is invisible to pre-commit.

### Root Cause

`verify:async` invokes `verify.sh` with private marker paths:

```bash
MUSI_VERIFY_MARKER_CHANGED="$(dirname "$state")/markers/verify-changed-last" \
MUSI_VERIFY_MARKER_FULL="$(dirname "$state")/markers/verify-last" \
```

These land under:

```text
/tmp/musi-verify-async/<repo-key>/runs/<run-id>/markers/
```

The current run pointer lives at:

```text
/tmp/musi-verify-async/<repo-key>/latest
```

Pre-commit's marker bridge (`musi_try_verify_marker_bridge`) only checks the
standard foreground markers:

- `/tmp/musi-verify-changed-last`
- `/tmp/musi-verify-last`

So the async run's success marker is never found, and the agent pays the full
verification cost twice.

### Fingerprint Semantics

Do not key this bridge off async state's `worktree_fingerprint`; that value is
status metadata from the start of the async run. Pre-commit bridge freshness
must use the success marker contents written by `verify.sh`:

- `verify:async:changed` runs `verify:changed`, whose private marker
  `LAST_HASH` is an `ai_staged_fingerprint`.
- `verify:async` runs full `verify`, whose private marker `LAST_HASH` is an
  `ai_worktree_fingerprint`.

Promotion must preserve `LAST_HEAD` and `LAST_HASH` from the private marker
and write a fresh `LAST_TS` at the standard path.

### Recommended Fix

Promote successful async private markers to the standard marker paths from
`verify-async.sh` after the payload exits 0. Do not use `cp`; parse the private
marker with the existing marker reader and write the standard marker with
`musi_write_success_marker`, so the write is atomic and freshness reflects the
promotion time. Use the shared standard-marker path helper described above;
do not introduce another hardcoded copy of `/tmp/musi-verify-*-last`.

Shape:

```bash
promote_async_marker() {
  local private_marker="$1" target_marker="$2"

  musi_read_success_marker "$private_marker" || return 0
  if ! musi_write_success_marker \
      "$target_marker" \
      "$MUSI_MARKER_LAST_HEAD" \
      "$MUSI_MARKER_LAST_HASH"; then
    printf 'verify:async: WARN: failed to promote marker %s\n' "$target_marker" >&2
  fi
}

promote_async_verify_markers() {
  local run_dir

  run_dir=$(dirname "$state")
  promote_async_marker \
    "$run_dir/markers/verify-changed-last" \
    "$(musi_standard_verify_changed_marker)"
  promote_async_marker \
    "$run_dir/markers/verify-last" \
    "$(musi_standard_verify_full_marker)"
}
```

Call `promote_async_verify_markers` after `finish_child "$exit_code"` and only
when `exit_code` is 0. The exact env names can change, but avoid reusing
`MUSI_VERIFY_MARKER_CHANGED` / `MUSI_VERIFY_MARKER_FULL` inside the payload
for both private and standard paths; those names are already used to point
`verify.sh` at the async-private marker files.

### Alternative

Teaching `musi_try_verify_marker_bridge` to scan async state is possible but
less attractive. If this path is chosen, compute the repo-keyed latest path:

```bash
repo_key=$(printf '%s' "$repo_root" | sha256sum | awk '{print $1}')
async_latest="${MUSI_VERIFY_ASYNC_STATE_ROOT:-/tmp/musi-verify-async}/$repo_key/latest"
```

Do not use `/tmp/musi-verify-async/latest`; that path does not exist in the
current layout. This option couples `verify-metadata.sh` to
`verify-async.sh`'s state directory structure, so prefer marker promotion.

## Issue 2: Mixed Deletions Hide Script-Smoke Subjects

`pre-commit` and `verify:changed` currently build
`MUSI_SCRIPTS_CHANGED_FILES` from `git diff --cached --name-only
--diff-filter=ACMR`. If any ACMR file is staged and the staged deletions are
not under `.husky/` or `scripts/`, the wrappers pass that ACMR-only list into
`test:scripts:changed`.

`test-scripts.sh` treats `MUSI_SCRIPTS_CHANGED_FILES` as authoritative. When
that env var is set, it does not run its own deleted-file scan. Therefore a
commit that deletes `.codex/config.toml`, `.claude/settings.json`, or
`.codex/hooks.json` while also modifying an ordinary source file drops the
deleted config path before smoke selection. The result can be a false no-op
instead of `test-lint-config-sensors` or `test-ai-hooks`.

### Recommended Fix

Extend the env contract so wrappers pass the complete staged path set and the
deleted subset explicitly. Implement this through the shared script-smoke
staged-input helper described above, not as another pair of duplicated blocks:

```bash
STAGED_ALL_FILES="$(git diff --cached --name-only --diff-filter=ACMRD 2>/dev/null || true)"
STAGED_DELETED_FILES="$(git diff --cached --name-only --diff-filter=D 2>/dev/null || true)"
```

For non-script/hook deletions, invoke:

```bash
env \
  MUSI_SCRIPTS_CHANGED_FILES="$STAGED_ALL_FILES" \
  MUSI_SCRIPTS_DELETED_FILES="$STAGED_DELETED_FILES" \
  bun run test:scripts:changed
```

Update `test-scripts.sh` so:

- `read_changed_files` reads `MUSI_SCRIPTS_CHANGED_FILES` as the full changed
  path set when present.
- `read_deleted_files` reads `MUSI_SCRIPTS_DELETED_FILES` when present.
- If `MUSI_SCRIPTS_CHANGED_FILES` is set without
  `MUSI_SCRIPTS_DELETED_FILES`, keep the current backward-compatible behavior
  and assume no deleted-file metadata is available.
- `.husky/*` and `scripts/*` deletions still force the conservative full
  script-smoke fallback.

Add focused tests for:

- Deleting `.codex/config.toml` plus modifying a package file selects
  `test-lint-config-sensors`.
- Deleting `.claude/settings.json` plus modifying a package file selects
  `test-ai-hooks`.
- Non-script deletions do not force the full smoke suite.
- `.husky/*` and `scripts/*` deletions still force the full fallback.

## Issue 3: `verify:parallel` Documentation Overclaims

The harness control principle says `verify:parallel` "fits the 240s
interactive budget where sequential full verify may not." The measured
finished-work note says this worktree still exceeded 240s because full
`test:scripts` alone took 256s.

Soften the wording in `harness.controls.json` and regenerate
`docs/generated/harness-controls.md`. Suggested wording:

```text
Run the full lint, ratchet, typecheck, test, and scripts suites in parallel;
reduces full-verify wall time when the full script suite fits the selected
timeout or cached state.
```

## Handoff Updates

While this file remains in `in_progress/`, refresh the durable handoff docs so
the branch is not described as ready to land with only the five completed
budget-review slices:

- `docs/agent_notes/STATUS.md`
- `docs/agent_notes/NEXT.md`

When the fixes land, move durable details into `LOG.md` or a small
`finished_work/` note and remove this in-progress file.

## Verification

- `bash scripts/test-verify.sh`
- `bash scripts/test-verify-async.sh`
- `bash scripts/test-test-scripts.sh`
- `bash scripts/test-dependency-freshness.sh`
- `bash scripts/test-ai-hooks.sh`
- `bash scripts/test-verify-history.sh`
- `bun run docs:harness-controls:check`
- `bun run harness:check`

Manual bridge checks:

- Run `bun run verify:async:changed`, wait for success, then run `git commit`.
  Pre-commit should short-circuit with a message like
  `verify:changed passed Xs ago`.
- Run `bun run verify:async:changed`, wait for success, modify and stage a
  source-relevant file, then run `git commit`. Pre-commit should not
  short-circuit because the staged fingerprint changed.
- Run `bun run verify:async:changed`, wait 121+ seconds after success, then run
  `git commit`. Pre-commit should not short-circuit because freshness expired.
- Existing foreground `verify:changed` to `git commit` bridge still works.
- `bun run verify:async` full mode promotes the full marker and can bridge via
  the full worktree fingerprint.
