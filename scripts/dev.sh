#!/usr/bin/env bash
# dev.sh — start the dev pipeline. On a secondary git worktree, provision
# per-worktree DBs/ports/env first via `worktree:init`. The primary worktree
# is detected by `git-common-dir == git-dir` and short-circuits.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! declare -F compute_fingerprint >/dev/null 2>&1; then
  # shellcheck source=/dev/null
  . "$SCRIPT_DIR/worktree-db.sh"
fi

musi_dev_log() { printf '[dev] %s\n' "$*" >&2; }

musi_dev_log_color_enabled() {
  case "${MUSI_DEV_LOG_COLOR:-auto}" in
    1|true|on|yes)     return 0 ;;
    0|false|off|no|"") return 1 ;;
    auto)
      [[ -z "${NO_COLOR:-}" && ( -t 1 || -t 2 ) ]]
      ;;
    *)
      musi_dev_log "WARN: unknown MUSI_DEV_LOG_COLOR='${MUSI_DEV_LOG_COLOR}'; using auto (valid: auto, on, off)"
      [[ -z "${NO_COLOR:-}" && ( -t 1 || -t 2 ) ]]
      ;;
  esac
}

musi_dev_log_color_for() {
  case "$1" in
    shared) printf '\033[36m' ;;
    server) printf '\033[35m' ;;
    client) printf '\033[32m' ;;
    *)      printf '' ;;
  esac
}

musi_dev_prefix_stream() {
  local label="$1" color_enabled="${2:-0}"
  local line prefix reset
  prefix="[$label]"
  reset=""

  if [[ "$color_enabled" == "1" ]]; then
    prefix="$(musi_dev_log_color_for "$label")${prefix}"
    reset=$'\033[0m'
  fi

  while IFS= read -r line || [[ -n "$line" ]]; do
    printf '%b%s %s\n' "$prefix" "$reset" "$line"
  done
}

musi_dev_drift_gate_mode() {
  case "${MUSI_DEV_DRIFT_GATE:-warn}" in
    0|false|off|skip) printf 'off' ;;
    fail)             printf 'fail' ;;
    warn|"")          printf 'warn' ;;
    *)
      musi_dev_log "WARN: unknown MUSI_DEV_DRIFT_GATE='${MUSI_DEV_DRIFT_GATE}'; using 'warn' (valid: warn, fail, off)"
      printf 'warn'
      ;;
  esac
}

musi_dev_residual_drift_reasons() {
  local current_fp="$1" current_migration_fp="$2" current_seed_fp="$3"
  local clone_fp="$4" clone_migration_fp="$5" clone_seed_fp="$6"
  local reasons=()

  if [[ -z "$clone_fp" ]]; then
    reasons+=("clone fingerprint missing after worktree:init")
  fi

  if [[ -n "$clone_fp" && -z "$clone_migration_fp" ]]; then
    reasons+=("migration fingerprint missing after worktree:init")
  elif [[ -n "$clone_migration_fp" && "$clone_migration_fp" != "$current_migration_fp" ]]; then
    reasons+=("migration fingerprint stale after worktree:init")
  fi

  if [[ -n "$clone_fp" && -z "$clone_seed_fp" ]]; then
    reasons+=("SRD seed fingerprint missing after worktree:init")
  elif [[ -n "$clone_seed_fp" && "$clone_seed_fp" != "$current_seed_fp" ]]; then
    reasons+=("SRD seed fingerprint stale after worktree:init")
  fi

  if [[ -n "$clone_fp" \
     && "$clone_fp" != "$current_fp" \
     && "$clone_migration_fp" == "$current_migration_fp" \
     && "$clone_seed_fp" == "$current_seed_fp" ]]; then
    reasons+=("clone fingerprint stale after worktree:init")
  fi

  if (( ${#reasons[@]} > 0 )); then
    printf '%s\n' "${reasons[@]}"
  fi
  return 0
}

musi_dev_warn_or_fail_on_residual_drift() {
  local mode
  mode="$(musi_dev_drift_gate_mode)"
  [[ "$mode" == "off" ]] && return 0

  local wt_root slug current_fp current_migration_fp current_seed_fp
  wt_root="$(current_root)"
  current_fp="$(compute_fingerprint "$wt_root")"
  current_migration_fp="$(compute_migration_fingerprint "$wt_root")"
  current_seed_fp="$(compute_seed_fingerprint "$wt_root")"

  local reasons=()
  if ! db_exists "$META_DB"; then
    reasons+=("meta database missing after worktree:init")
  else
    slug="$(compute_slug "$wt_root")"
    local clone_fp clone_migration_fp clone_seed_fp
    clone_fp="$(meta_read_value worktree_clone fingerprint "slug = '$slug'")"
    clone_migration_fp="$(meta_read_value worktree_clone migration_fingerprint "slug = '$slug'")"
    clone_seed_fp="$(meta_read_value worktree_clone seed_fingerprint "slug = '$slug'")"
    mapfile -t reasons < <(
      musi_dev_residual_drift_reasons \
        "$current_fp" "$current_migration_fp" "$current_seed_fp" \
        "$clone_fp" "$clone_migration_fp" "$clone_seed_fp"
    )
  fi

  (( ${#reasons[@]} == 0 )) && return 0

  local label="WARN"
  [[ "$mode" == "fail" ]] && label="ERROR"
  {
    printf '[dev] %s: residual worktree drift remains after `bun run worktree:init`.\n' "$label"
    printf '[dev] Worktree drift reasons:\n'
    local reason
    for reason in "${reasons[@]}"; do
      [[ -n "$reason" ]] && printf '[dev]   - %s\n' "$reason"
    done
    printf "[dev] Run 'bun run worktree:status' for details. For SRD seed drift, run 'bun run worktree:refresh-data' or 'bun run worktree:refresh-data --destructive'.\n"
    printf "[dev] Set MUSI_DEV_DRIFT_GATE=off to skip this startup gate, or MUSI_DEV_DRIFT_GATE=fail to make residual drift block dev startup.\n"
  } >&2

  [[ "$mode" == "fail" ]] && return 1
  return 0
}

musi_dev_run_worktree_init() {
  musi_dev_log "secondary worktree detected; provisioning with: bun run worktree:init (dependencies, template build, or DB clone may take a moment)"

  set +e
  bun run worktree:init
  local rc=$?
  set -e

  if (( rc != 0 )); then
    musi_dev_log "ERROR: command failed: bun run worktree:init (exit $rc)"
    exit "$rc"
  fi

  musi_dev_warn_or_fail_on_residual_drift
}

musi_dev_prebuild_shared() {
  # Vite scans the client's imports as soon as it starts. The client imports
  # `@musi/shared/...` subpaths whose `exports` map points to
  # `packages/shared/dist/**`. If `dist/` is missing — which is the case on a
  # cold worktree before `tsc -b --watch` has emitted — the scan fails with
  # "Failed to run dependency scan. Skipping dependency pre-bundling." Run a
  # one-shot incremental build first when cold so the scan succeeds.
  local dist_dir="packages/shared/dist"
  if [[ -d "$dist_dir/schemas" && -f "$dist_dir/constants.js" ]]; then
    return 0
  fi

  musi_dev_log "shared/dist not populated; running one-shot build before fan-out"

  set +e
  bun run --filter @musi/shared build >/dev/null
  local rc=$?
  set -e

  if (( rc != 0 )); then
    musi_dev_log "ERROR: shared one-shot build failed (exit $rc)"
    exit "$rc"
  fi
}

musi_dev_workspace_specs() {
  printf '%s\t%s\t%s\n' \
    "shared" "packages/shared" "" \
    "server" "packages/server" "" \
    "client" "packages/client" ".env"
}

musi_dev_start_workspace() {
  local label="$1" dir="$2" color_enabled="$3" env_file="${4:-}"
  (
    cd "$dir"
    if [[ -n "$env_file" && -f "$env_file" ]]; then
      exec bun --env-file="$env_file" run dev \
        > >(musi_dev_prefix_stream "$label" "$color_enabled") \
        2> >(musi_dev_prefix_stream "$label" "$color_enabled" >&2)
    fi

    exec bun run dev \
      > >(musi_dev_prefix_stream "$label" "$color_enabled") \
      2> >(musi_dev_prefix_stream "$label" "$color_enabled" >&2)
  ) &
}

musi_dev_stop_workspaces() {
  local pid
  for pid in "$@"; do
    kill "$pid" >/dev/null 2>&1 || true
  done
  for pid in "$@"; do
    wait "$pid" >/dev/null 2>&1 || true
  done
}

musi_dev_run_workspaces() {
  local color_enabled=0
  if musi_dev_log_color_enabled; then
    color_enabled=1
  fi

  local pids=()
  local label dir env_file
  while IFS=$'\t' read -r label dir env_file; do
    musi_dev_start_workspace "$label" "$dir" "$color_enabled" "$env_file"
    pids+=( "$!" )
  done < <(musi_dev_workspace_specs)

  trap 'musi_dev_stop_workspaces "${pids[@]}"; exit 130' INT TERM

  local rc=0
  set +e
  wait -n "${pids[@]}"
  rc=$?
  set -e

  musi_dev_stop_workspaces "${pids[@]}"
  return "$rc"
}

main() {
  if ! is_primary_worktree; then
    musi_dev_run_worktree_init
  fi

  musi_dev_prebuild_shared
  musi_dev_run_workspaces
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
