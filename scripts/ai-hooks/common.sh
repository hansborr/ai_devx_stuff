#!/bin/bash

# Shared helpers for agent hook adapters. Keep this file free of Claude- or
# Codex-specific control flow.

ai_repo_root() {
  git rev-parse --show-toplevel 2>/dev/null || echo /workspace
}

ai_read_payload() {
  cat 2>/dev/null || true
}

ai_payload_command() {
  local payload="$1"
  printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null || true
}

ai_payload_tool_use_id() {
  local payload="$1"
  printf '%s' "$payload" | jq -r '.tool_use_id // empty' 2>/dev/null || true
}

ai_payload_session_id() {
  local payload="$1"
  printf '%s' "$payload" | jq -r '.session_id // .sessionId // empty' 2>/dev/null || true
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

ai_claude_updated_command() {
  local command="$1"
  jq -n --arg command "$command" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      updatedInput: { command: $command }
    }
  }'
  exit 0
}

# Default prefix for ai_claude_result_command temps (git-commit-quiet). mktemp
# appends `.XXXXXX`; the rewritten tool command self-cleans on success, and
# ai_cache_sweep_stale (via ai_cache_init) reaps any abandoned when the tool
# call is denied or never runs. Other callers pass their own prefixes
# (/tmp/musi-bun-result, /tmp/musi-policy-guidance); the sweep covers all three.
AI_RESULT_COMMAND_TMP_PREFIX="${AI_RESULT_COMMAND_TMP_PREFIX:-/tmp/musi-commit-result}"

ai_claude_result_command() {
  local message="$1"
  local prefix="${2:-$AI_RESULT_COMMAND_TMP_PREFIX}"
  local result_file quoted

  result_file=$(mktemp "$prefix.XXXXXX")
  printf '%s\n' "$message" > "$result_file"
  # Real shell escaping (printf %q), not bare double quotes: the rewritten
  # command is re-parsed by the shell when the tool runs, and double quotes
  # still expand $()/backticks and let an embedded " break out. Today's prefixes
  # are metachar-free, so this is defense-in-depth against a future caller.
  printf -v quoted '%q' "$result_file"
  ai_claude_updated_command "cat $quoted; rm -f $quoted"
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
          $r.exit_code,
          $r.exitCode,
          $r.return_code,
          $r.returncode,
          $r.exit_status,
          $r.statusCode,
          $r.metadata.exit_code,
          $r.metadata.exitCode,
          $r.metadata.return_code,
          $r.metadata.returncode,
          $r.metadata.exit_status,
          $r.metadata.statusCode,
          $r.status,
          $r.code
        ] | map(to_exit_code) | map(select(. != null)) | .[0] // null),
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

ai_bun_exit_code_from_output() {
  local script="$1"
  local output="$2"

  printf '%s\n' "$output" | awk -v script="$script" '
    index($0, "error: script \"" script "\" exited with code ") == 1 {
      print $NF
    }
    /Process exited with code [0-9]+/ {
      print $NF
    }
  ' | tail -n 1
}

ai_bun_output_has_error_footer() {
  local script="$1"
  local output="$2"

  printf '%s\n' "$output" | awk -v script="$script" '
    index($0, "error: script \"" script "\"") == 1 { found=1 }
    END { exit found ? 0 : 1 }
  '
}
