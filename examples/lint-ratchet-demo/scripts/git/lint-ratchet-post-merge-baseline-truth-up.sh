#!/usr/bin/env bash
# Entry point for the lint-ratchet baseline post-merge/post-commit truth-up. The
# body (baseline-post-merge-truth-up.sh) is SOURCED in-process — not re-dispatched
# through bun — so the check command stays the only subprocess. A git
# post-merge/post-commit hook invokes this shim.
set -uo pipefail

# Resolve the body next to this shim with pure-bash expansion (no dirname): the
# truth-up hooks run under a deliberately minimal PATH that may omit coreutils.
_truth_up_shim_dir="${BASH_SOURCE[0]%/*}"
[ "$_truth_up_shim_dir" = "${BASH_SOURCE[0]}" ] && _truth_up_shim_dir="."
# shellcheck source=scripts/git/baseline-post-merge-truth-up.sh
. "$_truth_up_shim_dir/baseline-post-merge-truth-up.sh"
