#!/bin/bash

# Lint-coverage throttle config plus the neutral throttle helper. Hook code
# should call ai_throttle_* directly and pass ttl/max values explicitly.

AI_HOOKS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "$AI_HOOKS_DIR/throttle-state.sh"

# TTL in seconds; integer >= 0. `0` means always emit (the detection-test
# escape hatch). Invalid input falls back to the 30-minute default, matching the
# repo's AI_BUN_TTL convention.
ai_lint_coverage_ttl() {
  local value="${AI_LINT_COVERAGE_TTL:-1800}"
  if ai_is_integer "$value" && [ "$value" -ge 0 ]; then
    printf '%s' "$value"
  else
    printf '1800'
  fi
}

# Backstop detection count; integer >= 1. TTL is the primary lever. Invalid
# input falls back to the default.
ai_lint_coverage_max_detections() {
  local value="${AI_LINT_COVERAGE_MAX_DETECTIONS:-10}"
  if ai_is_integer "$value" && [ "$value" -ge 1 ]; then
    printf '%s' "$value"
  else
    printf '10'
  fi
}
