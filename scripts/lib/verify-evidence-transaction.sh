#!/usr/bin/env bash
# Live verification-evidence transaction for the shared verification engine.
#
# Owns log-tree setup plus the backup, staging, displacement, rollback,
# registration preservation, restoration, publication, and final cleanup state
# used while pre-cache admission temporarily replaces live evidence.
#
# Source order: after scripts/lib/verify-policy-validation.sh. This leaf calls
# musi_verify_gate_trace_event at invocation time; the facade defines that
# orchestration hook after sourcing its leaves. Consumers must source
# scripts/lib/verify-engine.sh, which re-exports the complete engine API.

MUSI_VERIFY_GATE_LIVE_EVIDENCE_BACKUP=""
MUSI_VERIFY_GATE_LIVE_EVIDENCE_LOG_DIR=""
MUSI_VERIFY_GATE_PRIOR_EVIDENCE_RESTORED=0
MUSI_VERIFY_GATE_REGISTRATION_CAPTURED=0
MUSI_VERIFY_GATE_EVIDENCE_SWAP_COMPLETE=0
MUSI_VERIFY_GATE_EVIDENCE_STAGING_DIR=""
MUSI_VERIFY_GATE_EVIDENCE_DISPLACED_DIR=""

musi_verify_gate_setup_logs() {
  local policy_name="$1"
  local -n policy_ref="$policy_name"
  musi_verify_gate_remove_tree "${policy_ref[log_dir]}" || return 2
  mkdir -p "${policy_ref[log_dir]}/meta" || return 2
  musi_verify_gate_trace_event log-setup
}

musi_verify_gate_remove_tree() {
  rm -rf -- "$1"
}

musi_verify_gate_move_tree() {
  mv -- "$1" "$2"
}

musi_verify_gate_discard_live_evidence_backup() {
  [ -n "$MUSI_VERIFY_GATE_LIVE_EVIDENCE_BACKUP" ] || return 0
  musi_verify_gate_remove_tree "$MUSI_VERIFY_GATE_LIVE_EVIDENCE_BACKUP" || return 2
  MUSI_VERIFY_GATE_LIVE_EVIDENCE_BACKUP=""
  MUSI_VERIFY_GATE_LIVE_EVIDENCE_LOG_DIR=""
  MUSI_VERIFY_GATE_REGISTRATION_CAPTURED=0
  MUSI_VERIFY_GATE_EVIDENCE_SWAP_COMPLETE=0
  MUSI_VERIFY_GATE_EVIDENCE_STAGING_DIR=""
  MUSI_VERIFY_GATE_EVIDENCE_DISPLACED_DIR=""
}

musi_verify_gate_backup_live_evidence() {
  local policy_name="$1"
  local -n policy_ref="$policy_name"
  local backup

  musi_verify_gate_discard_live_evidence_backup || return 2
  backup=$(mktemp -d "${TMPDIR:-/tmp}/musi-verify-live-evidence.XXXXXX") || return 2
  mkdir -p "$backup/evidence" || {
    musi_verify_gate_remove_tree "$backup" || true
    return 2
  }
  if [ -d "${policy_ref[log_dir]}" ]; then
    cp -a -- "${policy_ref[log_dir]}/." "$backup/evidence/" || {
      musi_verify_gate_remove_tree "$backup" || true
      return 2
    }
  fi
  MUSI_VERIFY_GATE_LIVE_EVIDENCE_BACKUP="$backup"
  # shellcheck disable=SC2034 # Read by lifecycle cleanup in the engine facade.
  MUSI_VERIFY_GATE_LIVE_EVIDENCE_LOG_DIR="${policy_ref[log_dir]}"
  MUSI_VERIFY_GATE_PRIOR_EVIDENCE_RESTORED=0
  MUSI_VERIFY_GATE_REGISTRATION_CAPTURED=0
  MUSI_VERIFY_GATE_EVIDENCE_SWAP_COMPLETE=0
  MUSI_VERIFY_GATE_EVIDENCE_STAGING_DIR=""
  MUSI_VERIFY_GATE_EVIDENCE_DISPLACED_DIR=""
  musi_verify_gate_trace_event evidence-backup
}

musi_verify_gate_restore_live_evidence_dir() {
  local log_dir="$1"
  local backup="$MUSI_VERIFY_GATE_LIVE_EVIDENCE_BACKUP"
  local registration_backup="$backup/admission-registration.log"
  local staging displaced rollback_rc=0

  [ -n "$backup" ] || return 0
  [ -n "$log_dir" ] || return 2

  if [ "$MUSI_VERIFY_GATE_REGISTRATION_CAPTURED" -eq 0 ]; then
    if [ -f "$log_dir/registration.log" ]; then
      cp -p -- "$log_dir/registration.log" "$registration_backup" || return 2
    fi
    MUSI_VERIFY_GATE_REGISTRATION_CAPTURED=1
  fi

  if [ "$MUSI_VERIFY_GATE_EVIDENCE_SWAP_COMPLETE" -eq 0 ]; then
    if [ -n "$MUSI_VERIFY_GATE_EVIDENCE_STAGING_DIR" ]; then
      musi_verify_gate_remove_tree "$MUSI_VERIFY_GATE_EVIDENCE_STAGING_DIR" || return 2
      MUSI_VERIFY_GATE_EVIDENCE_STAGING_DIR=""
    fi
    staging=$(mktemp -d "${log_dir}.restore.XXXXXX") || return 2
    MUSI_VERIFY_GATE_EVIDENCE_STAGING_DIR="$staging"
    if [ -d "$backup/evidence" ]; then
      cp -a -- "$backup/evidence/." "$staging/" || {
        if musi_verify_gate_remove_tree "$staging"; then
          MUSI_VERIFY_GATE_EVIDENCE_STAGING_DIR=""
        fi
        return 2
      }
    fi
    if [ -f "$registration_backup" ]; then
      cp -p -- "$registration_backup" "$staging/registration.log" || {
        if musi_verify_gate_remove_tree "$staging"; then
          MUSI_VERIFY_GATE_EVIDENCE_STAGING_DIR=""
        fi
        return 2
      }
    fi

    displaced="$staging.displaced"
    if [ -e "$log_dir" ] || [ -L "$log_dir" ]; then
      musi_verify_gate_move_tree "$log_dir" "$displaced" || {
        if musi_verify_gate_remove_tree "$staging"; then
          MUSI_VERIFY_GATE_EVIDENCE_STAGING_DIR=""
        fi
        return 2
      }
      MUSI_VERIFY_GATE_EVIDENCE_DISPLACED_DIR="$displaced"
    fi
    if ! musi_verify_gate_move_tree "$staging" "$log_dir"; then
      if [ -n "$MUSI_VERIFY_GATE_EVIDENCE_DISPLACED_DIR" ]; then
        musi_verify_gate_move_tree "$displaced" "$log_dir" || rollback_rc=$?
        [ "$rollback_rc" -ne 0 ] || MUSI_VERIFY_GATE_EVIDENCE_DISPLACED_DIR=""
      fi
      if musi_verify_gate_remove_tree "$staging"; then
        MUSI_VERIFY_GATE_EVIDENCE_STAGING_DIR=""
      fi
      return 2
    fi
    MUSI_VERIFY_GATE_EVIDENCE_STAGING_DIR=""
    MUSI_VERIFY_GATE_EVIDENCE_SWAP_COMPLETE=1
  fi

  if [ -n "$MUSI_VERIFY_GATE_EVIDENCE_DISPLACED_DIR" ]; then
    musi_verify_gate_remove_tree "$MUSI_VERIFY_GATE_EVIDENCE_DISPLACED_DIR" || return 2
    MUSI_VERIFY_GATE_EVIDENCE_DISPLACED_DIR=""
  fi
  musi_verify_gate_discard_live_evidence_backup || return 2
  # shellcheck disable=SC2034 # Read by signal handling and orchestration in the engine facade.
  MUSI_VERIFY_GATE_PRIOR_EVIDENCE_RESTORED=1
  musi_verify_gate_trace_event evidence-restore
}

musi_verify_gate_restore_live_evidence() {
  local policy_name="$1"
  local -n policy_ref="$policy_name"
  musi_verify_gate_restore_live_evidence_dir "${policy_ref[log_dir]}"
}
