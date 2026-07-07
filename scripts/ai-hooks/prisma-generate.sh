#!/bin/bash
# Post-edit Prisma client generation for hook adapters that expose file writes.

set -u

HOOK_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT=$(git -C "$HOOK_LIB" rev-parse --show-toplevel 2>/dev/null || git rev-parse --show-toplevel 2>/dev/null || echo "${CLAUDE_PROJECT_DIR:-/workspace}")
# shellcheck source=/dev/null
. "$HOOK_LIB/common.sh"
# shellcheck source=/dev/null
. "$HOOK_LIB/edited-paths.sh"
# cache.sh owns the AI_STATE_ROOT default; source it instead of re-declaring
# the literal here so the prisma state cannot drift to a different root.
# shellcheck source=/dev/null
. "$HOOK_LIB/cache.sh"

PAYLOAD=$(ai_read_payload)
FILE=""
RESOLVED_FILE=""
SCHEMA_EDITED=0

while IFS= read -r FILE; do
  [ -n "$FILE" ] || continue
  RESOLVED_FILE=$(ai_resolve_edited_payload_path "$PAYLOAD" "$FILE" "$REPO_ROOT")
  case "$RESOLVED_FILE" in
    */prisma/schema.prisma)
      SCHEMA_EDITED=1
      break
      ;;
  esac
done < <(ai_edited_payload_paths "$PAYLOAD")

[ "$SCHEMA_EDITED" -eq 1 ] || ai_emit_continue

SCHEMA="$REPO_ROOT/packages/server/prisma/schema.prisma"
[ -f "$SCHEMA" ] || ai_emit_continue

AI_PRISMA_STATE_DIR="${AI_PRISMA_STATE_DIR:-$AI_STATE_ROOT/prisma}"
MARKER="${AI_PRISMA_MARKER:-$AI_PRISMA_STATE_DIR/last}"
LOG="${AI_PRISMA_LOG:-$AI_PRISMA_STATE_DIR/generate.log}"
CUR_HASH=$(sha256sum "$SCHEMA" | awk '{print $1}')

is_debounced() {
  [ -f "$MARKER" ] || return 1
  local last_ts=0 last_hash=""
  while IFS='=' read -r k v; do
    case "$k" in
      LAST_TS) last_ts=$v ;;
      LAST_HASH) last_hash=$v ;;
    esac
  done < "$MARKER"
  local now
  now=$(date +%s)
  [ "$((now - last_ts))" -lt 30 ] && [ "$last_hash" = "$CUR_HASH" ]
}

if is_debounced; then
  ai_emit_continue
fi

LOCK="${AI_PRISMA_LOCK:-$AI_PRISMA_STATE_DIR/lock}"

prisma_lock_failure() {
  local action="$1"
  local detail="$2"

  REASON="prisma generate skipped after schema edit because the hook could not $action lock $LOCK.

$detail

Fix the lock path or filesystem support before continuing; running prisma generate without mutual exclusion can race the shared marker and log files."
  ai_emit_block "$REASON"
}

mkdir -p "$AI_PRISMA_STATE_DIR" \
  || prisma_lock_failure "prepare state directory for" "State directory: $AI_PRISMA_STATE_DIR"
if ! { exec 9<>"$LOCK"; } 2>/dev/null; then
  prisma_lock_failure "open" "The lock file could not be opened for read/write."
fi
if ! flock 9 2>/dev/null; then
  prisma_lock_failure "acquire" "The flock command failed for the opened lock file."
fi

if is_debounced; then
  ai_emit_continue
fi

cd "$REPO_ROOT" || exit 1
if bun run --filter @musi/server prisma:generate > "$LOG" 2>&1 9>&-; then
  {
    printf 'LAST_TS=%s\n' "$(date +%s)"
    printf 'LAST_HASH=%s\n' "$CUR_HASH"
  } > "$MARKER"
  printf 'prisma-generate: OK after schema edit (log: %s)\n' "$LOG" >&2
  ai_emit_continue
fi

TAIL=$(tail -n 20 "$LOG" 2>/dev/null)
REASON="prisma generate FAILED after schema edit. Fix the schema before continuing - typecheck/test will otherwise fail with stale-client errors.

Full log: $LOG

--- last 20 lines ---
$TAIL"
ai_emit_block "$REASON"
