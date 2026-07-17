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
# Before this registry those names were hand-maintained as three parallel lists;
# adding a fifth baseline artifact is now a one-line change here.
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
