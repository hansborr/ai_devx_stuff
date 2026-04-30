#!/bin/sh
# Shared hot-doc length policy. Keep this file POSIX-safe: Husky runs hooks
# through `sh`, while AI hook adapters may source it from Bash.

musi_doc_length_set_rule() {
  case "$1" in
    */docs/agent_notes/STATUS.md)
      MUSI_DOC_LENGTH_THRESHOLD=120
      MUSI_DOC_LENGTH_GUIDANCE="STATUS.md is a one-page snapshot, not a log. Keep only current state and move durable history to LOG.md, DECISIONS.md, or a small finished_work note. Target: ~50-80 lines."
      ;;
    */docs/agent_notes/NEXT.md)
      MUSI_DOC_LENGTH_THRESHOLD=150
      MUSI_DOC_LENGTH_GUIDANCE="NEXT.md should stay scannable. Drop items that are no longer relevant, keep each tier terse, and link to docs/roadmap/*.md rather than duplicating scope here. Target: ~50-100 lines."
      ;;
    */docs/agent_notes/README.md)
      MUSI_DOC_LENGTH_THRESHOLD=150
      MUSI_DOC_LENGTH_GUIDANCE="agent_notes/README.md documents the folder structure - keep it concise. Move procedural detail into AGENTS.md or STATUS.md if it is growing."
      ;;
    */docs/agent_notes/finished_work/README.md)
      MUSI_DOC_LENGTH_THRESHOLD=80
      MUSI_DOC_LENGTH_GUIDANCE="finished_work/README.md should stay a short archive policy. Do not recreate a large historical index."
      ;;
    */docs/agent_notes/DECISIONS.md)
      MUSI_DOC_LENGTH_THRESHOLD=400
      MUSI_DOC_LENGTH_GUIDANCE="DECISIONS.md records non-obvious design choices and the why behind them - do not trim entries, the reasoning is the asset. Split by domain instead and leave DECISIONS.md as an index. Superseded decisions move to DECISIONS_ARCHIVE.md with a 'Superseded by' link, not deletion."
      ;;
    */docs/agent_notes/decisions-*.md)
      MUSI_DOC_LENGTH_THRESHOLD=400
      MUSI_DOC_LENGTH_GUIDANCE="Per-domain decisions files share the DECISIONS.md split-not-trim policy: do not trim entries, the reasoning is the asset. If a domain file outgrows the threshold, split it further (e.g. by sub-domain) and update DECISIONS.md's index. Superseded decisions move to DECISIONS_ARCHIVE.md with a 'Superseded by' link, not deletion."
      ;;
    */docs/agent_notes/in_progress/*.md)
      MUSI_DOC_LENGTH_THRESHOLD=300
      MUSI_DOC_LENGTH_GUIDANCE="in_progress notes capture mid-flight decisions and gotchas. If one is crossing 300 lines, split it, lift cross-cutting decisions into a canonical doc, or prune detail recoverable from code and commits."
      ;;
    */AGENTS.md)
      MUSI_DOC_LENGTH_THRESHOLD=250
      MUSI_DOC_LENGTH_GUIDANCE="AGENTS.md is loaded into every agent session's context. Keep it tight - push detail into linked docs rather than inlining it here."
      ;;
    */CLAUDE.md)
      MUSI_DOC_LENGTH_THRESHOLD=250
      MUSI_DOC_LENGTH_GUIDANCE="CLAUDE.md should stay a thin Claude-specific wrapper. Move shared instructions into AGENTS.md and detailed guidance into linked docs."
      ;;
    *)
      return 1
      ;;
  esac
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
  [ "$lines" -gt "$MUSI_DOC_LENGTH_THRESHOLD" ] || return 1

  base=${file##*/}
  printf "doc-length: %s is %s lines (threshold: %s). %s Trim it now as part of this work - every future agent session may read this file." \
    "$base" "$lines" "$MUSI_DOC_LENGTH_THRESHOLD" "$MUSI_DOC_LENGTH_GUIDANCE"
}

musi_doc_length_advisory() {
  file="$1"
  [ -f "$file" ] || return 1

  lines=$(wc -l < "$file" 2>/dev/null | tr -d ' ')
  musi_doc_length_advisory_for_count "$file" "$lines"
}
