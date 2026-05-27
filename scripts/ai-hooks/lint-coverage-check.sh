#!/bin/bash
# PostToolUse hook: warn when an edited/created file is not covered by ESLint.
#
# General-purpose: works with any ESLint config by querying ESLint's own
# resolution. No hardcoded paths or project-specific allowlists needed.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || git rev-parse --show-toplevel 2>/dev/null || echo "${CLAUDE_PROJECT_DIR:-/workspace}")
REPO_ROOT=$(realpath -m "$REPO_ROOT")
# shellcheck source=/dev/null
. "$SCRIPT_DIR/common.sh"

ai_lint_coverage_payload_tool_name() {
  local payload="$1"
  printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null || true
}

ai_lint_coverage_patch_paths() {
  local patch="$1"

  printf '%s\n' "$patch" | awk '
    /^\*\*\* (Add|Update|Delete) File: / {
      sub(/^\*\*\* (Add|Update|Delete) File: /, "")
      sub(/\r$/, "")
      print
      next
    }
    /^\*\*\* Move to: / {
      sub(/^\*\*\* Move to: /, "")
      sub(/\r$/, "")
      print
    }
  '
}

ai_lint_coverage_payload_paths() {
  local payload="$1"
  local tool_name file command

  tool_name=$(ai_lint_coverage_payload_tool_name "$payload")
  if [ "$tool_name" = "apply_patch" ]; then
    command=$(ai_payload_command "$payload")
    ai_lint_coverage_patch_paths "$command"
    return 0
  fi

  file=$(ai_payload_file_path "$payload")
  [ -n "$file" ] && printf '%s\n' "$file"
}

ai_lint_coverage_is_lintable() {
  local file="$1"

  case "${file,,}" in
    *.js|*.jsx|*.mjs|*.cjs|*.ts|*.tsx|*.mts|*.cts|*.json|*.jsonc|*.json5)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

ai_lint_coverage_is_ratchet_covered() {
  local relative_path="$1"
  local baseline_path="$REPO_ROOT/lint-ratchet.baseline.json"

  [ -f "$baseline_path" ] || return 1
  command -v node >/dev/null 2>&1 || return 1

  node - "$baseline_path" "$relative_path" <<'JS'
const fs = require("fs");

const [, , baselinePath, relativePath] = process.argv;

function splitBraceParts(value) {
  const parts = [];
  let depth = 0;
  let start = 0;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }

  parts.push(value.slice(start));
  return parts;
}

function expandBraces(pattern) {
  const start = pattern.indexOf("{");
  if (start === -1) return [pattern];

  let depth = 0;
  let end = -1;
  for (let index = start; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }

  if (end === -1) return [pattern];

  const before = pattern.slice(0, start);
  const after = pattern.slice(end + 1);
  return splitBraceParts(pattern.slice(start + 1, end)).flatMap((part) =>
    expandBraces(`${before}${part}${after}`),
  );
}

function escapeRegex(value) {
  return value.replace(/[\\^$+?.()|[\]{}]/gu, "\\$&");
}

function globToRegex(pattern) {
  let source = "^";
  const normalized = pattern.replaceAll("\\", "/");

  for (let index = 0; index < normalized.length; ) {
    const char = normalized[index];
    const next = normalized[index + 1];
    const afterNext = normalized[index + 2];

    if (char === "*" && next === "*" && afterNext === "/") {
      source += "(?:[^/]+/)*";
      index += 3;
      continue;
    }

    if (char === "*" && next === "*") {
      source += ".*";
      index += 2;
      continue;
    }

    if (char === "*") {
      source += "[^/]*";
      index += 1;
      continue;
    }

    if (char === "?") {
      source += "[^/]";
      index += 1;
      continue;
    }

    source += escapeRegex(char);
    index += 1;
  }

  return new RegExp(`${source}$`, "u");
}

function matchesAny(patterns, path) {
  if (!Array.isArray(patterns)) return false;
  return patterns.some((pattern) =>
    typeof pattern === "string" &&
    expandBraces(pattern).some((expanded) => globToRegex(expanded).test(path)),
  );
}

try {
  const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  const tests = baseline && typeof baseline === "object" ? baseline.tests : undefined;
  if (!tests || typeof tests !== "object") process.exit(1);

  for (const test of Object.values(tests)) {
    if (!test || typeof test !== "object") continue;
    if (matchesAny(test.files, relativePath) && !matchesAny(test.ignores, relativePath)) {
      process.exit(0);
    }
  }
} catch {
  process.exit(1);
}

process.exit(1);
JS
}

ai_lint_coverage_check_file() {
  local absolute_path="$1"
  local relative_path="$2"
  local config_output

  # Ask ESLint if it has config for this file. With flat config, ignored or
  # uncovered files produce the literal string "undefined".
  config_output=$(node_modules/.bin/eslint --print-config "$absolute_path" 2>/dev/null) || true

  if [ "$config_output" = "undefined" ] || [ -z "$config_output" ]; then
    if ai_lint_coverage_is_ratchet_covered "$relative_path"; then
      return 0
    fi

    printf 'lint-coverage: WARNING - %s is NOT covered by ESLint. ' "$relative_path"
    printf 'If this file should be linted, update eslint.config.js (and any relevant tsconfig) to include it.\n'
    return 1
  fi
  return 0
}

ai_lint_coverage_main() {
  local payload path absolute_path relative_path result message
  local -a paths=()
  local -A seen=()

  cd "$REPO_ROOT" || ai_emit_continue

  payload=$(ai_read_payload)
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    if [ -z "${seen[$path]+x}" ]; then
      paths+=("$path")
      seen[$path]=1
    fi
  done < <(ai_lint_coverage_payload_paths "$payload")

  [ "${#paths[@]}" -gt 0 ] || ai_emit_continue

  message=""
  for path in "${paths[@]}"; do
    if [[ "$path" = /* ]]; then
      absolute_path=$(realpath -m -- "$path")
    else
      absolute_path=$(realpath -m -- "$REPO_ROOT/$path")
    fi

    case "$absolute_path" in
      "$REPO_ROOT"/*) ;;
      *) continue ;;
    esac

    relative_path="${absolute_path#"$REPO_ROOT"/}"
    ai_lint_coverage_is_lintable "$relative_path" || continue

    case "$relative_path" in
      node_modules/*|.git/*|*/node_modules/*) continue ;;
    esac

    [ -f "$absolute_path" ] || continue

    result=$(ai_lint_coverage_check_file "$absolute_path" "$relative_path") || {
      if [ -n "$message" ]; then
        message="${message}"$'\n'"$result"
      else
        message="$result"
      fi
    }
  done

  if [ -n "$message" ]; then
    ai_emit_additional_context "PostToolUse" "$message"
  fi

  ai_emit_continue
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  ai_lint_coverage_main
fi
