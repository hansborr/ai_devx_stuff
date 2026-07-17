#!/bin/bash
# Advisory backlog-note front-matter lint for agent edit/write hooks. When an
# agent writes or edits a note under docs/agent_notes/backlog, surface the
# file-scoped `backlog:lint` findings (missing/empty Status, missing/invalid
# Date, stale dates) as non-blocking PostToolUse context so new notes are born
# clean. Report-only: it never blocks the edit and stays silent when the note
# is clean, is outside the backlog tree, or no longer exists on disk.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || git rev-parse --show-toplevel 2>/dev/null || echo "${CLAUDE_PROJECT_DIR:-/workspace}")
# shellcheck source=/dev/null
. "$SCRIPT_DIR/common.sh"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/edited-paths.sh"

# Absolute directory an edited note must live under to be in scope. Overridable
# so the wiring tests can point it at a fixture tree instead of the live repo.
AI_BACKLOG_NOTES_DIR="${AI_BACKLOG_NOTES_DIR:-$REPO_ROOT/docs/agent_notes/backlog}"

# The report-only lint prints this header only when it has findings; the clean
# path prints a `backlog:lint OK ...` line we must not surface.
AI_BACKLOG_LINT_FINDINGS_HEADER="backlog:lint advisory findings"

# Is $1 (an absolute path) a markdown note under the backlog tree? `case` globs
# treat `*` as matching `/`, so a single `*` spans nested pack directories; the
# trailing `/` after the dir keeps sibling trees (e.g. backlog-archive) out.
ai_backlog_note_in_scope() {
  case "$1" in
    "$AI_BACKLOG_NOTES_DIR"/*.md) return 0 ;;
    *) return 1 ;;
  esac
}

ai_backlog_note_hook_main() {
  local payload path abs findings
  local -A seen=()
  local -a lint_args=()

  payload=$(ai_read_payload)

  while IFS= read -r path; do
    [ -n "$path" ] || continue
    abs=$(ai_resolve_edited_payload_path "$payload" "$path" "$REPO_ROOT")
    [ -n "${seen[$abs]+x}" ] && continue
    seen[$abs]=1
    ai_backlog_note_in_scope "$abs" || continue
    lint_args+=(--file "$abs")
  done < <(ai_edited_payload_paths "$payload")

  # No in-scope backlog note edited: this is the hot path for every non-backlog
  # edit, so return before paying for a bun spawn.
  [ "${#lint_args[@]}" -gt 0 ] || ai_emit_continue

  # File mode lints only the named paths with strict front-matter checks, skips
  # nonexistent/non-.md paths silently, and always exits 0 (barring usage
  # error), so a deleted or renamed-away note simply yields the clean header. A
  # bun failure leaves $findings empty, so the header check below stays silent.
  cd "$REPO_ROOT" || ai_emit_continue
  findings=$(
    bun run scripts/backlog-lint.ts \
      --backlog-dir "$AI_BACKLOG_NOTES_DIR" \
      "${lint_args[@]}" \
      2>/dev/null
  )

  case "$findings" in
    "$AI_BACKLOG_LINT_FINDINGS_HEADER"*)
      ai_emit_additional_context "PostToolUse" "$(ai_limit_lines "$findings" 60)"
      ;;
  esac

  ai_emit_continue
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  ai_backlog_note_hook_main
fi
