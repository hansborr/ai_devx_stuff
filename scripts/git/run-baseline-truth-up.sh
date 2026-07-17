#!/usr/bin/env bash
# Dispatch every baseline post-merge truth-up in one call.
#
# Shared truth-up dispatch for .husky/post-merge (invoked with no context arg)
# and .husky/post-commit (invoked with a `post-commit` context arg). The
# per-site guards that decide *whether* to truth up — post-merge's squash check
# and post-commit's merge-parent/pending-marker check — stay at the call sites;
# this script only fans out to each driver's truth-up and forwards the optional
# context arg. The driver names come from the shared registry
# (scripts/git/baseline-drivers.sh) so adding a baseline artifact is a one-line
# change there.
set -uo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 0

# shellcheck source=scripts/git/baseline-drivers.sh
. "$script_dir/baseline-drivers.sh"

for metric in "${MUSI_BASELINE_DRIVERS[@]}"; do
  bash "$script_dir/$metric-post-merge-baseline-truth-up.sh" "$@"
done
