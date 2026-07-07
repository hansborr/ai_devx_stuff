#!/usr/bin/env bash
# Run the suppression policy registers as one commit-gate slot.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  printf 'WARN: suppression policy registers unavailable — not inside a git repository\n' >&2
  exit 0
}

bash "$REPO_ROOT/scripts/eslint-disable-register.sh" "$REPO_ROOT"
bash "$REPO_ROOT/scripts/suppression-register.sh" "$REPO_ROOT"
