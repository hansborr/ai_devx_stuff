#!/bin/bash

# PostToolUseFailure advisory guidance for known, documented Bash failures.
# Keep this table small and evidence-backed; unknown failures stay silent.

set -u

AI_HOOKS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "$AI_HOOKS_DIR/common.sh"

AI_FAILURE_FLAKY_DOC_REL="docs/agent_notes/observed_flaky_tests.md"

ai_failure_payload_candidate_text() {
  local payload="$1"

  # Claude documents top-level .error for PostToolUseFailure, but raw command
  # output exposure is currently uncertain (github.com/anthropics/claude-code/issues/19372).
  # Scan every plausible field that is present and stay silent when none carry a
  # documented pattern.
  printf '%s' "$payload" | jq -r '
    def maybe_text:
      if . == null then empty
      elif type == "string" then .
      else tostring
      end;
    [
      (.error | maybe_text),
      (
        .tool_response as $response
        | if $response == null then empty
          elif ($response | type) == "object" then
            (
              $response.stderr,
              $response.stdout,
              $response.err,
              $response.out,
              $response.output,
              $response.raw,
              $response.text
              | maybe_text
            )
          else ($response | maybe_text)
          end
      )
    ] | map(select(length > 0)) | join("\n")
  ' 2>/dev/null || true
}

ai_failure_payload_command() {
  local payload="$1"

  ai_payload_command "$payload"
}

ai_failure_is_eslint_oom() {
  local command="$1"
  local text="$2"
  local combined

  combined="${command}"$'\n'"${text}"
  grep -qiE 'JavaScript heap out of memory|Allocation failed - JavaScript heap|Ineffective mark-compacts near heap limit|eslint.*heap out of memory|heap out of memory.*eslint' \
    <<< "$combined" || return 1
  grep -qiE '(^|[[:space:]/:-])(eslint|lint|lint:changed|verify|land\.sh)($|[[:space:]/:-])' \
    <<< "$combined"
}

ai_failure_lock_denial() {
  local text="$1"

  grep -qiE 'another `bun run` invocation|bun-run-quiet[.]sh killed while waiting for|Run verification commands sequentially' \
    <<< "$text"
}

ai_failure_flaky_tokens() {
  local repo_root="$1"
  local doc="$repo_root/$AI_FAILURE_FLAKY_DOC_REL"

  [ -f "$doc" ] || return 0
  awk '
    /^##[[:space:]]+/ {
      line=$0
      sub(/^##+[[:space:]]+[0-9]+[.][[:space:]]*/, "", line)
      print line
    }
    /^-[[:space:]]+/ {
      line=$0
      sub(/^-[[:space:]]+`?/, "", line)
      sub(/`?[[:space:]]*$/, "", line)
      if (line ~ /[.](test|spec)[.][A-Za-z0-9]+/) {
        print line
        count=split(line, parts, "/")
        if (count > 0) print parts[count]
      }
    }
  ' "$doc" | awk 'length($0) >= 8' | sort -u
}

ai_failure_known_flaky_match() {
  local repo_root="$1"
  local text="$2"
  local token

  while IFS= read -r token; do
    [ -n "$token" ] || continue
    if grep -Fq -- "$token" <<< "$text"; then
      printf '%s' "$token"
      return 0
    fi
  done < <(ai_failure_flaky_tokens "$repo_root")

  return 1
}

ai_failure_is_test_like() {
  local command="$1"
  local text="$2"
  local combined="${command}"$'\n'"${text}"

  grep -qiE 'bun run (test|test:changed|test:server|test:client|test:shared|e2e)|vitest|playwright|[.](test|spec)[.][A-Za-z0-9]+|AssertionError|timed out|FAILED|failed|expected' \
    <<< "$combined"
}

ai_failure_limit_guidance_lines() {
  local text="$1"
  local max_lines="${2:-5}"
  local line_count extra

  line_count=$(printf '%s\n' "$text" | wc -l)
  if [ "$line_count" -le "$max_lines" ]; then
    printf '%s' "$text"
    return 0
  fi

  extra=$(( line_count - max_lines ))
  printf '%s\n+%s more' "$(printf '%s\n' "$text" | head -n "$max_lines")" "$extra"
}

ai_failure_guidance_for_payload() {
  local repo_root="$1"
  local payload="$2"
  local command text combined guidance="" flaky_match

  command=$(ai_failure_payload_command "$payload")
  text=$(ai_failure_payload_candidate_text "$payload")
  combined="${command}"$'\n'"${text}"

  if ai_failure_is_eslint_oom "$command" "$text"; then
    guidance="${guidance}failure-guidance: Known: full-scan ESLint OOMs at the default heap. Gate wrappers source scripts/lib/gate-env.sh; retry via bun run verify or git commit so NODE_OPTIONS is managed there."$'\n'
  fi

  if ai_failure_is_test_like "$command" "$text" \
    && flaky_match=$(ai_failure_known_flaky_match "$repo_root" "$combined"); then
    guidance="${guidance}failure-guidance: Known flaky-test candidate (${flaky_match}); see $AI_FAILURE_FLAKY_DOC_REL and follow the pass-in-isolation retry protocol before changing product code."$'\n'
  fi

  if ai_failure_lock_denial "$text"; then
    guidance="${guidance}failure-guidance: Another verification holds the lock; wait for it (or check \`bun run verify:async:status\`) and retry - do not spawn a parallel run (see scripts/ai-hooks/bun-run-quiet.sh)."$'\n'
  fi

  [ -n "$guidance" ] || return 1
  ai_failure_limit_guidance_lines "${guidance%$'\n'}" 5
}

ai_failure_guidance_main() {
  local payload repo_root message

  payload=$(ai_read_payload)
  repo_root=$(ai_repo_root)
  if message=$(ai_failure_guidance_for_payload "$repo_root" "$payload"); then
    ai_emit_additional_context "PostToolUseFailure" "$message"
  fi
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  ai_failure_guidance_main "$@"
fi
