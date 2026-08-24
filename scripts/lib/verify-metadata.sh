#!/usr/bin/env bash
# The gate-metadata aggregator and sole public entry point.
#
# This file defines nothing of its own. It sources six single-concern leaf libs
# from scripts/lib/ and re-exports their combined API: .husky/pre-commit,
# .husky/pre-push, .husky/post-commit, verify.sh, land.sh, lint-shell.sh, the
# ai-hooks, and the smoke suites all source *this* file and get the whole
# surface. Leaf libs never source each other, so the block below is the single
# place their order is decided, and no consumer is ever repointed at a leaf —
# the leaves are internal layering, this file is the API.
#
# Concern map (source order):
#   verify-state-paths.sh   Repo/worktree identity, the fingerprint primitives
#                           every trust boundary validates against, the
#                           musi_standard_* state/log/lock family plus the
#                           pre-commit marker path, and the shared MUSI_GATE_*
#                           timing budgets. (The verify:changed and full verify
#                           marker paths are verify-markers.sh below.) Base
#                           layer: alone among the six it is not function
#                           definitions only, because those four budgets are
#                           top-level assignments — every leaf also sets a
#                           __MUSI_VERIFY_*_SOURCED guard. Sourced first so the
#                           budgets exist before any later leaf could read one;
#                           that ordering is defensive, since nothing reads a
#                           budget at source time.
#   verify-commit-queue.sh  Waiter tickets parked beside a shared commit-queue
#                           lock: queue depth for a waiting lane, self-healing
#                           for an abandoned wait.
#   verify-fast-commit.sh   Fast-commit provenance — the cross-worktree log of
#                           commits made with the slow verify slots deferred,
#                           the per-worktree pending marker, and the tripwire
#                           that makes the toggle's disappearances attributable.
#   verify-markers.sh       Success-marker codec (read/match/write), the
#                           standard verify:changed and full verify marker
#                           paths, the land-time re-stamp, and the verify ->
#                           pre-commit marker bridge.
#   verify-path-policy.sh   The bash bridge to the path-policy query engine, the
#                           staged-change selectors built on it, and the staged
#                           and pre-commit fingerprints those selectors feed.
#   verify-run-meta.sh      Run-meta reporting shims over the TS codec
#                           scripts/lib/verify-metadata-core.ts (per the
#                           substrate ruling in docs/ai-harness.md): per-step and
#                           wrapper fragments, history, and the final combine
#                           into run-meta.json.
#
# docs/guides/verify-gate-lifecycle.md walks the lifecycle these six implement
# end to end and links each stage to the leaf that owns it.
#
# Kept in scripts/lib so gate scripts and smoke tests can source it without
# pulling in scripts/ai-hooks/cache.sh. Every sourcer is bash (there is no
# dash/POSIX-sh constraint); the real contract is staying sourceable under
# `set -euo pipefail` with stable function names and out-variables.
# ai_worktree_fingerprint is reachable from here for the same reason: cache.sh
# sources this file and re-exports it for ai-hooks callers.

# --- Leaf engine libs --------------------------------------------------------
# The lib dir is resolved from BASH_SOURCE (mirroring how the run-meta shims
# locate their codec) and unset again, so sourcing this file leaves behind
# nothing but function definitions, the four MUSI_GATE_* constants, and each
# leaf's own __MUSI_VERIFY_*_SOURCED re-source guard.
__musi_verify_metadata_lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/verify-state-paths.sh
. "$__musi_verify_metadata_lib_dir/verify-state-paths.sh"
# shellcheck source=scripts/lib/verify-commit-queue.sh
. "$__musi_verify_metadata_lib_dir/verify-commit-queue.sh"
# shellcheck source=scripts/lib/verify-fast-commit.sh
. "$__musi_verify_metadata_lib_dir/verify-fast-commit.sh"
# shellcheck source=scripts/lib/verify-markers.sh
. "$__musi_verify_metadata_lib_dir/verify-markers.sh"
# shellcheck source=scripts/lib/verify-path-policy.sh
. "$__musi_verify_metadata_lib_dir/verify-path-policy.sh"
# shellcheck source=scripts/lib/verify-run-meta.sh
. "$__musi_verify_metadata_lib_dir/verify-run-meta.sh"
unset __musi_verify_metadata_lib_dir
