#!/bin/bash

# Shared helpers for agent hook adapters. Keep this file free of Claude- or
# Codex-specific control flow.
#
# What belongs here: the vendor payload boundary — reading a tool payload and
# its response blob into a neutral shape — the response emissions every adapter
# uses, and small primitives no other file owns. Parsing one specific tool's
# text does not: bun output reading lives in cache.sh, git command
# classification in git-classify.sh, command policy in policy.sh.
#
# This file must stay standalone-sourceable, so it sources no sibling and grows
# no facade line. Hand-maintained fixture copy sets drop it into fake repos with
# only the siblings that fixture needs and never policy.sh or its modules: four
# sets in the ai-hooks corpus (test-tidy.sh twice, test-lint-coverage.sh,
# test-ratchet-regression.sh) and a fifth outside it in
# scripts/tests/test-verify.sh, which a corpus-only sweep would miss. The git
# and bun helpers that left went to files their callers already source —
# git-classify.sh through policy.sh, cache.sh directly. The Claude response
# emitters are the exception: claude-adapter.sh is a new file, so all four of
# its callers gained a source line — but none of those callers is in a copy set,
# so no fixture had to grow one.

# BEGIN PORTING KNOBS — repo-specific shell defaults live together here.
# porting-knob: repo-root-fallback -- retarget the default checkout root
AI_REPO_ROOT_FALLBACK="/workspace"
# porting-knob: hook-state-paths -- retarget Musi-named state and result paths
AI_STATE_ROOT_PREFIX="/tmp/musi-ai-hooks"
AI_RESULT_COMMAND_TMP_PREFIX="${AI_RESULT_COMMAND_TMP_PREFIX:-/tmp/musi-commit-result}"
# Consumed by sourced hook bodies and cache.sh.
# shellcheck disable=SC2034
AI_BUN_RESULT_TMP_PREFIX="/tmp/musi-bun-result"
# Consumed by sourced hook bodies and cache.sh.
# shellcheck disable=SC2034
AI_POLICY_GUIDANCE_TMP_PREFIX="/tmp/musi-policy-guidance"
# Consumed by stop-policy.sh after common.sh is sourced.
# shellcheck disable=SC2034
AI_STOP_ASYNC_STATE_ROOT="${MUSI_VERIFY_ASYNC_STATE_ROOT:-/tmp/musi-verify-async}"
# Consumed by cache.sh after common.sh is sourced.
# shellcheck disable=SC2034
AI_STATE_SWEEP_STOP_GLOB_DEFAULT="$AI_STATE_ROOT_PREFIX.*/stop"
# porting-knob: environment-prefixes -- globally rename MUSI_* and AI_* when porting
# END PORTING KNOBS

ai_repo_root() {
  git rev-parse --show-toplevel 2>/dev/null || echo "$AI_REPO_ROOT_FALLBACK"
}

ai_read_payload() {
  cat 2>/dev/null || true
}

ai_payload_command() {
  local payload="$1"
  printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null || true
}

# The invocation cwd the harness reports alongside the command. A session parked
# at /workspace but committing in a linked worktree via `cd <wt> && git commit`
# still reports /workspace here — the command's leading forms (below) resolve
# that shape; this is the fallback for a bare `git commit` run from the worktree.
ai_payload_cwd() {
  local payload="$1"
  printf '%s' "$payload" | jq -r '.cwd // empty' 2>/dev/null || true
}

ai_payload_tool_use_id() {
  local payload="$1"
  printf '%s' "$payload" | jq -r '.tool_use_id // empty' 2>/dev/null || true
}

ai_payload_session_id() {
  local payload="$1"
  printf '%s' "$payload" | jq -r '.session_id // .sessionId // empty' 2>/dev/null || true
}

# The finishing subagent's unique id on a SubagentStop payload (distinct from the
# parent session id). Empty when absent (e.g. a non-subagent caller).
ai_payload_agent_id() {
  local payload="$1"
  printf '%s' "$payload" | jq -r '.agent_id // .agentId // empty' 2>/dev/null || true
}

# Per-agent scope key for the SubagentStop Stop policy, mirroring
# ai_throttle_key's session+identity material. Folds in the subagent's agent_id
# and session id so a finishing subagent's one-shot Stop markers never collide
# with the main loop's repo-only key. Prints empty when the payload carries
# neither id; the stop-policy helpers then fall back to today's repo-only keying.
ai_subagent_stop_scope() {
  local payload="$1"
  local session_id agent_id scope=""

  session_id=$(ai_payload_session_id "$payload")
  agent_id=$(ai_payload_agent_id "$payload")

  [ -n "$session_id" ] && scope="session:${session_id}"
  if [ -n "$agent_id" ]; then
    [ -n "$scope" ] && scope="${scope}:"
    scope="${scope}agent:${agent_id}"
  fi

  printf '%s' "$scope"
}

ai_payload_file_path() {
  local payload="$1"
  printf '%s' "$payload" | jq -r '.tool_input.file_path // empty' 2>/dev/null || true
}

ai_payload_background() {
  local payload="$1"
  printf '%s' "$payload" | jq -r '.tool_input.run_in_background // false' 2>/dev/null || true
}

# Current epoch seconds, overridable via AI_FAKE_NOW so throttle state machines
# stay deterministic under test.
ai_now() {
  printf '%s' "${AI_FAKE_NOW:-$(date +%s)}"
}

ai_emit_continue() {
  echo '{"continue":true}'
  exit 0
}

ai_emit_block() {
  jq -Rn --arg r "$1" '{decision:"block", reason:$r}'
  exit 0
}

ai_emit_additional_context() {
  local event_name="$1"
  local message="$2"
  jq -n --arg event "$event_name" --arg msg "$message" \
    '{hookSpecificOutput:{hookEventName:$event,additionalContext:$msg}}'
  exit 0
}

ai_emit_deny() {
  jq -Rn --arg r "$1" '{decision:"deny", reason:$r}'
  exit 0
}

ai_is_integer() {
  [[ "${1:-}" =~ ^-?[0-9]+$ ]]
}

ai_clamp_timeout_below_harness() {
  local label="$1"
  local requested="$2"
  local hook_timeout="$3"
  local margin="$4"
  local max_timeout

  max_timeout=$((hook_timeout - margin))
  if ai_is_integer "$requested" && [ "$requested" -gt "$max_timeout" ]; then
    printf '%s: clamped timeout from %ss to %ss to stay %ss below generated hook timeout %ss\n' \
      "$label" "$requested" "$max_timeout" "$margin" "$hook_timeout" >&2
    printf '%s\n' "$max_timeout"
    return 0
  fi

  printf '%s\n' "$requested"
}

ai_read_state_value() {
  local file="$1"
  local key="$2"

  [ -f "$file" ] || return 1
  while IFS='=' read -r k v; do
    if [ "$k" = "$key" ]; then
      printf '%s' "$v"
      return 0
    fi
  done < "$file"

  return 1
}

ai_limit_lines() {
  local text="$1"
  local max_lines="${2:-80}"
  local suffix="${3:-... truncated. Read the referenced log files for complete output.}"
  local line_count

  line_count=$(printf '%s\n' "$text" | wc -l)
  if [ "$line_count" -gt "$max_lines" ]; then
    printf '%s\n\n%s\n' "$(printf '%s\n' "$text" | head -n "$max_lines")" "${suffix/\{lines\}/$line_count}"
  else
    printf '%s' "$text"
  fi
}

# Normalize a vendor `tool_response` blob into {exit_code, stdout, stderr, raw}
# for bash-post-tool-use.sh, whose only use of exit_code is failure detection.
#
# Exactly two live entry paths reach the sole consumer, and only one of them has
# an in-repo producer:
#   - Codex execs bash-post-tool-use.sh directly (.codex/hooks/post-tool-use.sh)
#     and hands it a raw vendor `tool_response` — external, unversioned, and not
#     modelled anywhere in this repo.
#   - Copilot's payload is normalized first by ai_copilot_normalized_payload
#     (copilot-adapter.sh), the one dialect generated here and therefore the one
#     that can be named exactly: {stdout, exit_code}.
# Claude Code deliberately does not route through this aggregate at all; see the
# bash-post-tool-use.sh header and the notes.claude entries on
# hook/ai-codex-post-tool-use and hook/ai-copilot-post-tool-use in
# harness.controls.json.
#
# Every other spelling accepted below is unattributed defensive compatibility.
# Nothing in the tree records which external vendor emits which key, so do not
# attribute one — a comment that guesses would make deletion look safe. And do
# not retire an alias: scripts/ai-hooks/test.sh pins every accepted spelling, so
# test coverage is evidence about this normalizer, never about a producer. This
# is a boundary the repo does not own and the consumer is failure detection;
# dropping a spelling trades a documentation gap for a silent detection gap the
# moment a vendor reverts to an older shape.
#
# The exit-code list is grouped by shape rather than by vendor: six top-level
# spellings, the same six under metadata.*, then the two generic fallbacks last
# precisely because `status` and `code` are not exit-code-specific names.
ai_response_json_from_payload() {
  local payload="$1"
  printf '%s' "$payload" | jq -c '
    def to_text:
      if . == null then ""
      elif type == "string" then .
      else tostring
      end;
    def decode:
      if . == null then {}
      elif type == "object" then .
      elif type == "string" then (fromjson? // {"raw": .})
      else {"raw": tostring}
      end;
    def to_exit_code:
      if . == null then null
      elif type == "number" then .
      elif type == "string" and test("^-?[0-9]+$") then tonumber
      else null
      end;
    (.tool_response | decode) as $r
    | {
        exit_code: ([
          # Top-level spellings. Only the first has a known in-repo producer
          # (ai_copilot_normalized_payload); the rest are unattributed.
          $r.exit_code,
          $r.exitCode,
          $r.return_code,
          $r.returncode,
          $r.exit_status,
          $r.statusCode,
          # The same six, nested under metadata.
          $r.metadata.exit_code,
          $r.metadata.exitCode,
          $r.metadata.return_code,
          $r.metadata.returncode,
          $r.metadata.exit_status,
          $r.metadata.statusCode,
          # Generic fallbacks, last: these names are not exit-code-specific, so
          # any of the above wins over them.
          $r.status,
          $r.code
        ] | map(to_exit_code) | map(select(. != null)) | .[0] // null),
        # `stdout` is the Copilot-adapter spelling; `out`/`output` are unattributed.
        stdout: ($r.stdout // $r.out // $r.output // "" | to_text),
        stderr: ($r.stderr // $r.err // "" | to_text),
        raw: (
          if ($r | type) == "object"
             and ($r | has("stdout") or has("stderr") or has("out") or has("err") or has("output") or has("raw") or has("text") or has("exit_code") or has("exitCode") or has("return_code") or has("returncode") or has("exit_status") or has("statusCode") or has("metadata") or has("status") or has("code"))
          then ($r.raw // $r.text // "" | to_text)
          else ($r | to_text)
          end
        )
      }' 2>/dev/null || printf '{}'
}

ai_combined_response_text() {
  local response="$1"
  local stdout stderr raw combined

  stdout=$(printf '%s' "$response" | jq -r '.stdout // empty' 2>/dev/null || true)
  stderr=$(printf '%s' "$response" | jq -r '.stderr // empty' 2>/dev/null || true)
  raw=$(printf '%s' "$response" | jq -r '.raw // empty' 2>/dev/null || true)

  combined="$raw"
  if [ -n "$stdout" ] || [ -n "$stderr" ]; then
    combined="$stdout"
    if [ -n "$stderr" ]; then
      if [ -n "$combined" ]; then
        combined="${combined}"$'\n'"$stderr"
      else
        combined="$stderr"
      fi
    fi
  fi

  printf '%s' "$combined"
}
