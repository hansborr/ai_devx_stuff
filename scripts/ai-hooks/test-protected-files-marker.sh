#!/bin/bash

# Focused ai-hooks shell tests for the protected-files allow-marker family, plus
# the parallel-run regression that keeps the ai-hooks suite safe to run
# concurrently with itself. Extracted from scripts/ai-hooks/test.sh so this
# behavior family can be run on its own
# (`bash scripts/ai-hooks/test-protected-files-marker.sh`); the aggregate runner
# invokes it as one step. Shares the generic assertions in test-support.sh.
#
# Why the indirection: `.allow-protected-edits` is a single repo-wide path, so a
# fixture that created it under the checkout's own root raced every concurrent
# instance of this suite (and deleted a maintainer's real marker on the way in).
# Every fixture here instead evaluates real policy against a private probe root
# under $TMP_ROOT. That works because REPO_ROOT is an honored override in
# policy.sh (`ai_policy_resolve_bash_path`) and protected-files.sh
# (`ai_protected_files_allow_marker_path`), and because the deny table matches
# by suffix glob — so a probe-root path exercises the same real policy entries.
#
# Production semantics are unaffected and are asserted below: the shipped
# entrypoints (.claude/.codex/.copilot adapters) each recompute REPO_ROOT from
# git before the shared body runs, so an inherited REPO_ROOT cannot retarget a
# real hook invocation.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=../tests/lib/test-git-env.sh
. "$SCRIPT_DIR/../tests/lib/test-git-env.sh"
musi_clear_inherited_git_hook_env
musi_exit_after_git_hook_env_assertion_if_requested
REPO_ROOT=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)

TMP_ROOT=$(mktemp -d /tmp/musi-ai-hooks-protected-marker-test.XXXXXX)
trap 'rm -rf "$TMP_ROOT"' EXIT

# shellcheck source=test-support.sh
. "$SCRIPT_DIR/test-support.sh"
# shellcheck source=common.sh
. "$SCRIPT_DIR/common.sh"
# shellcheck source=policy.sh
. "$SCRIPT_DIR/policy.sh"
# shellcheck source=protected-files.sh
. "$SCRIPT_DIR/protected-files.sh"

REPO_ALLOW_MARKER="$REPO_ROOT/.allow-protected-edits"
REPO_MARKER_AT_START=absent
if [ -e "$REPO_ALLOW_MARKER" ]; then
  REPO_MARKER_AT_START=present
fi

# Policy evaluated in a clean child shell (no test-suite functions in scope), so
# a missing `ai_policy_load_protected_files` source would surface as
# "command not found" rather than a silently skipped check. REPO_ROOT is
# exported to the child, which is what points the whole sourced chain at the
# private probe root.
policy_only_probe() {
  local probe_root="$1"
  local cmd="$2"
  local out_file="$3"
  local err_file="$4"

  REPO_ROOT="$probe_root" bash -c '
    set -u
    script_dir=$1
    cmd=$2
    . "$script_dir/common.sh"
    . "$script_dir/policy.sh"
    reason=$(ai_policy_violation_reason "$cmd" || true)
    advisory=$(ai_policy_advisory_context "$cmd" || true)
    printf "reason=%s\n" "$reason"
    printf "advisory=%s\n" "$advisory"
  ' bash "$SCRIPT_DIR" "$cmd" >"$out_file" 2>"$err_file"
}

# The Edit/Write hook body itself, run against a probe root. The shipped
# adapters deliberately cannot be retargeted this way (asserted further down),
# so marker-dependent coverage of the body goes straight at the body.
protected_files_body_out() {
  local probe_root="$1"
  local path="$2"
  local session="$3"
  local state_root="$4"

  jq -n --arg path "$path" --arg session "$session" \
    '{session_id:$session,tool_input:{file_path:$path}}' \
    | AI_STATE_ROOT="$state_root" \
      AI_PROTECTED_FILES_THROTTLE_TTL=0 \
      AI_FAKE_NOW=100000 \
      REPO_ROOT="$probe_root" \
      bash "$SCRIPT_DIR/protected-files.sh"
}

assert_line_present() {
  local text="$1"
  local line="$2"
  local label="$3"

  printf '%s\n' "$text" | grep -qxF -- "$line" \
    || fail "$label: expected a bare [$line] line in [$text]"
}

# One complete pass over the marker-dependent protected-files policy. Everything
# it reads and writes lives under $work_dir, so N copies can run at once.
run_marker_fixture() {
  local work_dir="$1"
  local probe_root="$work_dir/probe-root"
  local marker="$probe_root/.allow-protected-edits"
  local out_file="$work_dir/policy-only.out"
  local err_file="$work_dir/policy-only.err"
  local write_cmd="printf '%s\n' x > lint-ratchet.baseline.json"
  local bash_cmd="printf '%s\n' x > bun.lock"
  local text stderr_text reason context hook_out hook_context

  mkdir -p "$probe_root" "$work_dir/state"

  # Marker absent: a protected write is a hard deny.
  policy_only_probe "$probe_root" "$write_cmd" "$out_file" "$err_file"
  text=$(<"$out_file")
  stderr_text=$(<"$err_file")
  assert_not_contains "$stderr_text" "command not found"
  assert_contains "$text" "reason=protected-files: Protected file"
  assert_contains "$text" "advisory="

  # Marker present: the same write downgrades to a repo-wide-override advisory.
  touch "$marker"
  policy_only_probe "$probe_root" "$write_cmd" "$out_file" "$err_file"
  rm -f "$marker"
  text=$(<"$out_file")
  stderr_text=$(<"$err_file")
  assert_not_contains "$stderr_text" "command not found"
  assert_line_present "$text" "reason=" "marker-active policy probe"
  assert_contains "$text" "advisory=protected-files: Repo-wide"
  assert_contains "$text" "would have been denied for $probe_root/lint-ratchet.baseline.json"

  # Same downgrade through the in-process Bash policy surface and through the
  # Edit/Write hook body.
  touch "$marker"
  reason=$(REPO_ROOT="$probe_root" ai_policy_violation_reason "$bash_cmd" || true)
  context=$(REPO_ROOT="$probe_root" ai_policy_advisory_context "$bash_cmd" || true)
  hook_out=$(protected_files_body_out \
    "$probe_root" "$probe_root/bun.lock" "protected-files-marker" "$work_dir/state")
  rm -f "$marker"

  [ -z "$reason" ] \
    || fail "protected-files Bash marker should downgrade deny to advisory: $reason"
  assert_contains "$context" ".allow-protected-edits"
  assert_contains "$context" "would have been denied for $probe_root/bun.lock"
  assert_hook_json "$hook_out"
  [ "$(jq -r '.decision // empty' <<< "$hook_out")" = "" ] \
    || fail "protected-files marker should downgrade deny to advisory: $hook_out"
  hook_context=$(jq -r '.hookSpecificOutput.additionalContext // empty' <<< "$hook_out")
  assert_contains "$hook_context" ".allow-protected-edits"
  assert_contains "$hook_context" "Repo-wide"
  assert_contains "$hook_context" "would have been denied for $probe_root/bun.lock"
  assert_contains "$hook_context" "Remove the marker"

  # Marker removed again: the hook body is back to denying.
  hook_out=$(protected_files_body_out \
    "$probe_root" "$probe_root/bun.lock" "protected-files-cleared" "$work_dir/state")
  assert_hook_json "$hook_out"
  [ "$(jq -r '.decision // empty' <<< "$hook_out")" = "deny" ] \
    || fail "protected-files should deny again once the marker is gone: $hook_out"
}

run_marker_fixture "$TMP_ROOT/serial"

# --- production-semantics guard ----------------------------------------------
# The shipped adapters compute REPO_ROOT from git themselves before exec'ing the
# shared body, so the override the fixtures above rely on cannot retarget a real
# hook invocation: an inherited REPO_ROOT must be ignored. Only checkable when
# the checkout has no real marker of its own.
if [ "$REPO_MARKER_AT_START" = "absent" ]; then
  ADAPTER_PROBE_ROOT="$TMP_ROOT/adapter-probe-root"
  mkdir -p "$ADAPTER_PROBE_ROOT"
  touch "$ADAPTER_PROBE_ROOT/.allow-protected-edits"
  # Resolved against the real checkout up front: the REPO_ROOT below is the
  # decoy handed to the forked adapter, and must not reach these.
  ADAPTER_TARGET="$REPO_ROOT/bun.lock"
  ADAPTER_PROJECT_DIR="$REPO_ROOT"
  for adapter in .claude/hooks/protected-files.sh .codex/hooks/protected-files.sh; do
    ADAPTER_PATH="$REPO_ROOT/$adapter"
    ADAPTER_OUT=$(
      jq -n --arg path "$ADAPTER_TARGET" \
        '{session_id:"protected-files-adapter-root",tool_input:{file_path:$path}}' \
        | AI_STATE_ROOT="$TMP_ROOT/adapter-state" \
          AI_PROTECTED_FILES_THROTTLE_TTL=0 \
          AI_FAKE_NOW=100000 \
          CLAUDE_PROJECT_DIR="$ADAPTER_PROJECT_DIR" \
          REPO_ROOT="$ADAPTER_PROBE_ROOT" \
          bash "$ADAPTER_PATH"
    )
    assert_hook_json "$ADAPTER_OUT"
    [ "$(jq -r '.decision // empty' <<< "$ADAPTER_OUT")" = "deny" ] \
      || fail "$adapter must ignore an inherited REPO_ROOT and read the real checkout: $ADAPTER_OUT"
  done

  # Copilot needs its own probe rather than a row in the loop above: its adapter
  # normalizes a camelCase payload dialect on the way in and renders a deny as
  # permissionDecision/permissionDecisionReason on the way out.
  COPILOT_ADAPTER_PATH="$REPO_ROOT/.copilot/hooks/protected-files.sh"
  COPILOT_ADAPTER_OUT=$(
    jq -n --arg path "$ADAPTER_TARGET" \
      '{sessionId:"protected-files-adapter-root", timestamp:1, cwd:"/",
        toolName:"edit",
        toolArgs:({path:$path, old_str:"a", new_str:"b"} | tojson)}' \
      | AI_STATE_ROOT="$TMP_ROOT/adapter-state-copilot" \
        AI_PROTECTED_FILES_THROTTLE_TTL=0 \
        AI_FAKE_NOW=100000 \
        CLAUDE_PROJECT_DIR="$ADAPTER_PROJECT_DIR" \
        REPO_ROOT="$ADAPTER_PROBE_ROOT" \
        bash "$COPILOT_ADAPTER_PATH"
  )
  assert_hook_json "$COPILOT_ADAPTER_OUT"
  [ "$(jq -r '.permissionDecision // empty' <<< "$COPILOT_ADAPTER_OUT")" = "deny" ] \
    || fail ".copilot/hooks/protected-files.sh must ignore an inherited REPO_ROOT and read the real checkout: $COPILOT_ADAPTER_OUT"

  # The Bash surface reaches the same scanners transitively. no-direct-db.sh
  # never assigns the global REPO_ROOT itself, so this is the only check that
  # proves its shipped adapter closes the override before policy runs. A leaked
  # decoy root would find the probe marker and downgrade the deny to an advisory.
  NO_DIRECT_DB_ADAPTER_PATH="$REPO_ROOT/.claude/hooks/no-direct-db.sh"
  NO_DIRECT_DB_ADAPTER_OUT=$(
    jq -n --arg cmd "printf '%s\n' x > $ADAPTER_PROJECT_DIR/bun.lock" \
      '{tool_input:{command:$cmd}}' \
      | CLAUDE_PROJECT_DIR="$ADAPTER_PROJECT_DIR" \
        REPO_ROOT="$ADAPTER_PROBE_ROOT" \
        bash "$NO_DIRECT_DB_ADAPTER_PATH"
  )
  assert_hook_json "$NO_DIRECT_DB_ADAPTER_OUT"
  [ "$(jq -r '.decision // empty' <<< "$NO_DIRECT_DB_ADAPTER_OUT")" = "block" ] \
    || fail ".claude/hooks/no-direct-db.sh must ignore an inherited REPO_ROOT for protected-file policy: $NO_DIRECT_DB_ADAPTER_OUT"
  NO_DIRECT_DB_ADAPTER_REASON=$(jq -r '.reason // empty' <<< "$NO_DIRECT_DB_ADAPTER_OUT")
  assert_contains "$NO_DIRECT_DB_ADAPTER_REASON" "protected-files:"
  # A leaked decoy root would find the probe marker and emit the repo-wide
  # override advisory instead of a hard deny.
  assert_not_contains "$NO_DIRECT_DB_ADAPTER_REASON" "Repo-wide"

  rm -f "$ADAPTER_PROBE_ROOT/.allow-protected-edits"
fi

# The structural reason the override is unreachable in production: every shipped
# entrypoint that reaches the protected-files scanners assigns REPO_ROOT
# unconditionally from git first. Both scanners read the override form
# (`policy.sh` -> `${REPO_ROOT:-$(ai_repo_root)}`, `protected-files.sh` ->
# `REPO_ROOT="${REPO_ROOT:-...}"`), so an inherited value survives unless an
# entrypoint overwrites it. If a generated adapter ever switched to the
# `${REPO_ROOT:-...}` default form, a stray environment value could retarget a
# real hook invocation, so pin the unconditional shape here.
#
# The Edit/Write surface is only half of it. The Bash surface reaches the same
# scanners transitively and must be pinned too:
#   * scripts/ai-hooks/no-direct-db.sh calls ai_policy_decision and
#     ai_policy_advisory_context directly, but deliberately keeps its own root
#     in HOOK_REPO_ROOT and never assigns the global REPO_ROOT — so its safety
#     rests entirely on .claude/hooks/no-direct-db.sh recomputing it first.
#   * git-commit-quiet.sh reaches them through ai_preflight_or_block ->
#     ai_policy_decision -> ai_policy_bash_protected_file_violation_reason.
# bash-post-tool-use.sh never invokes the scanners; it stays listed because it
# is a shipped entrypoint whose REPO_ROOT shape should not silently drift.
for entrypoint in \
  .claude/hooks/protected-files.sh \
  .codex/hooks/protected-files.sh \
  .copilot/hooks/protected-files.sh \
  .claude/hooks/no-direct-db.sh \
  .claude/hooks/git-commit-quiet.sh \
  scripts/ai-hooks/git-commit-quiet.sh \
  scripts/ai-hooks/bash-pre-tool-use.sh \
  scripts/ai-hooks/bash-post-tool-use.sh; do
  grep -qE '^REPO_ROOT=\$\(git ' "$REPO_ROOT/$entrypoint" \
    || fail "$entrypoint must assign REPO_ROOT unconditionally from git before the protected-files scanners run"
done

# no-direct-db.sh is the one transitive consumer that must NOT assign the global
# REPO_ROOT (it keeps HOOK_REPO_ROOT so the path resolver's cwd-based behavior is
# untouched). Pin that too: if it ever grows an unconditional REPO_ROOT
# assignment, the comment above and the adapter guarantee stop matching reality.
if grep -qE '^REPO_ROOT=' "$REPO_ROOT/scripts/ai-hooks/no-direct-db.sh"; then
  fail "scripts/ai-hooks/no-direct-db.sh must keep its root in HOOK_REPO_ROOT, not the global REPO_ROOT"
fi

# --- parallel-run regression --------------------------------------------------
# The reason this file exists. Concurrent instances of the marker fixture must
# all pass, and none may create, move, or delete the checkout's repo-wide marker
# — that shared path is what made the ai-hooks suite unable to run beside itself.
PARALLEL_INSTANCES=4

# Static tripwire: no ai-hooks test fixture may build the allow-marker path from
# the checkout's own root. Production code (protected-files.sh) still may, and
# must; test fixtures must use a private probe root instead.
#
# This file necessarily NAMES that path — it is the file asserting nothing else
# touched it — but it gets an exact-line whitelist, not a blanket exemption. A
# whole-file exemption left the one fixture most able to create the shared
# marker completely uncovered, which is precisely what this tripwire exists to
# prevent. The pattern also tolerates a closing quote between the root variable
# and the path segment, so that alternate construction cannot slip past.
#
# The whitelisted line is assembled rather than written literally: spelled out,
# this declaration would be a second unwhitelisted occurrence of the very
# pattern it describes.
SELF_PATH="$SCRIPT_DIR/test-protected-files-marker.sh"
SELF_ALLOWED_MARKER_LINE=$(printf 'REPO_ALLOW_MARKER="$%s/.allow-protected-edits"' REPO_ROOT)
SHARED_MARKER_USES=""
while IFS= read -r marker_hit; do
  [ -n "$marker_hit" ] || continue
  marker_file=${marker_hit%%:*}
  marker_rest=${marker_hit#*:}
  marker_text=${marker_rest#*:}
  marker_text=${marker_text#"${marker_text%%[![:space:]]*}"}
  if [ "$marker_file" = "$SELF_PATH" ] \
    && [ "$marker_text" = "$SELF_ALLOWED_MARKER_LINE" ]; then
    continue
  fi
  SHARED_MARKER_USES="${SHARED_MARKER_USES}${marker_hit}"$'\n'
done < <(grep -n 'REPO_ROOT"\?/\.allow-protected-edits' "$SCRIPT_DIR"/test*.sh || true)
[ -z "$SHARED_MARKER_USES" ] \
  || fail "ai-hooks fixtures must not use the repo-root allow marker (races concurrent suite instances): $SHARED_MARKER_USES"

# Second tripwire, covering the variable rather than the literal path: no test
# file — this one included — may CREATE, copy, move, link, truncate, redirect
# into, or delete the shared marker. Reads (`[ -e "$REPO_ALLOW_MARKER" ]`) and
# naming it in a failure message stay allowed. The watcher below can only sample
# the filesystem, so a write created and removed between two samples would slip
# through; this static check is the sound half of that pair.
SHARED_MARKER_WRITES=$(
  grep -nE '(^|[[:space:];&|(])(touch|rm|mv|cp|ln|install|tee|truncate)([[:space:]]+-[^[:space:]]+)*[[:space:]][^|;&]*\$\{?REPO_ALLOW_MARKER|>>?[[:space:]]*"?\$\{?REPO_ALLOW_MARKER' \
    "$SCRIPT_DIR"/test*.sh || true
)
[ -z "$SHARED_MARKER_WRITES" ] \
  || fail "ai-hooks fixtures must never write or remove the repo-wide allow marker: $SHARED_MARKER_WRITES"

REPO_MARKER_SIGHTINGS="$TMP_ROOT/repo-marker-sightings"
: > "$REPO_MARKER_SIGHTINGS"
if [ "$REPO_MARKER_AT_START" = "absent" ]; then
  (
    while :; do
      if [ -e "$REPO_ALLOW_MARKER" ]; then
        printf 'observed\n' >> "$REPO_MARKER_SIGHTINGS"
      fi
      sleep 0.02
    done
  ) &
  WATCHER_PID=$!
else
  WATCHER_PID=""
fi

PARALLEL_PIDS=()
for instance in $(seq 1 "$PARALLEL_INSTANCES"); do
  run_marker_fixture "$TMP_ROOT/parallel-$instance" &
  PARALLEL_PIDS+=("$!")
done

PARALLEL_STATUS=0
for pid in "${PARALLEL_PIDS[@]}"; do
  wait "$pid" || PARALLEL_STATUS=1
done

if [ -n "$WATCHER_PID" ]; then
  kill "$WATCHER_PID" 2>/dev/null || true
  wait "$WATCHER_PID" 2>/dev/null || true
fi

[ "$PARALLEL_STATUS" -eq 0 ] \
  || fail "$PARALLEL_INSTANCES concurrent protected-files marker fixtures must all pass; the suite is racing itself again"

if [ "$REPO_MARKER_AT_START" = "absent" ]; then
  [ ! -s "$REPO_MARKER_SIGHTINGS" ] \
    || fail "a fixture created the repo-wide allow marker at $REPO_ALLOW_MARKER during the parallel run"
fi

REPO_MARKER_AT_END=absent
if [ -e "$REPO_ALLOW_MARKER" ]; then
  REPO_MARKER_AT_END=present
fi
[ "$REPO_MARKER_AT_END" = "$REPO_MARKER_AT_START" ] \
  || fail "the suite changed the checkout's allow marker ($REPO_MARKER_AT_START -> $REPO_MARKER_AT_END); fixtures must leave it alone"

printf 'ai-hooks protected-files marker tests passed\n'
