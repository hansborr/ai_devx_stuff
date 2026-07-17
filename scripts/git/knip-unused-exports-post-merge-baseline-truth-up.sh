#!/usr/bin/env bash
# Thin per-driver entry point for the knip unused-exports baseline
# post-merge/post-commit truth-up. The shared body (baseline-post-merge-truth-up.sh)
# is SOURCED in-process — not re-dispatched through bun — so the driver's own check
# command stays the only subprocess, matching the husky hooks and the
# bun-invocation-log test stubs.
set -uo pipefail

# shellcheck disable=SC2034 # consumed by the sourced shared truth-up body.
MUSI_TRUTH_UP_KEY="knip-unused-exports"
# Resolve the shared body next to this shim with pure-bash expansion (no dirname):
# the truth-up hooks run under a deliberately minimal PATH that may omit coreutils.
_truth_up_shim_dir="${BASH_SOURCE[0]%/*}"
[ "$_truth_up_shim_dir" = "${BASH_SOURCE[0]}" ] && _truth_up_shim_dir="."
# shellcheck source=scripts/git/baseline-post-merge-truth-up.sh
. "$_truth_up_shim_dir/baseline-post-merge-truth-up.sh"
