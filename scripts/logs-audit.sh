#!/usr/bin/env bash
# logs-audit.sh — the `bun run logs:audit` entry point, and the env contract
# behind it.
#
# `--latest` needs the per-worktree verify and hook log directories.
# scripts/lib/verify-state-paths.sh owns the protocol that decides where those
# live, and scripts/lib/verify-metadata.sh is that protocol's public entry
# point, so this shim derives nothing: it sources the aggregator, asks the
# accessors, and exports the two names scripts/logs-audit.ts already reads.
# That is the transferable shape — a cross-language protocol survives as one
# implementation plus a total env contract at the process boundary, not as two
# implementations plus a keep-in-sync comment.
# scripts/tests/test-verify-metadata.sh pins the exported values to the
# accessor outputs.
#
# Only `--latest` needs the directories, so a `--file` run never sources the
# gate libs and never hashes the worktree identity. A raw
# `bun scripts/logs-audit.ts --latest` gets no contract and fails closed rather
# than guessing.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

logs_audit_wants_latest() {
  local arg
  for arg in "$@"; do
    if [ "$arg" = "--latest" ]; then
      return 0
    fi
  done
  return 1
}

if logs_audit_wants_latest "$@"; then
  # shellcheck source=scripts/lib/verify-metadata.sh
  . "$SCRIPT_DIR/lib/verify-metadata.sh"
  # Root selection belongs to the same owner as the rest of the protocol, so ask
  # for it rather than re-deriving a local variant here; resolving it once keeps
  # the two accessors consistent with each other. The accessors are
  # override-first, so an explicit MUSI_STANDARD_*_LOG_DIR round-trips through
  # this export untouched.
  LOGS_AUDIT_REPO_ROOT="$(musi_repo_root_for_state)"
  MUSI_STANDARD_VERIFY_LOG_DIR="$(musi_standard_verify_log_dir "$LOGS_AUDIT_REPO_ROOT")"
  MUSI_STANDARD_BUN_LOG_DIR="$(musi_standard_bun_log_dir "$LOGS_AUDIT_REPO_ROOT")"
  export MUSI_STANDARD_VERIFY_LOG_DIR MUSI_STANDARD_BUN_LOG_DIR
fi

exec bun "$SCRIPT_DIR/logs-audit.ts" "$@"
