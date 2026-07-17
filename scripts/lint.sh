#!/usr/bin/env bash
# Composite lint floor: ShellCheck for maintained shell scripts, config-file
# sensors for YAML/TOML/Dockerfile/workflows, the runtime import-cycle floor
# (drift:ai import-cycles, gated on runtime cycles only), and ESLint for the
# normal TypeScript/JavaScript/JSON lint surface.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=scripts/lib/tool-memory-admission.sh
. "$SCRIPT_DIR/lib/tool-memory-admission.sh"
if musi_tool_memory_admission_needed full; then
  musi_tool_memory_run_admitted lint lint:direct bash "$SCRIPT_DIR/lint.sh" "$@"
  exit $?
fi

if [ "${1:-}" = "--" ]; then
  shift
fi

# Raise the Node heap so a direct `bun run lint` full scan gets the same OOM
# mitigation the gates do; idempotent when NODE_OPTIONS already sets it.
# shellcheck source=scripts/lib/gate-env.sh
. "$SCRIPT_DIR/lib/gate-env.sh"
# shellcheck source=scripts/lib/lint-dist-preflight.sh
. "$SCRIPT_DIR/lib/lint-dist-preflight.sh"
# shellcheck source=scripts/lib/parallel-runner.sh
. "$SCRIPT_DIR/lib/parallel-runner.sh"

musi_lint_dist_preflight "$REPO_ROOT"

musi_parallel_init "musi-lint"
musi_parallel_install_traps

musi_parallel_start "ShellCheck" "shell" bash "$SCRIPT_DIR/lint-shell.sh"
musi_parallel_start "config sensors" "config" bash "$SCRIPT_DIR/lint-config-sensors.sh"
# A cycle is a global property of the module graph, so this lane always audits
# the whole working tree (~1.2s, masked by the ESLint lane). Type-only cycles
# stay report-only; only runtime cycles (or a graph the sensor could not
# trust) fail the lane.
musi_parallel_start "import cycles" "import-cycles" bash "$SCRIPT_DIR/lint-import-cycles.sh"
# Keep the four main ESLint partitions strictly sequential. Lint memory profile
# leaf 76 measured the final split at 3.381 GiB versus 4.095 GiB monolithic with
# unchanged cold wall. Note 73 measured
# `--concurrency=2` at 8.14 GB versus 4.27 GB serial, while `auto` OOM-killed
# the 16 GB host because every worker isolate duplicates the TypeScript type
# program. The shared Node heap ceiling is per isolate and cannot bound that
# aggregate. Do not add any ESLint `--concurrency` flag here.
musi_parallel_start "ESLint" "eslint" bash "$SCRIPT_DIR/eslint-main.sh" --full "$@"

musi_parallel_wait_all "lint"
exit "$MUSI_PARALLEL_EXIT"
