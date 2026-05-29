#!/bin/bash

# Shared output filtering for known noisy third-party warnings.
#
# Summary viewers and hook adapters keep raw log files unchanged and use this
# only before printing tails. Live command wrappers may also stream through this
# function when the command's user-facing output is known to contain the same
# third-party noise.

ai_filter_known_output_noise() {
  # Prisma adapter-pg issue: implicit transaction relation fetches can call
  # pg Client.query concurrently, which pg 8.20 warns about. Track upstream:
  # https://github.com/prisma/prisma/issues/29407
  sed -u -E \
    -e 's/\(node:[0-9]+\) DeprecationWarning: Calling client\.query\(\) when the client is already executing a query is deprecated and will be removed in pg@9\.0\. Use async\/await or an external async flow control mechanism instead\.//g' \
    -e 's/\(Use `node --trace-deprecation \.\.\.` to show where the warning was created\)//g' \
    -e "/Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set/d"
}

ai_failed_script_smoke_names() {
  local log="$1"

  grep -E '^test:scripts: [^[:space:]]+ FAILED$' "$log" 2>/dev/null \
    | awk '{print $2}'
}

ai_filtered_task_log_excerpt() {
  local task="$1"
  local log="$2"
  local tail_lines="${3:-30}"
  local smoke_names smoke

  if [ "$task" = scripts ]; then
    smoke_names=$(ai_failed_script_smoke_names "$log")
    if [ -n "$smoke_names" ]; then
      printf '%s\n' "$smoke_names" | while IFS= read -r smoke; do
        printf 'scripts failed: %s\n' "$smoke"
        printf 'command: bash scripts/%s.sh\n' "$smoke"
      done
      printf '\n'
    fi
  fi

  tail -n 200 "$log" | ai_filter_known_output_noise | tail -n "$tail_lines"
}

# Render the state-aware lint:ratchet report on a local gate failure instead of a
# raw JSON tail (which loses the head and totals on multi-finding regressions).
# The ratchet step writes its envelope to <diag_file> via HARNESS_DIAGNOSTICS_OUTPUT.
# Three branches mirror CI (ci.yml): a missing/empty envelope means the run
# crashed before emitting one (config/runtime error), a non-zero formatter status
# means a malformed/partial envelope or formatter bug — both fall back to the raw
# tail with a note so the failure stays visible and cannot masquerade as a clean
# "0 findings" render.
ai_ratchet_failure_excerpt() {
  local diag_file="$1"
  local log="$2"
  local tail_lines="${3:-30}"
  local report report_status

  if [ ! -s "$diag_file" ]; then
    printf 'lint:ratchet failed before producing a diagnostics envelope (likely a config or runtime error); raw log tail follows.\n'
    ai_filtered_task_log_excerpt ratchet "$log" "$tail_lines"
    return 0
  fi

  report=$(bun run lint:ratchet:report < "$diag_file" 2>&1)
  report_status=$?
  if [ "$report_status" -ne 0 ]; then
    printf 'lint:ratchet report formatter failed (exit %s); raw log tail follows.\n' "$report_status"
    printf '%s\n' "$report"
    ai_filtered_task_log_excerpt ratchet "$log" "$tail_lines"
    return 0
  fi

  printf '%s\n' "$report"
}
