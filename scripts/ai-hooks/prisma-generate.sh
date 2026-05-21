#!/bin/bash
# Post-edit Prisma client generation for hook adapters that expose file writes.

set -u

HOOK_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT=$(git -C "$HOOK_LIB" rev-parse --show-toplevel 2>/dev/null || git rev-parse --show-toplevel 2>/dev/null || echo "${CLAUDE_PROJECT_DIR:-/workspace}")
# shellcheck source=/dev/null
. "$HOOK_LIB/common.sh"

PAYLOAD=$(ai_read_payload)
FILE=$(ai_payload_file_path "$PAYLOAD")

case "$FILE" in
  */prisma/schema.prisma) ;;
  *) ai_emit_continue ;;
esac

SCHEMA="$REPO_ROOT/packages/server/prisma/schema.prisma"
[ -f "$SCHEMA" ] || ai_emit_continue

MARKER=/tmp/musi-prisma-generate.last
LOG=/tmp/musi-prisma-generate.log
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

LOCK=/tmp/musi-prisma-generate.lock
exec 9<>"$LOCK"
flock 9

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
