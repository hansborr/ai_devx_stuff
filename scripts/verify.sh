#!/bin/bash
# verify.sh — manual lint/ratchet/typecheck/test umbrella for humans and AIs.
#
# Mirrors `.husky/pre-commit`: changed-mode runs checks in parallel for the
# edit-loop budget, while full verify stays sequential so a human or AI can
# read one failure at a time. Reuses pre-commit's lock and log directory so
# manual runs queue cleanly behind any in-flight commit.
# Full manual verify markers watch the full worktree state. Changed manual
# verify markers watch staged content after the source-relevant preflight.
# Pre-commit uses its own staged/relevant-input marker first, then may bridge
# from a fresh matching manual marker.
#
# Usage:
#   bash scripts/verify.sh            # full lint, typecheck, test
#   bash scripts/verify.sh --changed  # lint:changed, typecheck, test:changed
#
# Env:
#   FORCE_VERIFY=1     bypass the last-verified short-circuit.
#   MUSI_VERIFY_STATE_ROOT
#                      base directory for worktree-scoped default state
#                      (defaults to /tmp).
#   MUSI_VERIFY_LOCK / MUSI_VERIFY_LOG_DIR / MUSI_VERIFY_MARKER_CHANGED /
#   MUSI_VERIFY_MARKER_FULL
#                      override derived paths for tests; avoid in production.
#
# Why mixed mode: the pre-commit hook and changed-mode verify are edit-loop
# gates, so wall time matters most and each step logs separately. Full verify
# remains sequential because release-shaped failures are easier to act on one
# step at a time.

set -u

LABEL=verify
MODE=full
case "${1:-}" in
  --changed)
    MODE=changed
    LABEL='verify:changed'
    ;;
  --parallel)
    MODE=parallel
    LABEL='verify:parallel'
    ;;
  '')
    ;;
  *)
    printf 'verify: unknown argument: %s\n' "$1" >&2
    printf 'usage: verify.sh [--changed|--parallel]\n' >&2
    exit 2
    ;;
esac
WRAPPER_COMMAND="$0 ${1:-}"

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT" || exit 1

# shellcheck source=/dev/null
. "$REPO_ROOT/scripts/lib/gate-env.sh"

# shellcheck source=/dev/null
. "$REPO_ROOT/scripts/ai-hooks/cache.sh"
# shellcheck source=/dev/null
. "$REPO_ROOT/scripts/lib/verify-metadata.sh"
# shellcheck source=/dev/null
. "$REPO_ROOT/scripts/lib/changed-base.sh"
# shellcheck source=/dev/null
. "$REPO_ROOT/scripts/process-tree.sh"
# shellcheck source=/dev/null
. "$REPO_ROOT/scripts/lib/parallel-step.sh"
# shellcheck source=/dev/null
. "$REPO_ROOT/scripts/lib/lint-dist-preflight.sh"
# shellcheck source=/dev/null
. "$REPO_ROOT/scripts/lib/verify-engine.sh"

LOCK="${MUSI_VERIFY_LOCK:-$(musi_standard_verify_lock "$REPO_ROOT")}"
LOG_DIR="${MUSI_VERIFY_LOG_DIR:-$(musi_standard_verify_log_dir "$REPO_ROOT")}"
HISTORY_DIR="${MUSI_VERIFY_HISTORY_DIR:-$(musi_standard_verify_history_dir "$REPO_ROOT")}"
# DX7.0a Vitest timing capture: pair the dot reporter with Vitest's json
# reporter so every wrapper-driven test run leaves a parseable timings file
# alongside test.log. The file lives in $LOG_DIR so it shares the same
# wipe/lifecycle as the test log itself; a future viewer (DX7.0b) reads
# `testResults[].assertionResults[].duration` from it. The default
# `bun run test` script is unchanged — only the wrapper-injected command
# carries the json reporter.
# shellcheck disable=SC2034 # Consumed by scripts/verify/steps.generated.sh.
TIMINGS_FILE="$LOG_DIR/test-timings.json"
# shellcheck disable=SC2034 # Consumed by scripts/lib/parallel-step.sh.
META_DIR="$LOG_DIR/meta"
INTERACTIVE_TIMEOUT="${MUSI_INTERACTIVE_TIMEOUT:-$MUSI_GATE_INTERACTIVE_TIMEOUT_DEFAULT}"
WARN_AFTER="${MUSI_INTERACTIVE_WARN_AFTER:-1080}"
case "$MODE" in
  changed)
    MARKER="${MUSI_VERIFY_MARKER_CHANGED:-$(musi_standard_verify_changed_marker "$REPO_ROOT")}"
    VERIFY_CONSUMER=verify_changed
    VERIFY_STEPS_ARRAY=MUSI_VERIFY_CHANGED_STEPS
    META_MODE=parallel-verify-changed
    ;;
  parallel)
    MARKER="${MUSI_VERIFY_MARKER_FULL:-$(musi_standard_verify_full_marker "$REPO_ROOT")}"
    VERIFY_CONSUMER=verify_parallel
    VERIFY_STEPS_ARRAY=MUSI_VERIFY_PARALLEL_STEPS
    META_MODE=parallel-verify
    ;;
  *)
    MARKER="${MUSI_VERIFY_MARKER_FULL:-$(musi_standard_verify_full_marker "$REPO_ROOT")}"
    VERIFY_CONSUMER=verify
    VERIFY_STEPS_ARRAY=MUSI_VERIFY_STEPS
    META_MODE=serial-verify
    ;;
esac

if [ "$MODE" = changed ]; then
  musi_changed_gate_fail_if_unstaged "$REPO_ROOT" "$LABEL" || exit $?
  if musi_resolve_changed_base main; then
    changed_input=$(mktemp "${TMPDIR:-/tmp}/musi-verify-changed-input.XXXXXX") || {
      printf '%s: failed to allocate changed-input selection state.\n' "$LABEL" >&2
      exit 2
    }
    if ! git diff -z --name-only --diff-filter=ACMRD "$MUSI_CHANGED_BASE"...HEAD > "$changed_input" \
       || ! git diff -z --name-only --diff-filter=ACMRD --cached >> "$changed_input"; then
      printf '%s: failed to inspect committed and staged changes.\n' "$LABEL" >&2
      rm -f "$changed_input"
      exit 2
    fi
    if [ ! -s "$changed_input" ]; then
      rm -f "$changed_input"
      printf '%s: no committed changes vs %s and no staged files — nothing to verify.\n' \
        "$LABEL" "$MUSI_CHANGED_BASE"
      printf '%s: stage intended work and rerun, or use `bun run verify` for an intentional full-tree verification.\n' \
        "$LABEL"
      exit 0
    fi
    rm -f "$changed_input"
  fi
fi

# The manual adapter owns mode selection and identity policy. The engine keeps
# the successful run snapshot for final metadata and marker stamping even if
# the worktree changes while slots are running.
musi_verify_manual_head() {
  git rev-parse HEAD 2>/dev/null || echo none
}

musi_verify_manual_fingerprint() {
  if [ "$MODE" = changed ]; then
    musi_require_fingerprint "$LABEL" ai_staged_fingerprint "$REPO_ROOT"
  else
    musi_require_fingerprint "$LABEL" ai_worktree_fingerprint "$REPO_ROOT"
  fi
}

musi_verify_manual_snapshot_head() {
  printf '%s\n' "$MUSI_VERIFY_GATE_RUN_HEAD"
}

musi_verify_manual_snapshot_fingerprint() {
  printf '%s\n' "$MUSI_VERIFY_GATE_RUN_FINGERPRINT"
}

musi_verify_manual_marker_hit() {
  printf '%s: already verified %ds ago at %s — skipping (set FORCE_VERIFY=1 to re-run).\n' \
    "$LABEL" "$MUSI_MARKER_MATCH_AGE" "$MUSI_VERIFY_GATE_CACHE_HEAD"
}

musi_verify_manual_marker_miss() {
  # FORCE_VERIFY is scoped to this invocation's marker decision. Verification
  # slots must not inherit it and change their own cache semantics.
  unset FORCE_VERIFY
}

musi_verify_manual_prepare_slots() {
  # shellcheck source=/dev/null
  . "$REPO_ROOT/scripts/verify/steps.generated.sh"
  # shellcheck source=/dev/null
  . "$REPO_ROOT/scripts/verify/steps-lib.sh"
}

musi_verify_manual_success_mode() {
  printf '%s\n' "$META_MODE"
}

EXECUTION_MODE=serial
case "$MODE" in
  changed|parallel) EXECUTION_MODE=parallel ;;
esac

# shellcheck disable=SC2034 # Passed by name to musi_verify_run_gate.
declare -A VERIFY_GATE_POLICY=(
  [label]="$LABEL"
  [banner_label]="$LABEL"
  [step_label]="$LABEL"
  [wrapper_command]="$WRAPPER_COMMAND"
  [repo_root]="$REPO_ROOT"
  [lock_mode]='blocking'
  [lock_path]="$LOCK"
  [lock_already_held]="${MUSI_VERIFY_LOCK_ALREADY_HELD:-0}"
  [commit_queue_mode]='none'
  [commit_queue_lock]=''
  [commit_queue_already_held]='0'
  [commit_queue_timeout]="$INTERACTIVE_TIMEOUT"
  [total_timeout]="$INTERACTIVE_TIMEOUT"
  [warn_after]="$WARN_AFTER"
  [marker_path]="$MARKER"
  [marker_freshness]="$MUSI_GATE_MARKER_FRESHNESS_SECONDS"
  [cache_head_provider]='musi_verify_manual_head'
  [cache_fingerprint_provider]='musi_verify_manual_fingerprint'
  [run_head_provider]='musi_verify_manual_head'
  [run_fingerprint_provider]='musi_verify_manual_fingerprint'
  [final_fingerprint_provider]='musi_verify_manual_snapshot_fingerprint'
  [marker_head_provider]='musi_verify_manual_snapshot_head'
  [execution_mode]="$EXECUTION_MODE"
  [consumer]="$VERIFY_CONSUMER"
  [steps_array]="$VERIFY_STEPS_ARRAY"
  [signal_mode]="$META_MODE"
  [failure_mode]="$META_MODE"
  [success_mode_provider]='musi_verify_manual_success_mode'
  [log_dir]="$LOG_DIR"
  [history_dir]="$HISTORY_DIR"
  [marker_hit_hook]='musi_verify_manual_marker_hit'
  [marker_miss_hook]='musi_verify_manual_marker_miss'
  [bridge_predicate]=''
  [prepare_slots_hook]='musi_verify_manual_prepare_slots'
  [after_slots_hook]=''
  [exit_hook]=''
)

musi_verify_run_gate VERIFY_GATE_POLICY
