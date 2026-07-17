#!/usr/bin/env bash
# Report eslint-disable usage and fail on suppression policy drift.
#
# Counts actual ESLint directive comments only. Prose mentions in docs are
# intentionally ignored so the register reflects suppressions contributors can
# act on in code.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE=full
BASE=main
REPO_ROOT=""
POSITIONAL=()

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --changed) MODE=changed; shift ;;
    -h|--help)
      printf 'usage: eslint-disable-register.sh [--changed [base]] [repo-root]\n'
      exit 0
      ;;
    --*)
      printf 'FAIL: eslint-disable register unknown argument: %s\n' "$1" >&2
      exit 2
      ;;
    *) POSITIONAL+=("$1"); shift ;;
  esac
done

if [[ "$MODE" == changed ]]; then
  case "${#POSITIONAL[@]}" in
    0) ;;
    1)
      if git -C "${POSITIONAL[0]}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        REPO_ROOT="${POSITIONAL[0]}"
      else
        BASE="${POSITIONAL[0]}"
      fi
      ;;
    2) BASE="${POSITIONAL[0]}"; REPO_ROOT="${POSITIONAL[1]}" ;;
    *)
      printf 'FAIL: eslint-disable register too many positional arguments\n' >&2
      exit 2
      ;;
  esac
elif [[ "${#POSITIONAL[@]}" -le 1 ]]; then
  REPO_ROOT="${POSITIONAL[0]:-}"
else
  printf 'FAIL: eslint-disable register too many positional arguments\n' >&2
  exit 2
fi
if [[ -z "$REPO_ROOT" ]]; then
  REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
    printf 'FAIL: eslint-disable register cannot check: not inside a git repository\n' >&2
    exit 2
  }
fi

if ! git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  printf 'FAIL: eslint-disable register cannot check: %s is not a git repository\n' "$REPO_ROOT" >&2
  exit 2
fi
cd "$REPO_ROOT" || {
  printf 'FAIL: eslint-disable register cannot enter repository: %s\n' "$REPO_ROOT" >&2
  exit 2
}

SCAN_SCOPE=full
FILES=()
if [[ "$MODE" == changed ]]; then
  # shellcheck source=scripts/lib/verify-metadata.sh
  . "$SCRIPT_DIR/lib/verify-metadata.sh"
  # shellcheck source=scripts/lib/changed-base.sh
  . "$SCRIPT_DIR/lib/changed-base.sh"
  # shellcheck source=scripts/lib/changed-lintable-files.sh
  . "$SCRIPT_DIR/lib/changed-lintable-files.sh"

  # This scanner runs under `set -uo pipefail` (no -e), so the abort is explicit:
  # a bare call would discard the exit code and false-green a --changed run with
  # unstaged source-relevant work. Mirrors lint-changed.sh / lint-config-sensors.sh.
  musi_changed_gate_fail_if_unstaged "$REPO_ROOT" "lint:eslint-disable-register:changed" || exit $?
  if ! musi_resolve_changed_base "$BASE"; then
    printf 'eslint-disable register: %s — checking full repository.\n' "$MUSI_CHANGED_BASE_ERROR" >&2
  else
    BASE="$MUSI_CHANGED_BASE"
    if ! musi_collect_changed_candidates "$REPO_ROOT" "$BASE" gate; then
      printf 'FAIL: eslint-disable register could not collect changed files\n' >&2
      exit 2
    fi
    selector_rc=0
    musi_changed_candidates_trigger_full_scan full-scan-trigger:eslint-disable-register-changed \
      || selector_rc=$?
    case "$selector_rc" in
      0) ;;
      1)
        if ! musi_select_changed_lintable_files "$REPO_ROOT" lintable:agent-changed; then
          printf 'FAIL: eslint-disable register changed-file selection failed\n' >&2
          exit 2
        fi
        SCAN_SCOPE=changed
        ;;
      *)
        printf 'FAIL: eslint-disable register full-scan trigger selection failed\n' >&2
        exit 2
        ;;
    esac
  fi
fi

PATTERN='(^|[[:space:]])(//|/\*)[[:space:]]*eslint-disable(-next-line|-line)?($|[[:space:]])'
ALLOWLIST_FILE="$SCRIPT_DIR/data/eslint-disable-broad-allowlist.txt"
BROAD_ALLOWLIST=()
if [[ ! -r "$ALLOWLIST_FILE" ]]; then
  printf 'FAIL: eslint-disable register cannot read allowlist: scripts/data/eslint-disable-broad-allowlist.txt\n' >&2
  exit 2
fi
while IFS= read -r entry || [[ -n "$entry" ]]; do
  entry="${entry%$'\r'}"
  [[ -z "$entry" || "$entry" == \#* ]] && continue
  if [[ "$entry" != *'|'* || -z "${entry%%|*}" || -z "${entry#*|}" ]]; then
    printf 'FAIL: eslint-disable register malformed allowlist entry in scripts/data/eslint-disable-broad-allowlist.txt: %s\n' "$entry" >&2
    exit 2
  fi
  BROAD_ALLOWLIST+=("$entry")
done < "$ALLOWLIST_FILE"

total=0
inline=0
broad=0
missing_total=0
missing_inline=0
missing_broad=0
missing_entries=()
broad_disallowed=0
broad_entries=()
IN_BLOCK_COMMENT=0
IN_TEMPLATE=0

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

normalize_block_comment() {
  local value="$1"
  if [[ "${value:0:2}" == "/*" ]]; then
    value="${value:2}"
  fi
  value="${value%%\*/*}"
  value="$(trim "$value")"
  while [[ "$value" == \** ]]; do
    value="${value#\*}"
    value="$(trim "$value")"
  done
  printf '/* %s' "$value"
}

extract_rules() {
  local text="$1"
  local rest="${text#*eslint-disable}"
  rest="${rest%%--*}"
  rest="${rest%%*/}"
  rest="$(trim "$rest")"
  if [[ -z "$rest" ]]; then
    printf 'all\n'
    return 0
  fi
  local old_ifs="$IFS"
  IFS=','
  # shellcheck disable=SC2206
  local rules=($rest)
  IFS="$old_ifs"
  local rule
  for rule in "${rules[@]}"; do
    rule="$(trim "$rule")"
    [[ -n "$rule" ]] || continue
    printf '%s\n' "$rule"
  done
}

is_broad_rule_allowed() {
  local path="$1" rule="$2"
  local entry pattern allowed_rule
  for entry in "${BROAD_ALLOWLIST[@]}"; do
    pattern="${entry%%|*}"
    allowed_rule="${entry#*|}"
    # shellcheck disable=SC2053  # allowlist entries intentionally use glob patterns.
    if [[ "$path" == $pattern && "$rule" == "$allowed_rule" ]]; then
      return 0
    fi
  done
  return 1
}

record_match() {
  local path="$1" line_no="$2" text="$3"
  local kind=broad
  if [[ "$text" == *eslint-disable-next-line* || "$text" == *eslint-disable-line* ]]; then
    kind=inline
  fi

  total=$((total + 1))
  if [[ "$kind" == inline ]]; then
    inline=$((inline + 1))
  else
    broad=$((broad + 1))
  fi

  if [[ "$text" != *"--"* ]]; then
    missing_total=$((missing_total + 1))
    if [[ "$kind" == inline ]]; then
      missing_inline=$((missing_inline + 1))
    else
      missing_broad=$((missing_broad + 1))
    fi
    missing_entries+=("$path:$line_no [$kind] $(trim "$text")")
  fi

  if [[ "$kind" == broad ]]; then
    local disallowed_rules=()
    local rule
    while IFS= read -r rule; do
      if ! is_broad_rule_allowed "$path" "$rule"; then
        disallowed_rules+=("$rule")
      fi
    done < <(extract_rules "$text")
    if (( ${#disallowed_rules[@]} > 0 )); then
      broad_disallowed=$((broad_disallowed + 1))
      broad_entries+=("$path:$line_no rules=$(IFS=,; printf '%s' "${disallowed_rules[*]}") $(trim "$text")")
    fi
  fi
}

record_comment_segment() {
  local path="$1" line_no="$2" kind="$3" text="$4" candidate
  if [[ "$kind" == "block" ]]; then
    candidate="$(normalize_block_comment "$text")"
  else
    candidate="$text"
  fi

  if [[ "$candidate" =~ $PATTERN ]]; then
    record_match "$path" "$line_no" "$candidate"
  fi
}

scan_line() {
  local path="$1" line_no="$2" line="$3"
  local i=0 len=${#line} in_string="" ch next rest before segment
  if (( IN_BLOCK_COMMENT == 0 && IN_TEMPLATE == 0 )) &&
    [[ "$line" != *"eslint-disable"* && "$line" != *"/*"* && "$line" != *'`'* ]]; then
    return 0
  fi
  while (( i < len )); do
    if (( IN_BLOCK_COMMENT == 1 )); then
      rest="${line:i}"
      if [[ "$rest" == *"*/"* ]]; then
        before="${rest%%\*/*}"
        segment="$before*/"
        record_comment_segment "$path" "$line_no" "block" "$segment"
        IN_BLOCK_COMMENT=0
        i=$((i + ${#before} + 2))
        continue
      fi
      record_comment_segment "$path" "$line_no" "block" "$rest"
      return 0
    fi

    # Template literals span lines, so backtick state is file-scoped like
    # IN_BLOCK_COMMENT. Template content is string data, never a directive;
    # ${...} interpolation is coarsely ignored (missing a directive genuinely
    # buried inside interpolation is far cheaper than false-failing on data).
    if (( IN_TEMPLATE == 1 )); then
      ch="${line:i:1}"
      if [[ "$ch" == "\\" ]]; then
        i=$((i + 2))
        continue
      fi
      if [[ "$ch" == '`' ]]; then
        IN_TEMPLATE=0
      fi
      i=$((i + 1))
      continue
    fi

    ch="${line:i:1}"
    next="${line:i+1:1}"
    if [[ -n "$in_string" ]]; then
      if [[ "$ch" == "\\" ]]; then
        i=$((i + 2))
        continue
      fi
      if [[ "$ch" == "$in_string" ]]; then
        in_string=""
      fi
      i=$((i + 1))
      continue
    fi

    if [[ "$ch" == "/" && "$next" == "/" ]]; then
      segment="${line:i}"
      record_comment_segment "$path" "$line_no" "line" "$segment"
      return 0
    fi

    if [[ "$ch" == "/" && "$next" == "*" ]]; then
      rest="${line:i}"
      if [[ "$rest" == *"*/"* ]]; then
        before="${rest%%\*/*}"
        segment="$before*/"
        record_comment_segment "$path" "$line_no" "block" "$segment"
        i=$((i + ${#before} + 2))
        continue
      fi
      IN_BLOCK_COMMENT=1
      record_comment_segment "$path" "$line_no" "block" "$rest"
      return 0
    fi

    if [[ "$ch" == '"' || "$ch" == "'" ]]; then
      in_string="$ch"
    elif [[ "$ch" == '`' ]]; then
      # Accepted tradeoff: with no regex-literal handling, a code-position
      # backtick that is not a template opener (e.g. the regex /[`]/) flips
      # template state for the rest of the file until the next backtick, so a
      # genuine directive in that span goes uncounted (false negative). That
      # beats the alternative — treating template data as code and false-
      # failing the gate. Pinned by the regex-backtick smoke case; changing
      # this means a parser-backed scanner, not a tweak here.
      IN_TEMPLATE=1
    fi
    i=$((i + 1))
  done
}

scan_files() {
  local file
  if [[ "$SCAN_SCOPE" == changed ]]; then
    for file in "${FILES[@]}"; do
      case "$file" in
        docs/*|node_modules/*|packages/server/prisma/generated/*) continue ;;
      esac
      printf '%s\0' "$file"
    done
    return 0
  fi

  git -C "$REPO_ROOT" ls-files -z --cached --others --exclude-standard -- \
    '*.cjs' '*.js' '*.jsx' '*.mjs' '*.ts' '*.tsx' \
    ':(exclude)docs/**' \
    ':(exclude)node_modules/**' \
    ':(exclude)packages/server/prisma/generated/**'
}

while IFS= read -r -d '' file; do
  [[ -r "$REPO_ROOT/$file" ]] || continue
  line_no=0
  IN_BLOCK_COMMENT=0
  IN_TEMPLATE=0
  while IFS= read -r text || [[ -n "$text" ]]; do
    line_no=$((line_no + 1))
    scan_line "$file" "$line_no" "$text"
  done < "$REPO_ROOT/$file"
done < <(scan_files)

if [[ "$MODE" == changed ]]; then
  printf 'PASS: eslint-disable register scope=%s total=%d inline=%d broad=%d\n' \
    "$SCAN_SCOPE" "$total" "$inline" "$broad"
else
  printf 'PASS: eslint-disable register total=%d inline=%d broad=%d\n' \
    "$total" "$inline" "$broad"
fi

if (( missing_total > 0 )); then
  printf 'FAIL: eslint-disable register missing reasons total=%d inline=%d broad=%d — add '"'"'-- reason'"'"' to each directive\n' \
    "$missing_total" "$missing_inline" "$missing_broad"
  for entry in "${missing_entries[@]}"; do
    printf '  - %s\n' "$entry"
  done
else
  printf 'PASS: eslint-disable register all suppressions include -- reason\n'
fi

if (( broad_disallowed > 0 )); then
  printf 'FAIL: eslint-disable register broad suppressions outside allowlist total=%d — prefer eslint-disable-next-line, or add a targeted file/rule exception in scripts/data/eslint-disable-broad-allowlist.txt\n' \
    "$broad_disallowed"
  for entry in "${broad_entries[@]}"; do
    printf '  - %s\n' "$entry"
  done
else
  printf 'PASS: eslint-disable register broad suppressions are allowlisted total=%d\n' \
    "$broad"
fi

if (( missing_total > 0 || broad_disallowed > 0 )); then
  exit 1
fi
exit 0
