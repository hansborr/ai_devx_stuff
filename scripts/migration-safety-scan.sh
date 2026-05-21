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

# Resolve script-relative paths so the scanner works from any cwd; tests run
# from a sandbox directory and would otherwise fail to invoke the envelope
# emitter (relative `scripts/harness-emit-envelope.ts` only resolves at the
# repo root).
SCRIPT_DIR="$(cd "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# `git rev-parse` is only used to resolve the default migrations directory
# and to shorten paths in the output. Explicit PATH arguments work outside a
# git repository (useful for tests that point the scanner at a sandbox).
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
DEFAULT_MIGRATIONS_DIR="${REPO_ROOT:+$REPO_ROOT/packages/server/prisma/migrations}"
DEFAULT_ALLOWLIST="${REPO_ROOT:+$REPO_ROOT/packages/server/prisma/migrations/.safety-acknowledged}"
ALLOWLIST_FILE="${MUSI_MIGRATION_ALLOWLIST:-$DEFAULT_ALLOWLIST}"

usage() {
  cat <<'EOF'
usage: migration-safety-scan.sh [--json] [PATH ...]

Scans Prisma SQL migrations for destructive operations:
  - DROP TABLE
  - DROP COLUMN
  - ALTER COLUMN ... TYPE (potential type narrowing)
  - ADD COLUMN ... NOT NULL without DEFAULT

PATH may be a migration directory (containing migration.sql), a single
.sql file, or the migrations root. With no arguments the scanner walks
packages/server/prisma/migrations.

With --json, emits a harness-diagnostics envelope on stdout instead of
the human-readable report. The scanner is warn-only and always exits 0.
EOF
}

emit_json=0
declare -a POSITIONAL_PATHS=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --json)
      emit_json=1
      shift
      ;;
    --)
      # End-of-options: subsequent arguments are positional even if they look
      # like flags. Lets `bash migration-safety-scan.sh -- --weird-name` scan a
      # directory literally named `--weird-name`.
      shift
      while [ "$#" -gt 0 ]; do
        POSITIONAL_PATHS+=("$1")
        shift
      done
      break
      ;;
    *)
      POSITIONAL_PATHS+=("$1")
      shift
      ;;
  esac
done
if [ "${#POSITIONAL_PATHS[@]}" -gt 0 ]; then
  set -- "${POSITIONAL_PATHS[@]}"
else
  set --
fi

# --- collect target migration.sql files ------------------------------------

declare -a SQL_FILES=()
declare -a COLLECTION_FINDINGS=()

require_jq_for_json() {
  if ! command -v jq >/dev/null 2>&1; then
    printf 'FAIL: jq is required for --json mode but is not installed\n' >&2
    exit 1
  fi
}

append_collection_warning_finding() {
  [ "$emit_json" -eq 1 ] || return 0
  require_jq_for_json
  local message_id="$1" path="$2" why="$3" how_to_fix="$4"
  local finding
  finding="$(
    jq -nc \
      --arg path "$path" \
      --arg messageId "$message_id" \
      --arg why "$why" \
      --arg howToFix "$how_to_fix" \
      '{control:"sensor/db-migration-safety",severity:"warn",path:$path,messageId:$messageId,why:$why,howToFix:$howToFix,repairKind:"manual"}'
  )" || {
    printf 'FAIL: --json jq failed to construct collection warning for %s\n' "$path" >&2
    exit 1
  }
  COLLECTION_FINDINGS+=("$finding")
}

emit_collection_envelope() {
  local findings_ndjson
  findings_ndjson="$(mktemp)"
  if [ "${#COLLECTION_FINDINGS[@]}" -gt 0 ]; then
    printf '%s\n' "${COLLECTION_FINDINGS[@]}" > "$findings_ndjson"
  fi
  bun run "$SCRIPT_DIR/harness-emit-envelope.ts" --tool migration-safety-scan < "$findings_ndjson"
  local rc=$?
  rm -f "$findings_ndjson"
  return "$rc"
}

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
    message="no migrations directory at $DEFAULT_MIGRATIONS_DIR — nothing to scan"
    printf 'WARN: %s\n' "$message" >&2
    append_collection_warning_finding \
      "missing-migrations-directory" \
      "$DEFAULT_MIGRATIONS_DIR" \
      "$message" \
      "Create the migrations directory, or pass an existing migration directory or .sql file."
    if [ "$emit_json" -eq 1 ]; then
      emit_collection_envelope
      exit "$?"
    fi
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
      message="not a file or directory, skipping: $target"
      printf 'WARN: %s\n' "$message" >&2
      append_collection_warning_finding \
        "missing-target" \
        "$target" \
        "$message" \
        "Pass an existing migration directory or .sql file, or remove this path from the scanner invocation."
    fi
  done
fi

if [ "${#SQL_FILES[@]}" -eq 0 ]; then
  if [ "$emit_json" -eq 1 ]; then
    # Empty envelope honours the --json contract: consumers (doctor, CI
    # aggregators) always parse JSON in this mode, so we must not fall
    # through to the bare "INFO:" text line. Collection warnings, if any,
    # still become findings so missing targets are visible to machines.
    emit_collection_envelope
    exit "$?"
  fi
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
  # The TMP_FINDINGS TSV uses tab/newline as field/record separators. A tab
  # or newline in a path would corrupt the TSV (and the downstream JSON
  # framing). Reject loudly rather than silently shifting fields.
  case "$rel" in
    *$'\t'*|*$'\n'*)
      printf 'FAIL: migration path contains tab or newline; cannot be processed safely: %q\n' "$file" >&2
      exit 1
      ;;
  esac

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
  # `dirname --` / `basename --` are required because relative paths starting
  # with `-` (a sandbox name like `--weird-dir`) are otherwise misinterpreted
  # as flags.
  mig_dir="$(dirname -- "$rel")"
  basename -- "$mig_dir"
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

# Sort findings unconditionally so both the human-readable report and the
# JSON envelope see the same stable ordering.
sorted_findings=""
if [ -s "$TMP_FINDINGS" ]; then
  sorted_findings="$(mktemp)"
  trap 'rm -f "$TMP_FINDINGS" "$sorted_findings"' EXIT
  sort -t $'\t' -k1,1 -k2,2n "$TMP_FINDINGS" > "$sorted_findings"
fi

unack_count=0
ack_count=0
total=0
files=0
unack_files=0

if [ -n "$sorted_findings" ]; then
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
fi

# --- JSON emit branch ------------------------------------------------------
# When --json is set, emit a harness-diagnostics envelope on stdout instead
# of the human-readable report. Scanner stays warn-only (always exit 0).
if [ "$emit_json" -eq 1 ]; then
  require_jq_for_json
  allow_rel=""
  allow_dir_rel=""
  if [ -n "$ALLOWLIST_FILE" ]; then
    allow_rel="$(relpath "$ALLOWLIST_FILE")"
    allow_dir_rel="$(relpath "$(dirname -- "$ALLOWLIST_FILE")")"
  fi
  how_warn="Acknowledge intentional destructive migrations by adding the migration directory name to ${allow_rel:-the allowlist}, or split into the safe multi-step pattern (add nullable, backfill, then SET NOT NULL)."
  how_info="Already acknowledged. If the migration is renamed or dropped, also remove the line from ${allow_rel:-the allowlist}."
  how_stale="Remove the stale entry from ${allow_rel:-the allowlist}, or fix the typo if the migration was renamed."

  # Build findings into a temp file rather than a `{ ... } | emitter` pipe
  # so a jq failure mid-loop can terminate the script. A brace group on the
  # left of a pipe runs in a subshell and exposes only the last command's
  # exit status; a per-finding `exit` inside such a subshell does not stop
  # the script and the failed finding is silently dropped.
  FINDINGS_NDJSON="$(mktemp)"
  trap 'rm -f "$TMP_FINDINGS" "$sorted_findings" "$FINDINGS_NDJSON"' EXIT

  # Construct each finding directly as JSON via `jq` so the pipeline is
  # delimiter-safe: a TSV bridge here would corrupt fields when a path or an
  # allowlist reason contains a tab/newline. jq handles all JSON escaping.
  if [ "${#COLLECTION_FINDINGS[@]}" -gt 0 ]; then
    printf '%s\n' "${COLLECTION_FINDINGS[@]}" >> "$FINDINGS_NDJSON"
  fi
  if [ -n "$sorted_findings" ]; then
    while IFS=$'\t' read -r rel lineno rule snippet; do
      # The TMP_FINDINGS TSV is generated by awk with `%d` for line, so this
      # should always be numeric. Guarding here turns a future producer bug
      # into a loud error rather than a silent `--argjson` invalid-JSON drop.
      if ! [[ "$lineno" =~ ^[0-9]+$ ]]; then
        printf 'FAIL: --json bridge expected numeric line but got: %q\n' "$lineno" >&2
        exit 1
      fi
      name="$(migration_name_for "$rel")"
      if [ -n "${ACK_REASONS[$name]+set}" ]; then
        severity="info"
        why="$rule (acknowledged): ${ACK_REASONS[$name]}"
        how="$how_info"
      else
        severity="warn"
        why="$rule — $(guidance_for "$rule")"
        how="$how_warn"
      fi
      jq -nc \
        --arg severity "$severity" \
        --arg path "$rel" \
        --argjson line "$lineno" \
        --arg messageId "$rule" \
        --arg why "$why" \
        --arg howToFix "$how" \
        '{control:"sensor/db-migration-safety",severity:$severity,path:$path,line:$line,messageId:$messageId,why:$why,howToFix:$howToFix,repairKind:"manual"}' \
        >> "$FINDINGS_NDJSON" || {
          printf 'FAIL: --json jq failed to construct finding for %s:%s\n' "$rel" "$lineno" >&2
          exit 1
        }
    done < "$sorted_findings"
  fi
  if [ "$stale_count" -gt 0 ] && [ -n "$allow_rel" ]; then
    for stale_name in "${STALE_ENTRIES[@]}"; do
      jq -nc \
        --arg path "$allow_rel" \
        --argjson line "${ACK_LINENO[$stale_name]}" \
        --arg why "stale acknowledgement \"$stale_name\" — no migration at $allow_dir_rel/$stale_name/migration.sql" \
        --arg howToFix "$how_stale" \
        '{control:"sensor/db-migration-safety",severity:"warn",path:$path,line:$line,messageId:"stale-allowlist",why:$why,howToFix:$howToFix,repairKind:"manual"}' \
        >> "$FINDINGS_NDJSON" || {
          printf 'FAIL: --json jq failed to construct stale-allowlist finding for %s\n' "$stale_name" >&2
          exit 1
        }
    done
  fi

  # Feed the validated NDJSON into the envelope emitter without a brace-group
  # pipe so the emitter's rc is the script's rc (set -uo pipefail is already
  # set; pipefail still applies to `<` redirection failure exits).
  bun run "$SCRIPT_DIR/harness-emit-envelope.ts" --tool migration-safety-scan < "$FINDINGS_NDJSON"
  exit "$?"
fi

printf '== migration safety scanner ==\n'
printf 'Scanned %d migration file(s).\n' "${#SQL_FILES[@]}"

if [ -z "$sorted_findings" ]; then
  printf 'No destructive operations detected.\n'
else

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
