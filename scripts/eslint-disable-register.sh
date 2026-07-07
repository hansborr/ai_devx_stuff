#!/usr/bin/env bash
# Report eslint-disable usage and fail on suppression policy drift.
#
# Counts actual ESLint directive comments only. Prose mentions in docs are
# intentionally ignored so the register reflects suppressions contributors can
# act on in code.
set -uo pipefail

REPO_ROOT="${1:-}"
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

PATTERN='(^|[[:space:]])(//|/\*)[[:space:]]*eslint-disable(-next-line|-line)?($|[[:space:]])'
BROAD_ALLOWLIST=(
  "packages/shared/src/map/grid-utils.ts|no-magic-numbers"
  "packages/shared/src/map/area-template.ts|no-magic-numbers"
  "packages/shared/src/rules/xp.ts|no-magic-numbers"
  "packages/shared/src/rules/spellcasting.ts|no-magic-numbers"
  "packages/shared/src/schemas/character.ts|no-magic-numbers"
  "packages/server/src/seed/generate-*.ts|no-magic-numbers"
  "packages/server/src/seed/generate-*.ts|complexity"
  "packages/server/src/seed/generate-*.ts|@typescript-eslint/restrict-template-expressions"
  "packages/server/src/utils/prisma-types.test.ts|@typescript-eslint/no-deprecated"
  "packages/server/src/utils/srd-query-helpers.ts|@typescript-eslint/explicit-function-return-type"
  "packages/server/src/utils/__type-tests__/*.ts|@typescript-eslint/no-deprecated"
)

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
  if (( IN_BLOCK_COMMENT == 0 )) &&
    [[ "$line" != *"eslint-disable"* && "$line" != *"/*"* ]]; then
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

printf 'PASS: eslint-disable register total=%d inline=%d broad=%d\n' \
  "$total" "$inline" "$broad"

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
  printf 'FAIL: eslint-disable register broad suppressions outside allowlist total=%d — prefer eslint-disable-next-line, or add a targeted file/rule exception in scripts/eslint-disable-register.sh\n' \
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
