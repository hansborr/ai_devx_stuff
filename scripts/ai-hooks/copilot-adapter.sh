#!/bin/bash

# Copilot CLI payload/response translation for the .copilot/hooks adapters.
# Source after common.sh.
#
# Copilot delivers camelCase hook payloads ({sessionId, timestamp, cwd,
# toolName, toolArgs, toolResult?}) where toolArgs is usually a JSON-encoded
# string, and it has no per-call tool id. Repo hook config emits native Copilot
# matchers, but adapters still filter by toolName because config can drift. The
# shared bodies in scripts/ai-hooks speak the tool_name/tool_input/tool_response
# dialect and emit Claude-shaped response JSON, so adapters normalize payloads
# on the way in and translate responses on the way out.
#
# Copilot preToolUse command hooks are fail-closed: a crash or non-zero exit
# denies the tool call. Dispatch therefore never exits non-zero; unparseable
# payloads and body failures translate to "no opinion" (empty output).

# Raw Copilot tool name ("bash", "create", "edit", "view", ...).
ai_copilot_payload_tool_name() {
  local payload="$1"
  printf '%s' "$payload" | jq -r '.toolName // empty' 2>/dev/null || true
}

# Copilot has no tool_use_id; derive a stable per-call correlation id from the
# session id plus the raw toolArgs so the pre and post hooks of one tool call
# key the same state file. Tools run sequentially within a session, so a rerun
# of the identical command reusing the key matches the pre/post pairing.
ai_copilot_tool_use_id() {
  local payload="$1"
  local sid key
  sid=$(printf '%s' "$payload" | jq -r '.sessionId // empty' 2>/dev/null) || sid=""
  [ -n "$sid" ] || return 0
  key=$(printf '%s' "$payload" \
    | jq -c '[(.toolName // ""), (.toolArgs | tostring)]' 2>/dev/null \
    | git hash-object --stdin 2>/dev/null) || key=""
  [ -n "$key" ] || return 0
  printf 'copilot-%s-%s' "$sid" "${key:0:16}"
}

# Normalize a Copilot payload to the shared tool_name/tool_input/tool_response
# dialect: bash|powershell -> Bash + tool_input.command, create -> Write and
# edit -> Edit + tool_input.file_path. Bash toolResult text carries the exit
# code as a trailing "<shellId: N completed with exit code M>" line; that is
# split into tool_response.exit_code with the marker stripped from stdout.
ai_copilot_normalized_payload() {
  local payload="$1"
  local tool_use_id="${2:-}"
  printf '%s' "$payload" | jq -c --arg tool_use_id "$tool_use_id" '
    def decode_args:
      (.toolArgs // {})
      | if type == "string" then (fromjson? // {})
        elif type == "object" then .
        else {}
        end;
    def shell_response($text):
      [$text | capture("<shellId: [0-9]+ completed with exit code (?<code>[0-9]+)>\\s*$")] as $m
      | {
          stdout: (
            if ($m | length) > 0
            then ($text | sub("\\n?<shellId: [0-9]+ completed with exit code [0-9]+>\\s*$"; ""))
            else $text
            end),
          exit_code: (if ($m | length) > 0 then ($m[0].code | tonumber) else null end)
        };
    (.toolName // "") as $tool
    | decode_args as $args
    | ($tool == "bash" or $tool == "powershell") as $is_shell
    | (.toolResult.textResultForLlm // "" | tostring) as $result_text
    | {
        session_id: (.sessionId // ""),
        cwd: (.cwd // ""),
        tool_use_id: $tool_use_id,
        tool_name: (
          if $is_shell then "Bash"
          elif $tool == "create" then "Write"
          elif $tool == "edit" then "Edit"
          else $tool
          end),
        tool_input: (
          if $is_shell then {command: ($args.command // "")}
          else {file_path: ($args.path // "")}
          end)
      }
    + (
        if has("toolResult")
        then {tool_response: (if $is_shell then shell_response($result_text) else {stdout: $result_text} end)}
        else {}
        end)
  ' 2>/dev/null || printf '{}'
}

# Claude-shaped response -> Copilot preToolUse output. Block/deny decisions
# become a permission denial. Copilot's public docs only describe preToolUse
# permission/argument control, but CLI 1.0.68 was live-tested forwarding
# additionalContext to the model on preToolUse. Recheck this on CLI upgrade.
# "continue" is no opinion.
ai_copilot_pre_response_json() {
  local response="$1"
  printf '%s' "$response" | jq -c '
    if type != "object" then empty
    elif ((.decision // "") == "block") or ((.decision // "") == "deny") then
      {permissionDecision: "deny",
       permissionDecisionReason: (.reason // "Denied by repository hook.")}
    elif ((.hookSpecificOutput.additionalContext // "") != "") then
      {additionalContext: .hookSpecificOutput.additionalContext}
    else empty
    end' 2>/dev/null || true
}

# Claude-shaped response -> Copilot postToolUse output for the Bash surface.
# PostToolUse block reasons are output-replacement summaries (commit results,
# bun run logs), so they map to modifiedResult; additionalContext appends.
ai_copilot_post_bash_response_json() {
  local response="$1"
  printf '%s' "$response" | jq -c '
    if type != "object" then empty
    elif ((.decision // "") == "block") and ((.reason // "") != "") then
      {modifiedResult: {resultType: "success", textResultForLlm: .reason}}
    elif ((.hookSpecificOutput.additionalContext // "") != "") then
      {additionalContext: .hookSpecificOutput.additionalContext}
    else empty
    end' 2>/dev/null || true
}

# Claude-shaped response -> Copilot postToolUse output for the edit surface.
# The edit already happened and its result text stays true, so both block
# reasons (e.g. prisma generate failures) and advisories append as context.
ai_copilot_post_edit_response_json() {
  local response="$1"
  printf '%s' "$response" | jq -c '
    if type != "object" then empty
    elif ((.decision // "") == "block") and ((.reason // "") != "") then
      {additionalContext: .reason}
    elif ((.hookSpecificOutput.additionalContext // "") != "") then
      {additionalContext: .hookSpecificOutput.additionalContext}
    else empty
    end' 2>/dev/null || true
}

# Read a Copilot payload from stdin, filter by tool surface, normalize, run
# the shared body, and translate its response for the event. Usage:
#   ai_copilot_dispatch pre|post-bash|post-edit bash|edit <body-path>
# Exits 0 in every case; a body crash or unmatched tool emits nothing.
ai_copilot_dispatch() {
  local mode="$1"
  local surface="$2"
  local body="$3"
  local payload tool tool_use_id normalized response

  payload=$(ai_read_payload)
  tool=$(ai_copilot_payload_tool_name "$payload")
  case "$surface" in
    bash)
      case "$tool" in
        bash | powershell) ;;
        *) exit 0 ;;
      esac
      ;;
    edit)
      case "$tool" in
        create | edit) ;;
        *) exit 0 ;;
      esac
      ;;
    *)
      exit 0
      ;;
  esac

  tool_use_id=$(ai_copilot_tool_use_id "$payload") || tool_use_id=""
  normalized=$(ai_copilot_normalized_payload "$payload" "$tool_use_id")
  response=$(printf '%s' "$normalized" | bash "$body") || response=""

  case "$mode" in
    pre) ai_copilot_pre_response_json "$response" ;;
    post-bash) ai_copilot_post_bash_response_json "$response" ;;
    post-edit) ai_copilot_post_edit_response_json "$response" ;;
  esac
  exit 0
}
