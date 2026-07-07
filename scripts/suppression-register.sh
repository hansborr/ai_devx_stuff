#!/usr/bin/env bash
# Report TypeScript and Stryker suppression usage. Fails on
# policy violations (missing -- reason, ts-ignore use, ts-nocheck
# outside allowlist, broad Stryker disable).
#
# Counts actual directive comments only. Prose mentions in docs and quoted
# fixture strings are intentionally ignored so the register reflects current
# suppressions contributors can act on in code.
set -uo pipefail

REPO_ROOT="${1:-}"
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

PATTERN_TS='(^|[[:space:]])(//|/\*)[[:space:]]*@ts-(expect-error|ignore|nocheck)($|[[:space:]])'
PATTERN_STRYKER='(^|[[:space:]])(//|/\*)[[:space:]]*Stryker[[:space:]]+disable($|[[:space:]])'
PATTERN_STRYKER_INLINE='Stryker[[:space:]]+disable[[:space:]]+next-line($|[[:space:]])'
TS_NOCHECK_ALLOWLIST=(
  "scripts/drift-ai/suppressions.ts"
  "scripts/drift-ai/suppressions.test.ts"
)

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
  local path="$1" pattern
  for pattern in "${TS_NOCHECK_ALLOWLIST[@]}"; do
    # shellcheck disable=SC2053  # allowlist entries intentionally use glob patterns.
    if [[ "$path" == $pattern ]]; then
      return 0
    fi
  done
  return 1
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
  if (( IN_BLOCK_COMMENT == 0 )) &&
    [[ "$line" != *"@ts-"* && "$line" != *"Stryker"* && "$line" != *"/*"* ]]; then
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

    if [[ "$ch" == '"' || "$ch" == "'" || "$ch" == '`' ]]; then
      in_string="$ch"
    fi
    i=$((i + 1))
  done
}

while IFS= read -r -d '' file; do
  [[ -r "$REPO_ROOT/$file" ]] || continue
  line_no=0
  IN_BLOCK_COMMENT=0
  while IFS= read -r text || [[ -n "$text" ]]; do
    line_no=$((line_no + 1))
    scan_line "$file" "$line_no" "$text"
  done < "$REPO_ROOT/$file"
done < <(
  git -C "$REPO_ROOT" ls-files -z --cached --others --exclude-standard -- \
    '*.cjs' \
    '*.js' \
    '*.jsx' \
    '*.mjs' \
    '*.ts' \
    '*.tsx' \
    ':(exclude)docs/**' \
    ':(exclude)node_modules/**' \
    ':(exclude)packages/server/prisma/generated/**'
)

printf 'PASS: suppression register total=%d ts-expect-error=%d ts-ignore=%d ts-nocheck=%d stryker=%d\n' \
  "$total" "$ts_expect_error" "$ts_ignore" "$ts_nocheck" "$stryker"

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
  printf 'FAIL: suppression register @ts-nocheck outside allowlist total=%d — prefer per-line @ts-expect-error or add an exception in scripts/suppression-register.sh\n' \
    "$ts_nocheck_disallowed"
  for entry in "${ts_nocheck_entries[@]}"; do
    printf '  - %s\n' "$entry"
  done
else
  printf 'PASS: suppression register @ts-nocheck allowlist clean total=0\n'
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

if (( missing_total == 0 && ts_ignore_total == 0 && ts_nocheck_disallowed == 0 && stryker_broad == 0 )); then
  printf 'PASS: suppression register all policy checks clean\n'
fi

if (( missing_total > 0 || ts_ignore_total > 0 || ts_nocheck_disallowed > 0 || stryker_broad > 0 )); then
  exit 1
fi

exit 0
