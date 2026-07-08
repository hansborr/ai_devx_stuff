#!/usr/bin/env bash
# Advisory post-merge truth-up for sensor-knip-unused-exports.baseline.json.
set -uo pipefail

STALE_BASELINE_INSTRUCTION="post-merge: merge produced a stale knip unused-export baseline - run: bun scripts/sensor-knip-unused-exports.ts --update, review the diff against both parents, then git commit --amend"
# A plain textual git merge of the v2 identity baseline (a ~200-entry JSON list
# plus a derived summary) can combine disjoint entry additions/deletions from
# both sides while keeping one side's now-stale summary. The sensor then rejects
# the committed baseline as internally inconsistent and the floor is silently
# off. Report that loudly with concrete repair guidance.
CORRUPT_BASELINE_INSTRUCTION="post-merge: the merged knip unused-export baseline is unparseable or internally inconsistent - a plain textual merge combined disjoint identity changes with a stale summary, so the knip unused-export floor is now silently disabled. Repair: bun scripts/sensor-knip-unused-exports.ts --update, then diff against both parents (git diff HEAD -- sensor-knip-unused-exports.baseline.json; git diff MERGE_HEAD -- sensor-knip-unused-exports.baseline.json) and git commit --amend. Durable fix: resolve the baseline with the semantic merge CLI (bun scripts/sensor-knip-unused-exports-merge-cli.ts) instead of a textual merge."

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
output=$(bun run sensor:knip-unused-exports 2>&1) || check_status=$?
# The sensor exits 1 for a baseline mismatch (a stale merged baseline) and 2 for
# errors. Exit 2 covers both a broken merged baseline (an `ERROR: baseline ...`
# parse/integrity failure that would otherwise be invisible) and a transient
# knip-run failure (`ERROR: knip ...`, e.g. the tool is unavailable). Only the
# former is a merge defect. Match the integrity marker on its own line: `bun run`
# echoes the script command and the sensor prints a knip self-scan heartbeat
# before parsing the baseline, so the `ERROR: baseline` line is not the first
# line of the captured output. Stay silent on the transient case, mirroring the
# missing-bun guard above.
if [ "$check_status" -eq 1 ]; then
  printf '%s\n' "$STALE_BASELINE_INSTRUCTION" >&2
elif [ "$check_status" -eq 2 ] && printf '%s\n' "$output" | grep -qE '^ERROR: baseline'; then
  printf '%s\n' "$CORRUPT_BASELINE_INSTRUCTION" >&2
fi

exit 0
