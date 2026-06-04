#!/bin/sh
# Shared hot-doc length policy. Keep this file POSIX-safe: Husky runs hooks
# through `sh`, while AI hook adapters may source it from Bash.

musi_doc_length_set_rule() {
  case "$1" in
    */docs/agent_notes/README.md)
      MUSI_DOC_LENGTH_BUDGET=150
      MUSI_DOC_LENGTH_SURFACE=commit
      MUSI_DOC_LENGTH_GUIDANCE="agent_notes/README.md documents the folder structure - keep it concise. Move procedural detail into AGENTS.md or linked guides if it is growing."
      ;;
    */docs/agent_notes/finished_work/README.md)
      MUSI_DOC_LENGTH_BUDGET=80
      MUSI_DOC_LENGTH_SURFACE=commit
      MUSI_DOC_LENGTH_GUIDANCE="finished_work/README.md should stay a short archive policy. Do not recreate a large historical index."
      ;;
    */docs/agent_notes/DECISIONS.md)
      MUSI_DOC_LENGTH_BUDGET=400
      MUSI_DOC_LENGTH_SURFACE=commit
      MUSI_DOC_LENGTH_GUIDANCE="DECISIONS.md records non-obvious design choices and the why behind them - do not trim entries, the reasoning is the asset. Split by domain instead and leave DECISIONS.md as an index. For superseded decisions, add a short superseded note with a link to the replacement rather than deleting reasoning."
      ;;
    */docs/agent_notes/decisions-*.md)
      MUSI_DOC_LENGTH_BUDGET=400
      MUSI_DOC_LENGTH_SURFACE=commit
      MUSI_DOC_LENGTH_GUIDANCE="Per-domain decisions files share the DECISIONS.md split-not-trim policy: do not trim entries, the reasoning is the asset. If a domain file outgrows the budget, split it further by sub-domain and update DECISIONS.md's index. For superseded decisions, add a short superseded note with a link to the replacement rather than deleting reasoning."
      ;;
    */docs/agent_notes/in_progress/*.md)
      MUSI_DOC_LENGTH_BUDGET=300
      MUSI_DOC_LENGTH_SURFACE=commit
      MUSI_DOC_LENGTH_GUIDANCE="in_progress notes can be long while work is active. Before landing durable work, split or summarize this note, lift cross-cutting decisions into canonical docs, or delete/archive it if it was only temporary scratch context."
      ;;
    AGENTS.md|*/AGENTS.md)
      MUSI_DOC_LENGTH_BUDGET=250
      MUSI_DOC_LENGTH_SURFACE=edit
      MUSI_DOC_LENGTH_GUIDANCE="AGENTS.md is loaded into every agent session's context. Keep it compact now by pushing detail into linked docs rather than inlining it here."
      ;;
    CLAUDE.md|*/CLAUDE.md)
      MUSI_DOC_LENGTH_BUDGET=250
      MUSI_DOC_LENGTH_SURFACE=edit
      MUSI_DOC_LENGTH_GUIDANCE="CLAUDE.md should stay a thin Claude-specific wrapper. Move shared instructions into AGENTS.md and detailed guidance into linked docs."
      ;;
    *)
      return 1
      ;;
  esac

}

musi_doc_length_rule_surface() {
  musi_doc_length_set_rule "$1" || return 1
  printf '%s' "$MUSI_DOC_LENGTH_SURFACE"
}

musi_doc_length_advisory_for_count() {
  file="$1"
  lines="$2"

  musi_doc_length_set_rule "$file" || return 1
  case "$lines" in
    ''|*[!0-9]*)
      return 1
      ;;
  esac
  [ "$lines" -gt "$MUSI_DOC_LENGTH_BUDGET" ] || return 1

  base=${file##*/}
  printf "doc-length advisory (not a blocker): %s is %s lines (budget: %s). %s" \
    "$base" "$lines" "$MUSI_DOC_LENGTH_BUDGET" "$MUSI_DOC_LENGTH_GUIDANCE"
}

musi_doc_length_advisory() {
  file="$1"
  [ -f "$file" ] || return 1

  lines=$(wc -l < "$file" 2>/dev/null | tr -d ' ')
  musi_doc_length_advisory_for_count "$file" "$lines"
}
