#!/usr/bin/env bash
# Single source of truth for the baseline driver names.
#
# A "baseline driver" is a ratcheted artifact with a semantic git merge driver,
# an installer, and a post-merge truth-up. The per-driver scripts follow the
# fixed naming convention keyed on the names below:
#   scripts/git/install-<name>-merge-driver.sh
#   scripts/git/<name>-post-merge-baseline-truth-up.sh
# and each leaves a truth-up marker at
#   <git-dir>/musi/<name>-baseline-postmerge-truth-up-required
#
# This list is looped over by the install dispatcher
# (install-all-merge-drivers.sh), the truth-up dispatcher
# (run-baseline-truth-up.sh), and the .husky/post-commit merge-marker sweep.
# Adding or renaming a family also requires its merge-driver descriptor,
# truth-up metadata/handler, merge-CLI table entry, baseline-path map, and
# conventional install/check/lib shims. Package-owned families deliberately
# replace some of those surfaces with tombstones or executable shims. Keep the
# per-key policy and complete checklist in
# scripts/baseline-family-parity.test.ts aligned with this registry.
#
# Sourced, never executed: it only assigns MUSI_BASELINE_DRIVERS. Keep it free of
# `set` options and side effects so any hook can source it safely.

# shellcheck disable=SC2034  # consumed by the scripts that source this file.
MUSI_BASELINE_DRIVERS=(
  lint-ratchet
  knip-unused-exports
  near-duplicates
  max-lines-exceptions
)
