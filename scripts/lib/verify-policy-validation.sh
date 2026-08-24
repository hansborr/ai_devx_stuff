#!/usr/bin/env bash
# Gate-policy schema and callback validation for the shared verification engine.
#
# Owns the named-associative-array policy contract, log-target safety checks,
# allowed and required field inventories, mode/value validation, and resolution
# of string-named provider and lifecycle callbacks.
#
# Source order: none. This leaf calls only functions it defines. Consumers must
# source scripts/lib/verify-engine.sh, which resolves this sibling from
# BASH_SOURCE and re-exports the complete engine API.

musi_verify_gate_policy_error() {
  printf 'verify engine: invalid gate policy: %s\n' "$1" >&2
  return 2
}

musi_verify_gate_path_absolute() {
  local repo_root="$1" path="$2"
  if command -v realpath >/dev/null 2>&1; then
    if [[ "$path" = /* ]]; then
      realpath -m -- "$path"
    else
      realpath -m -- "${repo_root%/}/$path"
    fi
  elif [[ "$path" = /* ]]; then
    printf '%s\n' "${path%/}"
  else
    printf '%s/%s\n' "${repo_root%/}" "${path%/}"
  fi
}

musi_verify_gate_path_is_at_or_beneath() {
  local path="$1" protected_root="$2"
  [ -n "$protected_root" ] || return 1
  [ "$path" = "$protected_root" ] || [[ "$path" = "$protected_root/"* ]]
}

musi_verify_validate_log_target() {
  local repo_root="$1" log_dir="$2" repo_abs log_abs git_dir common_dir
  [ -n "$log_dir" ] || {
    musi_verify_gate_policy_error 'log_dir must not be empty'
    return 2
  }
  [ "$log_dir" != / ] || {
    musi_verify_gate_policy_error 'log_dir must not be /'
    return 2
  }
  repo_abs=$(musi_verify_gate_path_absolute "$repo_root" .) || return 2
  log_abs=$(musi_verify_gate_path_absolute "$repo_root" "$log_dir") || return 2
  [ "$log_abs" != / ] && [ "$log_abs" != "$repo_abs" ] || {
    musi_verify_gate_policy_error "unsafe log_dir target: $log_dir"
    return 2
  }
  git_dir=$(git -C "$repo_root" rev-parse --absolute-git-dir 2>/dev/null || true)
  common_dir=$(git -C "$repo_root" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)
  if [ -n "$git_dir" ]; then
    git_dir=$(musi_verify_gate_path_absolute "$repo_root" "$git_dir") || return 2
  fi
  if [ -n "$common_dir" ]; then
    common_dir=$(musi_verify_gate_path_absolute "$repo_root" "$common_dir") || return 2
  fi
  if [ "$log_abs" = "$repo_abs/.git" ] \
     || musi_verify_gate_path_is_at_or_beneath "$log_abs" "$git_dir" \
     || musi_verify_gate_path_is_at_or_beneath "$log_abs" "$common_dir"; then
    musi_verify_gate_policy_error "log_dir must not target a Git directory: $log_dir"
    return 2
  fi
}

musi_verify_validate_gate_policy() {
  local policy_name="$1" key value
  if ! declare -p "$policy_name" 2>/dev/null | grep -q '^declare -A'; then
    musi_verify_gate_policy_error 'argument must name an associative array'
    return 2
  fi
  local -n policy_ref="$policy_name"
  local allowed=' label banner_label step_label wrapper_command repo_root lock_mode lock_path lock_already_held commit_queue_mode commit_queue_lock commit_queue_already_held commit_queue_timeout total_timeout warn_after marker_path marker_freshness cache_head_provider cache_fingerprint_provider run_head_provider run_fingerprint_provider final_fingerprint_provider marker_head_provider execution_mode consumer steps_array signal_mode failure_mode success_mode_provider log_dir history_dir marker_hit_hook marker_miss_hook pre_cache_admission_condition pre_cache_admission_hook bridge_predicate prepare_slots_hook after_slots_hook exit_hook '
  for key in "${!policy_ref[@]}"; do
    case "$allowed" in
      *" $key "*) ;;
      *) musi_verify_gate_policy_error "unknown field $key"; return 2 ;;
    esac
  done
  local required='label banner_label wrapper_command repo_root lock_mode lock_path lock_already_held commit_queue_mode commit_queue_already_held commit_queue_timeout total_timeout warn_after marker_path marker_freshness cache_head_provider cache_fingerprint_provider run_head_provider run_fingerprint_provider final_fingerprint_provider marker_head_provider execution_mode consumer steps_array signal_mode failure_mode success_mode_provider log_dir history_dir prepare_slots_hook'
  for key in $required; do
    value="${policy_ref[$key]:-}"
    [ -n "$value" ] || {
      musi_verify_gate_policy_error "missing field $key"
      return 2
    }
  done
  case "${policy_ref[lock_mode]}" in blocking|nonblocking) ;; *)
    musi_verify_gate_policy_error "unknown lock_mode ${policy_ref[lock_mode]}"; return 2 ;;
  esac
  case "${policy_ref[commit_queue_mode]}" in none|blocking) ;; *)
    musi_verify_gate_policy_error "unknown commit_queue_mode ${policy_ref[commit_queue_mode]}"; return 2 ;;
  esac
  case "${policy_ref[execution_mode]}" in serial|parallel) ;; *)
    musi_verify_gate_policy_error "unknown execution_mode ${policy_ref[execution_mode]}"; return 2 ;;
  esac
  for key in lock_already_held commit_queue_already_held; do
    case "${policy_ref[$key]}" in 0|1) ;; *)
      musi_verify_gate_policy_error "$key must be 0 or 1"; return 2 ;;
    esac
  done
  for key in commit_queue_timeout total_timeout warn_after marker_freshness; do
    case "${policy_ref[$key]}" in ''|*[!0-9]*)
      musi_verify_gate_policy_error "$key must be a whole number"; return 2 ;;
    esac
  done
  if [ "${policy_ref[commit_queue_mode]}" = blocking ] \
     && [ -z "${policy_ref[commit_queue_lock]:-}" ]; then
    musi_verify_gate_policy_error 'commit_queue_lock is required for blocking queue mode'
    return 2
  fi
  for key in cache_head_provider cache_fingerprint_provider run_head_provider \
    run_fingerprint_provider final_fingerprint_provider marker_head_provider \
    success_mode_provider prepare_slots_hook; do
    value="${policy_ref[$key]}"
    declare -F "$value" >/dev/null 2>&1 || {
      musi_verify_gate_policy_error "$key function is not defined: $value"
      return 2
    }
  done
  for key in marker_hit_hook marker_miss_hook pre_cache_admission_condition pre_cache_admission_hook bridge_predicate after_slots_hook exit_hook; do
    value="${policy_ref[$key]:-}"
    [ -z "$value" ] || declare -F "$value" >/dev/null 2>&1 || {
      musi_verify_gate_policy_error "$key function is not defined: $value"
      return 2
    }
  done
  musi_verify_validate_log_target "${policy_ref[repo_root]}" "${policy_ref[log_dir]}"
}
