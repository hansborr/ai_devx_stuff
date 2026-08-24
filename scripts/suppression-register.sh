#!/usr/bin/env bash
# Report TypeScript and Stryker suppression usage. Fails on
# policy violations (missing -- reason, ts-ignore use, ts-nocheck
# outside allowlist, broad Stryker disable).
#
# Counts actual directive comments only. Prose mentions in docs and quoted
# fixture strings are intentionally ignored so the register reflects current
# suppressions contributors can act on in code.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE=full
BASE=main
REPO_ROOT=""
IDENTITIES_OUT=""
POSITIONAL=()

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --changed) MODE=changed; shift ;;
    --identities-out)
      shift
      if [[ "$#" -eq 0 || -z "$1" ]]; then
        printf 'FAIL: suppression register --identities-out requires a path\n' >&2
        exit 2
      fi
      IDENTITIES_OUT="$1"
      shift
      ;;
    --identities-out=*)
      IDENTITIES_OUT="${1#*=}"
      if [[ -z "$IDENTITIES_OUT" ]]; then
        printf 'FAIL: suppression register --identities-out requires a path\n' >&2
        exit 2
      fi
      shift
      ;;
    -h|--help)
      printf 'usage: suppression-register.sh [--changed [base]] [--identities-out <path>] [repo-root]\n'
      exit 0
      ;;
    --*)
      printf 'FAIL: suppression register unknown argument: %s\n' "$1" >&2
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
      printf 'FAIL: suppression register too many positional arguments\n' >&2
      exit 2
      ;;
  esac
elif [[ "${#POSITIONAL[@]}" -le 1 ]]; then
  REPO_ROOT="${POSITIONAL[0]:-}"
else
  printf 'FAIL: suppression register too many positional arguments\n' >&2
  exit 2
fi
if [[ -z "$REPO_ROOT" ]]; then
  REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
    printf 'FAIL: suppression register cannot check: not inside a git repository\n' >&2
    exit 2
  }
fi

if ! git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  printf 'FAIL: suppression register cannot check: %s is not a git repository\n' "$REPO_ROOT" >&2
  exit 2
fi
cd "$REPO_ROOT" || {
  printf 'FAIL: suppression register cannot enter repository: %s\n' "$REPO_ROOT" >&2
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
  musi_changed_gate_fail_if_unstaged "$REPO_ROOT" "lint:suppression-register:changed" || exit $?
  if ! musi_resolve_changed_base "$BASE"; then
    printf 'suppression register: %s — checking full repository.\n' "$MUSI_CHANGED_BASE_ERROR" >&2
  else
    BASE="$MUSI_CHANGED_BASE"
    if ! musi_collect_changed_candidates "$REPO_ROOT" "$BASE" gate; then
      printf 'FAIL: suppression register could not collect changed files\n' >&2
      exit 2
    fi
    selector_rc=0
    musi_changed_candidates_trigger_full_scan full-scan-trigger:suppression-register-changed \
      || selector_rc=$?
    case "$selector_rc" in
      0) ;;
      1)
        if ! musi_select_changed_lintable_files "$REPO_ROOT" lintable:agent-changed; then
          printf 'FAIL: suppression register changed-file selection failed\n' >&2
          exit 2
        fi
        SCAN_SCOPE=changed
        ;;
      *)
        printf 'FAIL: suppression register full-scan trigger selection failed\n' >&2
        exit 2
        ;;
    esac
  fi
fi

# Identity sink (leaf 50 step 2). See the matching block in
# eslint-disable-register.sh: the ledger consumes this scanner's verdict on what
# a directive is instead of maintaining a second scanner. Purely additive.
if [[ -n "$IDENTITIES_OUT" ]]; then
  if ! : > "$IDENTITIES_OUT"; then
    printf 'FAIL: suppression register cannot write identities to %s\n' "$IDENTITIES_OUT" >&2
    exit 2
  fi
  printf '#scope\t%s\n' "$SCAN_SCOPE" >> "$IDENTITIES_OUT"
fi

emit_identity() {
  local path="$1" line_no="$2" dialect="$3" text="$4" kind
  [[ -n "$IDENTITIES_OUT" ]] || return 0
  case "$dialect" in
    stryker) kind="stryker-disable" ;;
    *) kind="$dialect" ;;
  esac
  text="${text//$'\t'/ }"
  printf '%s\t%s\t%s\t%s\n' "$kind" "$path" "$line_no" "$text" >> "$IDENTITIES_OUT"
}

PATTERN_TS='(^|[[:space:]])(//|/\*)[[:space:]]*@ts-(expect-error|ignore|nocheck)($|[[:space:]])'
PATTERN_STRYKER='(^|[[:space:]])(//|/\*)[[:space:]]*Stryker[[:space:]]+disable($|[[:space:]])'
PATTERN_STRYKER_INLINE='Stryker[[:space:]]+disable[[:space:]]+next-line($|[[:space:]])'
ALLOWLIST_FILE="$REPO_ROOT/scripts/data/ts-nocheck-allowlist.txt"
TS_NOCHECK_ALLOWLIST=()
if [[ ! -r "$ALLOWLIST_FILE" ]]; then
  printf 'FAIL: suppression register cannot read allowlist: scripts/data/ts-nocheck-allowlist.txt\n' >&2
  exit 2
fi
while IFS= read -r pattern || [[ -n "$pattern" ]]; do
  pattern="${pattern%$'\r'}"
  [[ -z "$pattern" || "$pattern" == \#* ]] && continue
  TS_NOCHECK_ALLOWLIST+=("$pattern")
done < "$ALLOWLIST_FILE"
TS_NOCHECK_ALLOWLIST_MATCHED=()

total=0
ts_expect_error=0
ts_ignore=0
ts_nocheck=0
stryker=0
missing_total=0
ts_ignore_total=0
ts_nocheck_disallowed=0
stryker_broad=0
missing_entries=()
ts_ignore_entries=()
ts_nocheck_entries=()
stryker_broad_entries=()
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

display_entry() {
  local path="$1" line_no="$2" dialect="$3" text="$4"
  printf '%s:%s [%s] %s' "$path" "$line_no" "$dialect" "$(trim "$text")"
}

directive_tail() {
  local dialect="$1" text="$2"
  case "$dialect" in
    ts-expect-error) printf '%s' "${text#*@ts-expect-error}" ;;
    ts-ignore) printf '%s' "${text#*@ts-ignore}" ;;
    ts-nocheck) printf '%s' "${text#*@ts-nocheck}" ;;
    stryker) printf '%s' "${text#*Stryker disable}" ;;
  esac
}

has_reason() {
  local dialect="$1" text="$2" tail reason
  tail="$(directive_tail "$dialect" "$text")"
  [[ "$tail" == *"--"* ]] || return 1
  reason="${tail#*--}"
  reason="${reason%%\*/*}"
  reason="$(trim "$reason")"
  [[ -n "$reason" ]]
}

is_ts_nocheck_allowed() {
  local path="$1" index pattern matched=1
  for index in "${!TS_NOCHECK_ALLOWLIST[@]}"; do
    pattern="${TS_NOCHECK_ALLOWLIST[$index]}"
    # shellcheck disable=SC2053  # allowlist entries intentionally use glob patterns.
    if [[ "$path" == $pattern ]]; then
      TS_NOCHECK_ALLOWLIST_MATCHED[$index]=1
      matched=0
    fi
  done
  return "$matched"
}

stryker_scope() {
  local text="$1"
  if [[ "$text" =~ $PATTERN_STRYKER_INLINE ]]; then
    printf 'disable next-line'
  else
    printf 'disable'
  fi
}

record_match() {
  local path="$1" line_no="$2" dialect="$3" text="$4" entry scope
  emit_identity "$path" "$line_no" "$dialect" "$(trim "$text")"
  total=$((total + 1))
  case "$dialect" in
    ts-expect-error) ts_expect_error=$((ts_expect_error + 1)) ;;
    ts-ignore) ts_ignore=$((ts_ignore + 1)) ;;
    ts-nocheck) ts_nocheck=$((ts_nocheck + 1)) ;;
    stryker) stryker=$((stryker + 1)) ;;
  esac

  entry="$(display_entry "$path" "$line_no" "$dialect" "$text")"
  if ! has_reason "$dialect" "$text"; then
    missing_total=$((missing_total + 1))
    missing_entries+=("$entry")
  fi

  if [[ "$dialect" == "ts-ignore" ]]; then
    ts_ignore_total=$((ts_ignore_total + 1))
    ts_ignore_entries+=("$entry")
  fi

  if [[ "$dialect" == "ts-nocheck" ]] && ! is_ts_nocheck_allowed "$path"; then
    ts_nocheck_disallowed=$((ts_nocheck_disallowed + 1))
    ts_nocheck_entries+=("$entry")
  fi

  if [[ "$dialect" == "stryker" ]]; then
    scope="$(stryker_scope "$text")"
    if [[ "$scope" == "disable" ]]; then
      stryker_broad=$((stryker_broad + 1))
      stryker_broad_entries+=("$entry")
    fi
  fi
}

record_comment_segment() {
  local path="$1" line_no="$2" kind="$3" text="$4" candidate dialect
  if [[ "$kind" == "block" ]]; then
    candidate="$(normalize_block_comment "$text")"
  else
    candidate="$text"
  fi

  if [[ "$candidate" =~ $PATTERN_TS ]]; then
    dialect="ts-${BASH_REMATCH[3]}"
    record_match "$path" "$line_no" "$dialect" "$candidate"
    return 0
  fi
  if [[ "$candidate" =~ $PATTERN_STRYKER ]]; then
    record_match "$path" "$line_no" "stryker" "$candidate"
  fi
}

scan_line() {
  local path="$1" line_no="$2" line="$3"
  local i=0 len=${#line} in_string="" ch next rest before segment
  if (( IN_BLOCK_COMMENT == 0 && IN_TEMPLATE == 0 )) &&
    [[ "$line" != *"@ts-"* && "$line" != *"Stryker"* && "$line" != *"/*"* && "$line" != *'`'* ]]; then
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
  if [[ -n "$IDENTITIES_OUT" && "$SCAN_SCOPE" == changed ]]; then
    printf '#path\t%s\n' "$file" >> "$IDENTITIES_OUT"
  fi
  line_no=0
  IN_BLOCK_COMMENT=0
  IN_TEMPLATE=0
  while IFS= read -r text || [[ -n "$text" ]]; do
    line_no=$((line_no + 1))
    scan_line "$file" "$line_no" "$text"
  done < "$REPO_ROOT/$file"
done < <(scan_files)

unused_allowlist_entries=()
if [[ "$SCAN_SCOPE" == full ]]; then
  for index in "${!TS_NOCHECK_ALLOWLIST[@]}"; do
    if [[ "${TS_NOCHECK_ALLOWLIST_MATCHED[$index]:-0}" -ne 1 ]]; then
      unused_allowlist_entries+=("${TS_NOCHECK_ALLOWLIST[$index]}")
    fi
  done
fi

if [[ "$MODE" == changed ]]; then
  printf 'PASS: suppression register scope=%s total=%d ts-expect-error=%d ts-ignore=%d ts-nocheck=%d stryker=%d\n' \
    "$SCAN_SCOPE" "$total" "$ts_expect_error" "$ts_ignore" "$ts_nocheck" "$stryker"
else
  printf 'PASS: suppression register total=%d ts-expect-error=%d ts-ignore=%d ts-nocheck=%d stryker=%d\n' \
    "$total" "$ts_expect_error" "$ts_ignore" "$ts_nocheck" "$stryker"
fi

if (( missing_total > 0 )); then
  printf 'FAIL: suppression register reasons missing %s separator total=%d — add %s after the directive\n' \
    "'-- '" "$missing_total" "' -- <reason>'"
  for entry in "${missing_entries[@]}"; do
    printf '  - %s\n' "$entry"
  done
else
  printf 'PASS: suppression register missing reasons total=0\n'
fi

if (( ts_ignore_total > 0 )); then
  printf 'FAIL: suppression register prefers @ts-expect-error over @ts-ignore total=%d\n' \
    "$ts_ignore_total"
  for entry in "${ts_ignore_entries[@]}"; do
    printf '  - %s\n' "$entry"
  done
else
  printf 'PASS: suppression register @ts-ignore deprecation clean total=0\n'
fi

if (( ts_nocheck_disallowed > 0 )); then
  printf 'FAIL: suppression register @ts-nocheck outside allowlist total=%d — prefer per-line @ts-expect-error or add an exception in scripts/data/ts-nocheck-allowlist.txt\n' \
    "$ts_nocheck_disallowed"
  for entry in "${ts_nocheck_entries[@]}"; do
    printf '  - %s\n' "$entry"
  done
else
  printf 'PASS: suppression register @ts-nocheck allowlist clean total=0\n'
fi

if (( ${#unused_allowlist_entries[@]} > 0 )); then
  printf 'FAIL: suppression register unused @ts-nocheck allowlist entries total=%d — remove permissions with no live directive\n' \
    "${#unused_allowlist_entries[@]}"
  for entry in "${unused_allowlist_entries[@]}"; do
    printf '  - %s\n' "$entry"
  done
elif [[ "$SCAN_SCOPE" == full ]]; then
  printf 'PASS: suppression register unused @ts-nocheck allowlist entries total=0\n'
fi

if (( stryker_broad > 0 )); then
  printf 'FAIL: suppression register broad Stryker disable total=%d — prefer Stryker disable next-line\n' \
    "$stryker_broad"
  for entry in "${stryker_broad_entries[@]}"; do
    printf '  - %s\n' "$entry"
  done
else
  printf 'PASS: suppression register broad Stryker disable clean total=0\n'
fi

if (( missing_total == 0 && ts_ignore_total == 0 && ts_nocheck_disallowed == 0 && stryker_broad == 0 && ${#unused_allowlist_entries[@]} == 0 )); then
  printf 'PASS: suppression register all policy checks clean\n'
fi

if (( missing_total > 0 || ts_ignore_total > 0 || ts_nocheck_disallowed > 0 || stryker_broad > 0 || ${#unused_allowlist_entries[@]} > 0 )); then
  exit 1
fi

exit 0
