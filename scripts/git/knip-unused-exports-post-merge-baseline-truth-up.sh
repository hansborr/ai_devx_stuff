#!/usr/bin/env bash
# Advisory post-merge truth-up for sensor-knip-unused-exports.baseline.json.
set -uo pipefail

STALE_BASELINE_INSTRUCTION="post-merge: merge produced a stale knip unused-export baseline - run: bun scripts/sensor-knip-unused-exports.ts --update, review the diff against both parents, then git commit --amend"

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$repo_root" || exit 0

git rev-parse --verify 'ORIG_HEAD^{commit}' >/dev/null 2>&1 || exit 0

if ! git diff --name-only ORIG_HEAD HEAD -- sensor-knip-unused-exports.baseline.json \
    | grep -qx 'sensor-knip-unused-exports.baseline.json'; then
  exit 0
fi

# GUI git clients and minimal shells may not have bun on PATH. Stay silent
# rather than reporting an environment gap as baseline staleness.
command -v bun >/dev/null 2>&1 || exit 0

check_status=0
bun run sensor:knip-unused-exports >/dev/null 2>&1 || check_status=$?
# sensor:knip-unused-exports uses 1 for baseline mismatch and 2 for
# operational errors; only the former proves a stale merged baseline.
if [ "$check_status" -eq 1 ]; then
  printf '%s\n' "$STALE_BASELINE_INSTRUCTION" >&2
fi

exit 0
