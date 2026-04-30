#!/usr/bin/env bash
# Fast, side-effect-free drift warning for Husky checkout/merge hooks.
#
# The hook only reads the current worktree's template fingerprint and the
# fingerprint recorded during the last `worktree:init`. It deliberately does
# not build templates, clone DBs, or create the meta DB.

# Husky 9 invokes user hooks with `sh -e`, ignoring the bash shebang. When
# this file is sourced from a Husky hook running under dash, BASH_SOURCE and
# the bash arrays in worktree-db.sh blow up. Detect that case, run the work
# in a bash subprocess, and `exit` so the sourcing dash hook never reaches
# the bash-only code below or its own `musi_worktree_drift_hook` call line.
if [ -z "${BASH_VERSION:-}" ]; then
  __musi_hook_event=$(basename -- "$0")
  __musi_hook_dir=$(cd -- "$(dirname -- "$0")"/.. && pwd)
  bash -c '. "$1/scripts/worktree-drift-hook.sh"; shift 2; musi_worktree_drift_hook "$0" "$@"' \
    "$__musi_hook_event" "$__musi_hook_dir" "$__musi_hook_event" "$@"
  exit $?
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! declare -F compute_fingerprint >/dev/null 2>&1; then
  # shellcheck source=/dev/null
  . "$SCRIPT_DIR/worktree-db.sh"
fi

musi_short_fp() {
  local fp="$1"
  if [[ "$fp" =~ ^[a-f0-9]{64}$ ]]; then
    printf '%s' "${fp:0:12}"
  else
    printf '%s' "${fp:-<none>}"
  fi
}

# git post-checkout passes a third arg `branch_flag`: 1 for a branch
# checkout, 0 for a file-only checkout (e.g. `git checkout -- foo.ts`,
# `git restore --source=…`). File checkouts cannot move HEAD, so the
# template fingerprint cannot have changed — skip the bun-spawning DB
# lookup. post-merge has no equivalent flag (a merge always moves HEAD).
musi_drift_event_is_no_op() {
  local event="$1" branch_flag="${2:-1}"
  [[ "$event" == "post-checkout" && "$branch_flag" == "0" ]]
}

musi_template_fingerprint_drifted() {
  local current_fp="$1" clone_fp="$2"
  [[ -n "$current_fp" && -n "$clone_fp" && "$current_fp" != "$clone_fp" ]]
}

musi_meta_db_exists() {
  local found
  found="$(run_admin "SELECT 1 FROM pg_database WHERE datname = '$META_DB'" 2>/dev/null)" || return 1
  [[ -n "$found" ]]
}

musi_meta_read() {
  local sql="$1" out
  out="$(run_db "$META_DB" "$sql" 2>/dev/null)" || out=""
  printf '%s' "$out"
}

musi_template_drift_warning() {
  local event="$1" wt_root="$2" current_fp="$3" clone_fp="$4" template_db="$5"
  cat >&2 <<EOF
worktree drift: template fingerprint changed after ${event}.
  worktree: ${wt_root}
  clone fingerprint: $(musi_short_fp "$clone_fp")
  current fingerprint: $(musi_short_fp "$current_fp")
  template db: ${template_db}
Run 'bun run worktree:init' before starting dev/test so this worktree's databases match the checked-out Prisma/seed inputs.
EOF
}

musi_worktree_drift_hook() {
  local event="${1:-git hook}"

  if musi_drift_event_is_no_op "$event" "${4:-1}"; then
    return 0
  fi

  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 0
  if is_primary_worktree; then
    return 0
  fi

  local wt_root current_fp slug clone_fp template_db
  wt_root="$(current_root 2>/dev/null)" || return 0
  current_fp="$(compute_fingerprint "$wt_root" 2>/dev/null)" || current_fp=""
  [[ -n "$current_fp" ]] || return 0

  musi_meta_db_exists || return 0

  slug="$(compute_slug "$wt_root")"
  clone_fp="$(musi_meta_read "SELECT fingerprint FROM worktree_clone WHERE slug = '$slug'")"
  musi_template_fingerprint_drifted "$current_fp" "$clone_fp" || return 0

  template_db="$(template_db_for_fingerprint "$current_fp" 2>/dev/null)" || template_db="<unknown>"
  musi_template_drift_warning "$event" "$wt_root" "$current_fp" "$clone_fp" "$template_db"
}
