#!/usr/bin/env bash
# migration-safety-scan.sh — Prisma migration safety scanner (DX8.1a/b).
#
# Scans Prisma SQL migrations for destructive operations that need a human
# review before they ship: column/table drops, ALTER COLUMN ... TYPE
# narrowing, and ADD COLUMN ... NOT NULL without a DEFAULT. Surfaces each
# finding with the exact migration filename, line number, the offending
# statement, and one-line risk guidance. Warn-only by design.
#
# Usage:
#   bash scripts/migration-safety-scan.sh                # scan every migration
#   bash scripts/migration-safety-scan.sh PATH ...       # scan specific
#                                                          migration dirs or
#                                                          .sql files
#
# Exit codes:
#   0  always (warn-only). DX8.1b surfaces this through `doctor`; it does
#      not gate commits or CI yet.
#
# Detection notes:
#   - Patterns are line-based. Prisma's emitted SQL keeps each statement
#     clause on its own line, so multi-line ALTER TABLE blocks (e.g.
#     "ALTER TABLE x\n  ALTER COLUMN a TYPE ...,\n  ALTER COLUMN b TYPE ...")
#     still report one finding per clause.
#   - "ADD COLUMN ... NOT NULL" only flags lines without DEFAULT on the same
#     line. The safe multi-step pattern (add nullable, backfill, then set
#     NOT NULL) does not match this rule and is not flagged.
#   - DROP TABLE matches statement-leading occurrences, including
#     `DROP TABLE IF EXISTS`.
#
# Acknowledgement (DX8.1b escape hatch):
#   - Migrations whose destructive operations have been intentionally
#     reviewed and accepted can be listed in
#     `packages/server/prisma/migrations/.safety-acknowledged` (one
#     directory name per non-comment line, optional reason after the first
#     whitespace). Findings in those migrations are emitted as `INFO: ...
#     (acknowledged: <reason>)` instead of `WARN:`, so `doctor` does not
#     re-flag already-reviewed history. Override the path with
#     `MUSI_MIGRATION_ALLOWLIST=<file>` for tests or alternate workflows.
#   - Allowlist entries that do not name a migration directory next to
#     the allowlist file are reported as stale: each gets its own
#     `WARN: <allowlist>:<line> — ...` line plus a final summary `WARN:`,
#     so a typo or a removed migration cannot silently linger.

set -uo pipefail

# `git rev-parse` is only used to resolve the default migrations directory
# and to shorten paths in the output. Explicit PATH arguments work outside a
# git repository (useful for tests that point the scanner at a sandbox).
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
DEFAULT_MIGRATIONS_DIR="${REPO_ROOT:+$REPO_ROOT/packages/server/prisma/migrations}"
DEFAULT_ALLOWLIST="${REPO_ROOT:+$REPO_ROOT/packages/server/prisma/migrations/.safety-acknowledged}"
ALLOWLIST_FILE="${MUSI_MIGRATION_ALLOWLIST:-$DEFAULT_ALLOWLIST}"

usage() {
  cat <<'EOF'
usage: migration-safety-scan.sh [PATH ...]

Scans Prisma SQL migrations for destructive operations:
  - DROP TABLE
  - DROP COLUMN
  - ALTER COLUMN ... TYPE (potential type narrowing)
  - ADD COLUMN ... NOT NULL without DEFAULT

PATH may be a migration directory (containing migration.sql), a single
.sql file, or the migrations root. With no arguments the scanner walks
packages/server/prisma/migrations.

The scanner is warn-only and always exits 0.
EOF
}

case "${1:-}" in
  -h|--help)
    usage
    exit 0
    ;;
esac

# --- collect target migration.sql files ------------------------------------

declare -a SQL_FILES=()

collect_dir() {
  local dir="$1"
  local entry
  # Walk one level deep: each migration lives in its own subdirectory
  # alongside a `migration.sql` file. Also accept a direct migration dir.
  if [ -f "$dir/migration.sql" ]; then
    SQL_FILES+=("$dir/migration.sql")
    return
  fi
  for entry in "$dir"/*/migration.sql; do
    [ -f "$entry" ] || continue
    SQL_FILES+=("$entry")
  done
}

if [ "$#" -eq 0 ]; then
  if [ -z "$DEFAULT_MIGRATIONS_DIR" ]; then
    printf 'FAIL: no PATH argument and not inside a git repository — pass a migration directory or .sql file\n' >&2
    exit 1
  fi
  if [ ! -d "$DEFAULT_MIGRATIONS_DIR" ]; then
    printf 'WARN: no migrations directory at %s — nothing to scan\n' \
      "$DEFAULT_MIGRATIONS_DIR" >&2
    exit 0
  fi
  collect_dir "$DEFAULT_MIGRATIONS_DIR"
else
  for target in "$@"; do
    if [ -d "$target" ]; then
      collect_dir "$target"
    elif [ -f "$target" ]; then
      SQL_FILES+=("$target")
    else
      printf 'WARN: not a file or directory, skipping: %s\n' "$target" >&2
    fi
  done
fi

if [ "${#SQL_FILES[@]}" -eq 0 ]; then
  printf 'INFO: no migration.sql files found\n'
  exit 0
fi

# --- acknowledgement allowlist --------------------------------------------
# Each non-comment, non-empty line names a migration directory whose
# destructive operations have been reviewed and accepted. The optional
# reason after the first whitespace is included in the rendered INFO
# line so doctor's output stays self-explaining.

declare -A ACK_REASONS=()
declare -A ACK_LINENO=()

if [ -n "$ALLOWLIST_FILE" ] && [ -f "$ALLOWLIST_FILE" ]; then
  lineno=0
  while IFS= read -r raw_line || [ -n "$raw_line" ]; do
    lineno=$((lineno + 1))
    line="${raw_line%$'\r'}"
    trimmed="${line#"${line%%[![:space:]]*}"}"
    [ -z "$trimmed" ] && continue
    case "$trimmed" in
      \#*) continue ;;
    esac
    name="${trimmed%%[[:space:]]*}"
    reason_raw="${trimmed#"$name"}"
    reason="${reason_raw#"${reason_raw%%[![:space:]]*}"}"
    [ -z "$name" ] && continue
    ACK_REASONS["$name"]="$reason"
    ACK_LINENO["$name"]="$lineno"
  done < "$ALLOWLIST_FILE"
fi

# --- scanner ---------------------------------------------------------------

# Each finding line is "RELPATH<TAB>LINENO<TAB>RULE<TAB>SNIPPET" for stable
# parsing in tests. The human-friendly block is rendered after the loop.
TMP_FINDINGS="$(mktemp)"
trap 'rm -f "$TMP_FINDINGS"' EXIT

# `relpath` shortens absolute paths under the repo root for readable output
# without breaking tests that pass a sandbox path. The empty-REPO_ROOT guard
# matters when the scanner is invoked outside a git repository: an unguarded
# `${p#"$REPO_ROOT/"}` would strip the leading `/` from every absolute path.
relpath() {
  local p="$1"
  if [ -n "$REPO_ROOT" ] && [[ "$p" == "$REPO_ROOT/"* ]]; then
    printf '%s' "${p#"$REPO_ROOT/"}"
  else
    printf '%s' "$p"
  fi
}

scan_file() {
  local file="$1"
  local rel
  rel="$(relpath "$file")"

  # The four detection rules. Each emits zero or more findings; line numbers
  # come from grep -n. Awk handles the SNIPPET trim so the output stays
  # consistent regardless of leading whitespace in the source SQL.
  awk -v rel="$rel" '
    function trim(s) {
      sub(/^[[:space:]]+/, "", s)
      sub(/[[:space:]]+$/, "", s)
      return s
    }
    function sanitize_sql(s,    out, i, c, nextc, q) {
      # Mask SQL comments and quoted spans before pattern matching so review
      # notes, inserted text, and quoted identifiers cannot trigger
      # destructive-pattern false positives. `in_block_comment` intentionally
      # persists across input records for multi-line block comments.
      out = ""
      for (i = 1; i <= length(s); i++) {
        c = substr(s, i, 1)
        nextc = substr(s, i + 1, 1)

        if (in_block_comment) {
          out = out " "
          if (c == "*" && nextc == "/") {
            out = out " "
            in_block_comment = 0
            i++
          }
          continue
        }

        if (c == "/" && nextc == "*") {
          out = out "  "
          in_block_comment = 1
          i++
          continue
        }

        if (c == "-" && nextc == "-") break

        if (c == "\x27" || c == "\"") {
          q = c
          out = out " "
          for (i++; i <= length(s); i++) {
            c = substr(s, i, 1)
            nextc = substr(s, i + 1, 1)
            out = out " "
            if (c == q) {
              if (nextc == q) {
                out = out " "
                i++
                continue
              }
              break
            }
          }
          continue
        }

        out = out c
      }
      return out
    }
    {
      # Strip trailing newline (just in case).
      sub(/\r$/, "")
      raw = $0
      line = sanitize_sql(raw)
      upper = toupper(line)

      # DROP TABLE (statement-leading; allow IF EXISTS).
      if (match(upper, /(^|[[:space:];])DROP[[:space:]]+TABLE([[:space:]]|$)/)) {
        printf "%s\t%d\t%s\t%s\n", rel, NR, "DROP TABLE", trim(raw)
      }

      # DROP COLUMN.
      if (match(upper, /DROP[[:space:]]+COLUMN([[:space:]]|$)/)) {
        printf "%s\t%d\t%s\t%s\n", rel, NR, "DROP COLUMN", trim(raw)
      }

      # ALTER COLUMN ... TYPE (type change in same clause).
      if (match(upper, /ALTER[[:space:]]+COLUMN[[:space:]]+[^,;]*[[:space:]]TYPE([[:space:]]|$)/)) {
        printf "%s\t%d\t%s\t%s\n", rel, NR, "ALTER COLUMN ... TYPE", trim(raw)
      }

      # ADD COLUMN ... NOT NULL without DEFAULT on the same line. The safe
      # add-nullable + backfill + SET NOT NULL pattern does not appear on a
      # single line and is intentionally not flagged.
      if (match(upper, /ADD[[:space:]]+COLUMN([[:space:]]|$)/) \
          && match(upper, /NOT[[:space:]]+NULL([[:space:],;]|$)/) \
          && !match(upper, /DEFAULT([[:space:]]|$)/)) {
        printf "%s\t%d\t%s\t%s\n", rel, NR, "ADD COLUMN ... NOT NULL without DEFAULT", trim(raw)
      }
    }
  ' "$file" >> "$TMP_FINDINGS"
}

for sql in "${SQL_FILES[@]}"; do
  scan_file "$sql"
done

# --- report ----------------------------------------------------------------

# Per-rule risk guidance. Keep one short sentence per rule so the warning
# output stays scannable.
guidance_for() {
  case "$1" in
    "DROP TABLE")
      printf 'destroys all data in the table — confirm dependents are migrated and any export is captured first.'
      ;;
    "DROP COLUMN")
      printf 'destroys column data — confirm any backfill is complete and dependent reads are removed.'
      ;;
    "ALTER COLUMN ... TYPE")
      printf 'type change can narrow or fail — confirm the USING cast is total over existing rows.'
      ;;
    "ADD COLUMN ... NOT NULL without DEFAULT")
      printf 'will fail on tables with existing rows — add a DEFAULT, or split into add-nullable, backfill, SET NOT NULL.'
      ;;
    *)
      printf 'review the statement above before applying.'
      ;;
  esac
}

# Resolve the migration directory name for an emitted finding so we can
# look it up in the allowlist. The scanner keeps relative paths shaped like
# `<dir>/<migration_name>/migration.sql`, so two `dirname`/`basename` calls
# pick out the name regardless of whether it lives under packages/... or a
# test sandbox.
migration_name_for() {
  local rel="$1"
  local mig_dir
  mig_dir="$(dirname "$rel")"
  basename "$mig_dir"
}

# Detect allowlist entries that do not correspond to an on-disk migration
# directory next to the allowlist file (typo or removed migration). This
# is independent of which migrations were scanned this run; it depends
# only on the allowlist's own parent directory, so scanning a single
# migration cannot make sibling entries appear stale.
declare -a STALE_ENTRIES=()
if [ -n "$ALLOWLIST_FILE" ] && [ -f "$ALLOWLIST_FILE" ] && [ "${#ACK_REASONS[@]}" -gt 0 ]; then
  ALLOWLIST_DIR="$(dirname "$ALLOWLIST_FILE")"
  while IFS= read -r ack_name; do
    [ -z "$ack_name" ] && continue
    if [ ! -f "$ALLOWLIST_DIR/$ack_name/migration.sql" ]; then
      STALE_ENTRIES+=("$ack_name")
    fi
  done < <(printf '%s\n' "${!ACK_REASONS[@]}" | LC_ALL=C sort)
fi
stale_count="${#STALE_ENTRIES[@]}"

printf '== migration safety scanner ==\n'
printf 'Scanned %d migration file(s).\n' "${#SQL_FILES[@]}"

unack_count=0
ack_count=0
total=0
files=0
unack_files=0

if [ ! -s "$TMP_FINDINGS" ]; then
  printf 'No destructive operations detected.\n'
else
  # Stable sort so identical input always produces identical output: rule
  # order matches per-file source order; files are alphabetical. The report
  # then renders actionable WARN findings before acknowledged INFO findings
  # so humans, hooks, and future dashboards can separate work from history.
  sorted_findings="$(mktemp)"
  trap 'rm -f "$TMP_FINDINGS" "$sorted_findings"' EXIT
  sort -t $'\t' -k1,1 -k2,2n "$TMP_FINDINGS" > "$sorted_findings"

  total=$(wc -l < "$TMP_FINDINGS" | tr -d ' ')
  files=$(cut -f1 "$TMP_FINDINGS" | sort -u | wc -l | tr -d ' ')

  while IFS=$'\t' read -r rel lineno rule snippet; do
    name="$(migration_name_for "$rel")"
    if [ -n "${ACK_REASONS[$name]+set}" ]; then
      ack_count=$((ack_count + 1))
    else
      unack_count=$((unack_count + 1))
    fi
  done < "$sorted_findings"

  if [ "$unack_count" -gt 0 ]; then
    unack_files=$(awk -v acks="$(printf '%s\n' "${!ACK_REASONS[@]}")" '
      BEGIN { n = split(acks, arr, "\n"); for (i = 1; i <= n; i++) ack[arr[i]] = 1 }
      {
        rel = $1
        sub(/\/migration\.sql$/, "", rel)
        n = split(rel, parts, "/")
        name = parts[n]
        if (!(name in ack)) print rel
      }
    ' "$sorted_findings" | sort -u | wc -l | tr -d ' ')
  fi

  render_finding() {
    local level="$1"
    local rel="$2"
    local lineno="$3"
    local rule="$4"
    local snippet="$5"
    local reason="${6:-}"

    if [ "$level" = "INFO" ]; then
      printf 'INFO: %s:%s — %s (acknowledged: %s)\n' "$rel" "$lineno" "$rule" "$reason"
    else
      printf 'WARN: %s:%s — %s\n' "$rel" "$lineno" "$rule"
    fi
    printf '       Risk: %s\n' "$(guidance_for "$rule")"
    printf '       > %s\n' "$snippet"
  }

  printf '\n== actionable warnings ==\n'
  if [ "$unack_count" -eq 0 ]; then
    printf 'No actionable warnings; acknowledged findings are listed separately.\n'
  else
    while IFS=$'\t' read -r rel lineno rule snippet; do
      name="$(migration_name_for "$rel")"
      # `${arr[k]+set}` distinguishes "key present" (even with empty value)
      # from "key absent" — an allowlist entry with no reason is still an
      # acknowledgement.
      if [ -z "${ACK_REASONS[$name]+set}" ]; then
        render_finding "WARN" "$rel" "$lineno" "$rule" "$snippet"
      fi
    done < "$sorted_findings"
  fi

  if [ "$ack_count" -gt 0 ]; then
    printf '\n== acknowledged findings ==\n'
    while IFS=$'\t' read -r rel lineno rule snippet; do
      name="$(migration_name_for "$rel")"
      if [ -n "${ACK_REASONS[$name]+set}" ]; then
        render_finding "INFO" "$rel" "$lineno" "$rule" "$snippet" "${ACK_REASONS[$name]}"
      fi
    done < "$sorted_findings"
  fi
fi

# Stale-allowlist block. Each entry gets its own WARN: line so doctor's
# counter picks it up, plus one-line guidance so the fix is obvious.
if [ "$stale_count" -gt 0 ]; then
  printf '\n== stale acknowledgements ==\n'
  rel_allow="$(relpath "$ALLOWLIST_FILE")"
  rel_dir="$(relpath "$ALLOWLIST_DIR")"
  for stale_name in "${STALE_ENTRIES[@]}"; do
    printf 'WARN: %s:%s — stale acknowledgement "%s" — no migration at %s/%s/migration.sql\n' \
      "$rel_allow" "${ACK_LINENO[$stale_name]}" "$stale_name" "$rel_dir" "$stale_name"
    printf '       Risk: stale entry — fix the typo or remove the line if the migration was renamed or removed.\n'
  done
fi

printf '\n== summary ==\n'
if [ -s "$TMP_FINDINGS" ]; then
  printf 'Findings: %s in %s migration(s) of %s scanned (%s unacknowledged WARN, %s acknowledged INFO).\n' \
    "$total" "$files" "${#SQL_FILES[@]}" "$unack_count" "$ack_count"
fi
if [ "$stale_count" -gt 0 ]; then
  printf 'Stale allowlist entries: %s in %s.\n' "$stale_count" "$(relpath "$ALLOWLIST_FILE")"
fi
printf 'Mode: warn-only. WARN findings in the actionable warnings section name the migration, line, operation, and one-line review hint; other WARN findings name allowlist lines to fix. Confirm destructive intent and any backfill or dependent-read change is in the same migration or a precursor commit before applying to a shared database.\n'

if [ "$unack_count" -eq 0 ] && [ "$stale_count" -eq 0 ]; then
  if [ -s "$TMP_FINDINGS" ]; then
    printf 'PASS: migration safety — %s acknowledged finding(s), 0 unacknowledged\n' "$ack_count"
  else
    printf 'PASS: migration safety — no destructive operations detected\n'
  fi
else
  if [ "$unack_count" -gt 0 ] && [ -n "$ALLOWLIST_FILE" ]; then
    printf 'Acknowledge intentional destructive migrations by adding their directory name to %s (one per line, optional reason after whitespace).\n' "$ALLOWLIST_FILE"
  fi
  if [ "$unack_count" -gt 0 ]; then
    printf 'WARN: migration safety — %s unacknowledged destructive operation(s) in %s migration(s)\n' \
      "$unack_count" "$unack_files"
  fi
  if [ "$stale_count" -gt 0 ]; then
    if [ "$stale_count" -eq 1 ]; then
      printf 'WARN: migration safety — 1 stale allowlist entry in %s — fix the typo or remove the line\n' \
        "$(relpath "$ALLOWLIST_FILE")"
    else
      printf 'WARN: migration safety — %s stale allowlist entries in %s — fix the typos or remove the lines\n' \
        "$stale_count" "$(relpath "$ALLOWLIST_FILE")"
    fi
  fi
fi

exit 0
