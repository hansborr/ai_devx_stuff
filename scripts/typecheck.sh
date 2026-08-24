#!/usr/bin/env bash
# Run package, scripts, eslint-config-JS, and e2e TypeScript checks
# concurrently while keeping output readable.
set -eu

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# shellcheck source=scripts/lib/parallel-runner.sh
. "$REPO_ROOT/scripts/lib/parallel-runner.sh"
# This facade historically runs without pipefail. The shared runner enables it
# while being sourced, so restore the existing option deliberately rather than
# changing TypeScript diagnostic pipeline behavior as part of this convergence.
set +o pipefail

# Resolve the TypeScript compiler explicitly so `bash scripts/typecheck.sh`
# works without Bun's PATH injection (mirrors scripts/vitest.sh). Falls back to
# bare `tsc` so environments that already have it on PATH do not regress.
if [ -n "${MUSI_TSC_BIN:-}" ]; then
  TSC=("$MUSI_TSC_BIN")
elif [ -x "$REPO_ROOT/node_modules/.bin/tsc" ]; then
  TSC=("$REPO_ROOT/node_modules/.bin/tsc")
else
  TSC=(tsc)
fi

print_indented_file() {
  sed 's/^/  /' "$1" >&2
}

print_excerpt_file() {
  local file="$1"
  local total="$2"
  local head_count=15
  local tail_count=15
  local omitted

  if [ "$total" -le $((head_count + tail_count)) ]; then
    print_indented_file "$file"
    return 0
  fi

  head -n "$head_count" "$file" | sed 's/^/  /' >&2
  omitted=$((total - head_count - tail_count))
  printf '  ... %s middle line(s) omitted ...\n' "$omitted" >&2
  tail -n "$tail_count" "$file" | sed 's/^/  /' >&2
}

print_failure_summary() {
  local label="$1"
  local exit_code="$2"
  local log_file="$3"
  local diagnostics_file="$MUSI_PARALLEL_TMP_DIR/${label//[^A-Za-z0-9]/_}.diagnostics"
  local excerpt_file="$log_file"
  local excerpt_kind="log"
  local error_count=0
  local line_count

  printf 'typecheck: %s failed with exit %s\n' "$label" "$exit_code" >&2
  grep -E '(^|[[:space:]])error TS[0-9]+:' "$log_file" > "$diagnostics_file" || true
  error_count="$(wc -l < "$diagnostics_file" | tr -d '[:space:]')"
  printf 'typecheck: %s diagnostics: %s TypeScript error line(s)\n' \
    "$label" "$error_count" >&2

  if [ "$error_count" -gt 0 ]; then
    excerpt_file="$diagnostics_file"
    excerpt_kind="diagnostic"
  fi
  line_count="$(wc -l < "$excerpt_file" | tr -d '[:space:]')"
  [ "$line_count" -gt 0 ] || return 0
  printf 'typecheck: %s %s excerpt (%s line(s)):\n' \
    "$label" "$excerpt_kind" "$line_count" >&2
  print_excerpt_file "$excerpt_file" "$line_count"
}

musi_parallel_init "musi-typecheck"
musi_parallel_install_traps

musi_parallel_start_logged "tsc -b" "packages" "${TSC[@]}" -b
musi_parallel_start_logged "tsc -p tsconfig.scripts.json" "scripts" \
  "${TSC[@]}" -p tsconfig.scripts.json
musi_parallel_start_logged "tsc -p tsconfig.eslint-js.json" "eslint-js" \
  "${TSC[@]}" -p tsconfig.eslint-js.json
musi_parallel_start_logged "tsc -p tsconfig.e2e.json" "e2e" \
  "${TSC[@]}" -p tsconfig.e2e.json

musi_parallel_wait_all "typecheck" print_failure_summary
exit "$MUSI_PARALLEL_EXIT"
