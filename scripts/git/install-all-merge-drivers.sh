#!/usr/bin/env bash
# Install every baseline merge driver in one dispatch.
#
# Shared installer dispatch for .husky/post-merge, .husky/post-checkout, and the
# package.json `prepare` script. Each per-metric installer is advisory (it exits
# 0 even on a broken local Git env), so this dispatcher never hard-fails the
# sourcing hook; it just runs each driver in order. The driver names come from
# the shared registry (scripts/git/baseline-drivers.sh) so adding a baseline
# artifact is a one-line change there.
set -uo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 0

# shellcheck source=scripts/git/baseline-drivers.sh
. "$script_dir/baseline-drivers.sh"

for metric in "${MUSI_BASELINE_DRIVERS[@]}"; do
  bash "$script_dir/install-$metric-merge-driver.sh"
done
