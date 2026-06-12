#!/usr/bin/env bash
# Shared base-ref resolution + merge-base preflight for the changed
# wrappers that diff `$BASE...HEAD`.
#
# Resolution prefers the local ref, then falls back to origin/<base>.
# Even when a ref resolves, the triple-dot range needs a common ancestor:
# orphan branches and partially-fetched clones can have both refs
# resolvable yet share no history. `git diff` then fatals, and when that
# happens inside `<(...)` process substitution the failure does NOT
# propagate through `set -e`, so a wrapper would silently under-scan.
# Preflighting `git merge-base` routes both failure modes to the caller's
# conservative full-scan fallback instead.
#
# Usage:
#   . "$SCRIPT_DIR/lib/changed-base.sh"
#   if musi_resolve_changed_base "$BASE"; then
#     BASE="$MUSI_CHANGED_BASE"
#   else
#     echo "<label>: $MUSI_CHANGED_BASE_ERROR — <full-scan fallback>." >&2
#     ...wrapper's existing full-scan path...
#   fi
#
# The caller owns the fallback message so wrappers with non-printing
# debug modes (lint-agent-changed.sh --print-files) stay silent.

# On success sets MUSI_CHANGED_BASE to the usable ref. On failure returns 1
# with MUSI_CHANGED_BASE_ERROR describing why, for the caller's diagnostic.
# shellcheck disable=SC2034 # MUSI_CHANGED_BASE_ERROR is consumed by sourcing wrappers.
musi_resolve_changed_base() {
  local base="$1"

  MUSI_CHANGED_BASE=""
  MUSI_CHANGED_BASE_ERROR=""

  if git rev-parse --verify "$base" >/dev/null 2>&1; then
    MUSI_CHANGED_BASE="$base"
  elif git rev-parse --verify "origin/$base" >/dev/null 2>&1; then
    MUSI_CHANGED_BASE="origin/$base"
  else
    MUSI_CHANGED_BASE_ERROR="neither '$base' nor 'origin/$base' exists"
    return 1
  fi

  if ! git merge-base "$MUSI_CHANGED_BASE" HEAD >/dev/null 2>&1; then
    MUSI_CHANGED_BASE_ERROR="'$MUSI_CHANGED_BASE' shares no history with HEAD"
    MUSI_CHANGED_BASE=""
    return 1
  fi
}
