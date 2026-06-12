#!/bin/bash
# lint-agent-changed.sh — emit the local-rule agent-facing JSON envelope,
# scoped to files an in-progress branch has touched vs a base ref. Unlike
# lint:changed, this script does NOT fail on unstaged work: agents are
# expected to run this against their uncommitted changes. The scoping
# rule is "any file appearing in committed (base..HEAD) or working-tree
# (staged + unstaged) diffs," deduplicated and filtered to lintable
# extensions that exist on disk. The script chdir's to the repo root
# after resolving its own location so git's repo-root-relative paths
# line up with downstream file checks; relative --output paths still
# resolve against the caller's original cwd.
#
# If a lint-affecting config file (eslint.config.*, tsconfig*.json,
# package.json, bun.lock, eslint-rules/*) appears in the set, the script
# falls back to a full repo scan — narrow patterns cannot reliably
# detect regressions caused by configuration drift. If no lintable files
# changed, emit an empty harness-diagnostics envelope so consumers see
# the contract surface (not a no-op exit with no JSON).
#
# Debug: pass --print-files to print the file selection outcome (FULL_SCAN /
# EMPTY / one file per line) instead of invoking lint:agent:local-rules.
# Used by scripts/tests/test-lint-agent-changed.sh.
set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CALLER_CWD="$PWD"
cd "$(git rev-parse --show-toplevel)"
# shellcheck source=scripts/lib/changed-base.sh
. "$SCRIPT_DIR/lib/changed-base.sh"
PATH_POLICY_QUERY="$SCRIPT_DIR/path-policy/path-policy-query.ts"
COMMAND_LABEL="lint:agent:local-rules:changed"

usage_error() {
  printf '%s: %s\n' "$COMMAND_LABEL" "$1" >&2
  printf 'usage: lint-agent-changed.sh [--print-files] [BASE_REF] [--output PATH|--output=PATH] [--prefix VALUE|--prefix=VALUE]\n' >&2
  exit 2
}

normalize_output_path() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s/%s\n' "$CALLER_CWD" "$1" ;;
  esac
}

path_policy_has_match() {
  local query="$1"
  shift

  IFS= read -r -d '' < <(printf '%s\0' "$@" | bun --config=/dev/null "$PATH_POLICY_QUERY" "$query")
}

PRINT_FILES=0
if [ "${1:-}" = "--print-files" ]; then
  PRINT_FILES=1
  shift
fi
# $1 is optionally a base ref. Treat it as one only if present and not
# a flag — otherwise a leading flag like `--output env.json` would be
# swallowed as the base, breaking both the resolve check and the
# missing-base-ref fallback. Consume eagerly so every code path below
# (including the missing-base-ref fallback) sees a clean $@.
BASE="main"
if [ -n "${1:-}" ] && [ "${1#--}" = "${1:-}" ]; then
  BASE="$1"
  shift
fi

# Validate and normalize the wrapper flags before the empty/non-empty fork so
# both paths enforce the same CLI contract. --prefix is accepted for parity with
# the agent harness surface, but it does not affect changed-file selection or
# lint-agent output and is intentionally not forwarded.
OUTPUT_FLAGS=()
LINT_AGENT_ARGS=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --print-files)
      PRINT_FILES=1
      shift
      ;;
    --output)
      if [ "$#" -lt 2 ] || [ -z "${2:-}" ] || [ "${2#--}" != "$2" ]; then
        usage_error "--output requires a path argument"
      fi
      value="$(normalize_output_path "$2")"
      OUTPUT_FLAGS=(--output "$value")
      LINT_AGENT_ARGS+=(--output "$value")
      shift 2
      ;;
    --output=*)
      value="${1#--output=}"
      if [ -z "$value" ]; then
        usage_error "--output= requires a non-empty path"
      fi
      if [ "${value#--}" != "$value" ]; then
        usage_error "--output= requires a path argument, got: $value"
      fi
      value="$(normalize_output_path "$value")"
      OUTPUT_FLAGS=(--output "$value")
      LINT_AGENT_ARGS+=(--output "$value")
      shift
      ;;
    --prefix)
      if [ "$#" -lt 2 ] || [ -z "${2:-}" ] || [ "${2#--}" != "$2" ]; then
        usage_error "--prefix requires a value"
      fi
      shift 2
      ;;
    --prefix=*)
      value="${1#--prefix=}"
      if [ -z "$value" ]; then
        usage_error "--prefix= requires a non-empty value"
      fi
      if [ "${value#--}" != "$value" ]; then
        usage_error "--prefix= requires a value, got: $value"
      fi
      shift
      ;;
    --*)
      usage_error "unknown argument: $1"
      ;;
    *)
      usage_error "unexpected positional argument after base ref: $1"
      ;;
  esac
done

# Resolve the base ref and preflight the common ancestor the triple-dot
# diff needs (see scripts/lib/changed-base.sh). Missing ref (typical in a
# fresh CI clone with no main fetched) and missing merge base both take
# the same conservative full scan.
if musi_resolve_changed_base "$BASE"; then
  BASE="$MUSI_CHANGED_BASE"
else
  if [ "$PRINT_FILES" -eq 1 ]; then
    printf 'FULL_SCAN\n'
    exit 0
  fi
  echo "$COMMAND_LABEL: $MUSI_CHANGED_BASE_ERROR — running full lint:agent:local-rules." >&2
  exec bun "$SCRIPT_DIR/lint-agent.ts" "${LINT_AGENT_ARGS[@]}"
fi

# Collect base-vs-HEAD, staged, and unstaged file lists (NUL-delimited
# for space-safety). Dedupe via an associative array after querying the
# shared path policy. Track whether any lint-affecting config file appears so
# we can upgrade to a full scan.
declare -A SEEN
CHANGED_FILES=()
FILES=()
FULL_SCAN=0
while IFS= read -r -d '' f; do
  CHANGED_FILES+=("$f")
done < <(
  {
    git diff -z --name-only --diff-filter=ACMRD "$BASE"...HEAD
    git diff -z --name-only --diff-filter=ACMRD --cached
    git diff -z --name-only --diff-filter=ACMRD
    # Untracked files are invisible to `git diff` but agents
    # routinely create new files without staging them yet — pick those
    # up so a brand-new lintable file isn't silently dropped.
    git ls-files -z --others --exclude-standard
  }
)

if [ "${#CHANGED_FILES[@]}" -gt 0 ] \
   && path_policy_has_match full-scan-trigger:agent-lint-changed "${CHANGED_FILES[@]}"; then
  FULL_SCAN=1
fi

while IFS= read -r -d '' f; do
  [ -f "$f" ] || continue
  [ -n "${SEEN[$f]:-}" ] && continue
  SEEN[$f]=1
  FILES+=("$f")
done < <(printf '%s\0' "${CHANGED_FILES[@]}" | bun --config=/dev/null "$PATH_POLICY_QUERY" lintable:agent-changed)

if [ "$FULL_SCAN" -eq 1 ]; then
  if [ "$PRINT_FILES" -eq 1 ]; then
    printf 'FULL_SCAN\n'
    exit 0
  fi
  echo "$COMMAND_LABEL: lint-affecting config changed — running full lint:agent:local-rules." >&2
  exec bun "$SCRIPT_DIR/lint-agent.ts" "${LINT_AGENT_ARGS[@]}"
fi

if [ "${#FILES[@]}" -eq 0 ]; then
  if [ "$PRINT_FILES" -eq 1 ]; then
    printf 'EMPTY\n'
    exit 0
  fi
  # Empty envelope path: route through the shared emitter rather than
  # hand-rolling JSON so the schema contract stays single-sourced.
  echo "$COMMAND_LABEL: no changed lintable files vs $BASE — emitting empty envelope." >&2
  exec bun "$SCRIPT_DIR/harness-emit-envelope.ts" --tool lint:agent "${OUTPUT_FLAGS[@]}" </dev/null
fi

if [ "$PRINT_FILES" -eq 1 ]; then
  for f in "${FILES[@]}"; do printf '%s\n' "$f"; done
  exit 0
fi
echo "$COMMAND_LABEL: checking ${#FILES[@]} changed file(s) vs $BASE." >&2
exec bun "$SCRIPT_DIR/lint-agent.ts" "${FILES[@]}" "${LINT_AGENT_ARGS[@]}"
