#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_STEP_SUMMARY:?GITHUB_STEP_SUMMARY is required}"
: "${LINT_RATCHET_ARTIFACT_URL:?LINT_RATCHET_ARTIFACT_URL is required}"

diagnostics=".musi-ci-verify-logs/ratchet-diagnostics.json"
report_path="lint-ratchet-report.md"
artifact_url="$LINT_RATCHET_ARTIFACT_URL"

if [ ! -s "$diagnostics" ]; then
  {
    echo "<!-- lint-ratchet-summary -->"
    echo "### Lint ratchet"
    echo
    echo "Lint ratchet diagnostics envelope was not produced; the runner may have failed before emitting it."
    echo
    echo "Artifact: $artifact_url"
    echo "Recovery: see the failed run/artifact above; runner/formatter failure, not a baseline movement."
  } > "$report_path"
else
  report_stdout="$(mktemp)"
  report_stderr="$(mktemp)"
  if LINT_RATCHET_REPORT_ARTIFACT_URL="$artifact_url" \
    bun run lint:ratchet:report < "$diagnostics" > "$report_stdout" 2> "$report_stderr"; then
    mv "$report_stdout" "$report_path"
  else
    {
      echo "<!-- lint-ratchet-summary -->"
      echo "### Lint ratchet"
      echo
      echo "Lint ratchet diagnostics envelope was produced, but the report formatter failed."
      echo
      echo "Formatter output:"
      echo
      # Indent instead of fencing: a triple-backtick in the formatter
      # output would otherwise escape a ``` fence and inject markdown
      # into the step summary and PR comment. An indented block cannot
      # be broken by its own contents.
      sed 's/^/    /' "$report_stdout" "$report_stderr"
      echo
      echo "Artifact: $artifact_url"
      echo "Recovery: see the failed run/artifact above; runner/formatter failure, not a baseline movement."
    } > "$report_path"
  fi
  rm -f "$report_stdout" "$report_stderr"
fi

cat "$report_path" >> "$GITHUB_STEP_SUMMARY"
