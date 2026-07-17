#!/usr/bin/env bash
# Marks and OOM-biases a command whose parent already owns memory admission.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./memory-budget.sh
. "$SCRIPT_DIR/memory-budget.sh"

if ! musi_memory_budget_reservation_is_live \
  "${MUSI_VERIFY_MEMORY_ADMISSION_TOKEN:-}"; then
  unset MUSI_VERIFY_MEMORY_ADMISSION_TOKEN
fi
musi_memory_raise_oom_score
exec "$@"
