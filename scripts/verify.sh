#!/bin/bash
# verify.sh — manual lint/typecheck/test umbrella for humans and AIs.
#
# Mirrors `.husky/pre-commit` but runs steps sequentially so an AI session
# can read each step's output one at a time. Reuses pre-commit's lock and
# log directory so manual runs queue cleanly behind any in-flight commit.
# Marker file path differs (verify watches the worktree state, not the
# staged diff) but the on-disk format matches pre-commit's.
#
# Usage:
#   bash scripts/verify.sh            # full lint, typecheck, test
#   bash scripts/verify.sh --changed  # lint:changed, typecheck, test:changed
#
# Env:
#   FORCE_VERIFY=1     bypass the last-verified short-circuit.
#   MUSI_VERIFY_LOCK / MUSI_VERIFY_LOG_DIR / MUSI_VERIFY_MARKER_CHANGED /
#   MUSI_VERIFY_MARKER_FULL
#                      override paths for tests; do not use in production.
#
# Why sequential: the pre-commit hook runs the three primitives in parallel
# because it is git-invoked and there is no benefit to spreading the output
# over time. Manual verification is read by an AI or a human as it streams,
# and a parallel failure summary is harder to act on than "stopped at step 2".

set -u

LABEL=verify
MODE=full
case "${1:-}" in
  --changed)
    MODE=changed
    LABEL='verify:changed'
    ;;
  '')
    ;;
  *)
    printf 'verify: unknown argument: %s\n' "$1" >&2
    printf 'usage: verify.sh [--changed]\n' >&2
    exit 2
    ;;
esac

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# shellcheck source=/dev/null
. "$REPO_ROOT/scripts/ai-hooks/cache.sh"

LOCK="${MUSI_VERIFY_LOCK:-/tmp/musi-pre-commit.lock}"
LOG_DIR="${MUSI_VERIFY_LOG_DIR:-/tmp/musi-pre-commit-logs}"
# DX7.0a Vitest timing capture: pair the dot reporter with Vitest's json
# reporter so every wrapper-driven test run leaves a parseable timings file
# alongside test.log. The file lives in $LOG_DIR so it shares the same
# wipe/lifecycle as the test log itself; a future viewer (DX7.0b) reads
# `testResults[].assertionResults[].duration` from it. The default
# `bun run test` script is unchanged — only the wrapper-injected command
# carries the json reporter.
TIMINGS_FILE="$LOG_DIR/test-timings.json"
if [ "$MODE" = changed ]; then
  MARKER="${MUSI_VERIFY_MARKER_CHANGED:-/tmp/musi-verify-changed-last}"
  LINT_CMD=(bun run lint:changed)
  TEST_CMD=(bun run test:changed --reporter=dot --reporter=json --outputFile.json="$TIMINGS_FILE")
  SCRIPTS_CMD=(bun run test:scripts:changed)
else
  MARKER="${MUSI_VERIFY_MARKER_FULL:-/tmp/musi-verify-last}"
  LINT_CMD=(bun run lint)
  TEST_CMD=(bun run test --reporter=dot --reporter=json --outputFile.json="$TIMINGS_FILE")
  SCRIPTS_CMD=(bun run test:scripts)
fi
TYPECHECK_CMD=(bun run typecheck)

# --- 1. Single-writer lock -------------------------------------------------
# Blocking flock: a manual run is fine to queue behind an in-flight pre-commit
# or another verify. The 540s ceiling matches the pre-commit watchdog so we
# don't accidentally outlive it.
LOCK_WAIT=540
exec 9<>"$LOCK"
LOCK_START=$(date +%s)
if ! flock -w "$LOCK_WAIT" 9; then
  HOLDER=$(cat "$LOCK" 2>/dev/null || true)
  cat >&2 <<EOF
=== $LABEL: another verification is still running after ${LOCK_WAIT}s ===
${HOLDER:-<holder info unavailable>}

That is long enough to suggest a hang, not the usual queue. Inspect the
holder above before retrying.
EOF
  exit 2
fi
LOCK_WAITED=$(( $(date +%s) - LOCK_START ))
[ "$LOCK_WAITED" -gt 5 ] && printf '%s: waited %ds for %s\n' "$LABEL" "$LOCK_WAITED" "$LOCK" >&2
{ printf 'PID=%s LABEL=%s STARTED=%s\n' "$$" "$LABEL" "$(date -Iseconds)"; } > "$LOCK"

# --- 2. Last-verified short-circuit ----------------------------------------
# Same key format as pre-commit's marker (LAST_TS / LAST_HEAD / LAST_HASH);
# different file because the input fingerprint differs (worktree state vs
# staged diff). Parsed line-by-line — never eval /tmp files.
CUR_HEAD=$(git rev-parse HEAD 2>/dev/null || echo none)
CUR_HASH=$(ai_worktree_fingerprint "$REPO_ROOT")

if [ -f "$MARKER" ] && [ "${FORCE_VERIFY:-}" != "1" ]; then
  LAST_TS=0; LAST_HEAD=""; LAST_HASH=""
  while IFS='=' read -r k v; do
    case "$k" in
      LAST_TS)   LAST_TS=$v ;;
      LAST_HEAD) LAST_HEAD=$v ;;
      LAST_HASH) LAST_HASH=$v ;;
    esac
  done < "$MARKER"
  [[ "$LAST_TS" =~ ^[0-9]+$ ]] || LAST_TS=0
  NOW=$(date +%s)
  if [ "$((NOW - LAST_TS))" -lt 120 ] \
     && [ "$LAST_HEAD" = "$CUR_HEAD" ] \
     && [ "$LAST_HASH" = "$CUR_HASH" ]; then
    printf '%s: already verified %ds ago at %s — skipping (set FORCE_VERIFY=1 to re-run).\n' \
      "$LABEL" "$((NOW - LAST_TS))" "$CUR_HEAD"
    exit 0
  fi
fi

# --- 3. Watchdog ------------------------------------------------------------
# Mirrors pre-commit. 540s ceiling stays under Claude Code's 10-min Bash limit
# so a hung run never leaves an orphaned process the agent can't observe.
# `MUSI_VERIFY_TIMEOUT` is exposed for tests; do not lower it in production.
TIMEOUT="${MUSI_VERIFY_TIMEOUT:-540}"
HOOK_PID=$$
(
  # Close FD 9 so the sleep child does not inherit the flock — otherwise a
  # killed watchdog can orphan the lock.
  exec 9<&-
  SLEEP_PID=""
  trap '[ -n "$SLEEP_PID" ] && kill "$SLEEP_PID" 2>/dev/null; exit 0' TERM INT
  sleep "$TIMEOUT" &
  SLEEP_PID=$!
  wait "$SLEEP_PID"
  printf '\n=== %s TIMED OUT (%ds) ===\n' "$LABEL" "$TIMEOUT" >&2
  kill -TERM "$HOOK_PID" 2>/dev/null
) &
WD=$!

CURRENT_PID=""
cleanup_children() {
  if [ -n "$CURRENT_PID" ]; then
    kill "$CURRENT_PID" 2>/dev/null
    # Reap so the dying child's inherited fds (including the lock fd) close
    # before this hook exits. Mirrors bun-run-quiet.sh's on_sigterm pattern.
    wait "$CURRENT_PID" 2>/dev/null
  fi
  kill "$WD" 2>/dev/null
}
trap 'cleanup_children; exit 130' INT
trap 'cleanup_children; exit 124' TERM
trap 'kill "$WD" 2>/dev/null' EXIT

# --- 4. Sequential runs ----------------------------------------------------
# Wipe the shared log dir so a stale typecheck.log from an earlier run that
# halted at lint cannot mislead readers (DX3.6 verify:logs leans on these
# files being from the most recent run only). Pre-commit does the same.
rm -rf "$LOG_DIR"
mkdir -p "$LOG_DIR"

START_TS=$(date +%s)
passed=""; failed=""

# Run a step in a backgrounded child so traps reach it via $CURRENT_PID.
# Output goes to a log file (matching pre-commit) — the failure summary at
# the bottom prints a 30-line tail when something breaks.
run_step() {
  local name="$1"; shift
  local log="$LOG_DIR/${name}.log"
  printf '%s: running %s...\n' "$LABEL" "$name"
  # Close FD 9 in the child so test workers don't hold the lock past our exit;
  # mirrors bun-run-quiet.sh's `9>&-` redirect on its wrapped child.
  "$@" > "$log" 2>&1 9>&- &
  CURRENT_PID=$!
  if wait "$CURRENT_PID"; then
    CURRENT_PID=""
    passed="$passed $name"
    return 0
  fi
  CURRENT_PID=""
  failed="$failed $name"
  return 1
}

# Stop at the first failure. Manual verification is iterative — a contributor
# fixes one step then re-runs — so dragging on through the remaining steps
# just buries the actionable error under more output.
overall=0
run_step lint "${LINT_CMD[@]}" || overall=1
[ "$overall" -eq 0 ] && { run_step typecheck "${TYPECHECK_CMD[@]}" || overall=1; }
[ "$overall" -eq 0 ] && { run_step test "${TEST_CMD[@]}" || overall=1; }
[ "$overall" -eq 0 ] && { run_step scripts "${SCRIPTS_CMD[@]}" || overall=1; }

ELAPSED=$(( $(date +%s) - START_TS ))

if [ -n "$failed" ]; then
  printf '\n=== %s FAILED (%ds) ===\n' "$LABEL" "$ELAPSED"
  printf 'Passed:%s\n' "$passed"
  printf 'Failed:%s\n' "$failed"
  for task in $failed; do
    printf '\n--- %s (full log: %s/%s.log) ---\n' "$task" "$LOG_DIR" "$task"
    tail -n 200 "$LOG_DIR/${task}.log" | ai_filter_known_output_noise | tail -n 30
  done
  case "$failed" in
    *lint*) printf "\nHint: try 'bun run lint:fix' to auto-fix formatting issues.\n" ;;
  esac
  exit 1
fi

# --- 5. Success marker (same format as pre-commit's) -----------------------
# Atomic write per DX3.1: tmp file in the same directory then `mv -f`. A
# killed verify between the two `printf`s would otherwise leave a half-written
# marker that the next short-circuit check parses as empty fields.
marker_dir=$(dirname "$MARKER")
marker_base=$(basename "$MARKER")
mkdir -p "$marker_dir"
marker_tmp=$(mktemp "$marker_dir/.${marker_base}.tmp.XXXXXX")
if {
  printf 'LAST_TS=%s\n'   "$(date +%s)"
  printf 'LAST_HEAD=%s\n' "$CUR_HEAD"
  printf 'LAST_HASH=%s\n' "$CUR_HASH"
} > "$marker_tmp" && mv -f "$marker_tmp" "$MARKER"; then
  :
else
  rm -f "$marker_tmp"
  printf '%s: WARN: failed to write marker %s\n' "$LABEL" "$MARKER" >&2
fi

printf '%s: OK (%ds) —%s\n' "$LABEL" "$ELAPSED" "$passed"
