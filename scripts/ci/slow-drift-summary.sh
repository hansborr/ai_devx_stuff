#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_STEP_SUMMARY:?GITHUB_STEP_SUMMARY is required}"

report="reports/slow-drift/fused/harness-audit.txt"
if [ -s "$report" ]; then
  {
    echo "### Slow drift audit"
    echo
    cat "$report"
  } >> "$GITHUB_STEP_SUMMARY"
else
  {
    echo "### Slow drift audit"
    echo
    echo "No fused report was produced. Check the producer-output artifact for tool or setup errors."
  } >> "$GITHUB_STEP_SUMMARY"
fi
timings="reports/slow-drift/fused/timings.txt"
if [ -s "$timings" ]; then
  {
    echo
    echo "#### Step timings (trend evidence, report-only)"
    echo
    echo '```'
    grep -E '^timing: ' "$timings" || echo "no steps recorded"
    echo '```'
  } >> "$GITHUB_STEP_SUMMARY"
fi
survivors="reports/slow-drift/fused/mutation-survivors.txt"
if [ -s "$survivors" ]; then
  {
    echo
    echo "#### Mutation survivors (trend evidence, report-only)"
    echo
    echo '```'
    cat "$survivors"
    echo '```'
  } >> "$GITHUB_STEP_SUMMARY"
fi
