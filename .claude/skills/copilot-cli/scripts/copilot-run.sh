#!/usr/bin/env bash
# Dispatch wrapper for delegated GitHub Copilot CLI runs: enforces
# non-interactive -p usage (a promptless copilot invocation opens the
# interactive TUI and hangs a headless caller), requires an explicit
# --model (copilot would otherwise silently pick its own default), closes
# stdin (copilot never reads it), and scopes permissions by mode:
#   consult — read-only second opinion: no blanket permission grants, so
#             file reads and safe read-only shell commands run while
#             mutating tool calls are auto-denied without prompting.
#             Blanket --allow-tool grants (bare `shell`/`write`) are
#             rejected and an inherited COPILOT_ALLOW_ALL is stripped;
#             narrow grants (e.g. 'shell(bun test:*)') pass through as
#             deliberate caller escalations.
#   work    — delegated implementation: full permissions (--allow-all,
#             the --yolo equivalent) plus the per-worktree lock shared
#             with codex-run.sh so only one agent mutates a working copy.
#             Rejects copilot's -C: the lock guards the wrapper's cwd, so
#             the run must be dispatched from the worktree it mutates.
# The argument scan is a guard, not a full CLI parser: it mirrors just
# enough of copilot's option syntax to veto the dangerous shapes.
# Exit 2: usage error. Exit 3: another agent run holds this worktree.
set -euo pipefail

usage() {
  echo "Usage: copilot-run.sh {consult|work} --model <id> -p '<prompt>' [copilot args...]" >&2
  exit 2
}

reject() {
  echo "copilot-run.sh: $1" >&2
  exit 2
}

mode="${1:-}"
case "$mode" in
  consult | work) shift ;;
  *) usage ;;
esac

# consult_grant_guard <one --allow-tool value>
consult_grant_guard() {
  case "$1" in
    shell | write)
      reject "blanket grant --allow-tool $1 breaks consult's read-only guarantee; narrow it (e.g. 'shell(git diff:*)') or use work mode"
      ;;
  esac
}

args=("$@")
n=${#args[@]}
has_prompt=false
has_model=false
i=0
while [ "$i" -lt "$n" ]; do
  arg="${args[i]}"
  case "$arg" in
    -p | --prompt | --model)
      value="${args[i + 1]:-}"
      [ -n "$value" ] || reject "$arg requires a non-empty value"
      if [ "$arg" = --model ]; then has_model=true; else has_prompt=true; fi
      i=$((i + 1)) # skip the consumed value
      ;;
    --prompt=?*) has_prompt=true ;;
    --model=?*) has_model=true ;;
    --prompt= | --model=)
      reject "${arg%=} requires a non-empty value"
      ;;
    -i | --interactive)
      reject "$arg starts the interactive TUI and hangs a headless caller; use -p"
      ;;
    --allow-all | --yolo | --allow-all-tools)
      [ "$mode" = work ] || reject "$arg breaks consult's read-only guarantee; use work mode"
      ;;
    --allow-tool | --deny-tool)
      # variadic: values are the args that follow, up to the next option
      while [ $((i + 1)) -lt "$n" ]; do
        value="${args[i + 1]}"
        case "$value" in -*) break ;; esac
        if [ "$arg" = --allow-tool ] && [ "$mode" = consult ]; then
          consult_grant_guard "$value"
        fi
        i=$((i + 1))
      done
      ;;
    --allow-tool=*)
      if [ "$mode" = consult ]; then
        IFS=, read -r -a grant_values <<<"${arg#--allow-tool=}"
        for value in "${grant_values[@]}"; do
          consult_grant_guard "$value"
        done
      fi
      ;;
    -C)
      [ "$mode" = consult ] || reject "-C moves the run off this worktree's lock; dispatch from the worktree the run should mutate"
      ;;
  esac
  i=$((i + 1))
done
$has_prompt || reject "-p/--prompt is required (a promptless run opens the interactive TUI and hangs)"
$has_model || reject "--model is required (omitting it silently runs the Copilot default model)"

exec </dev/null
if [ "$mode" = consult ]; then
  # COPILOT_ALLOW_ALL is --allow-all-tools by another name.
  unset COPILOT_ALLOW_ALL
  exec copilot --no-color --no-auto-update --deny-tool write "$@"
fi
cmd=(copilot --no-color --no-auto-update --allow-all "$@")
# codex-run.lock is shared deliberately: a Copilot work run and a Codex run
# must not mutate the same working copy concurrently.
if git_dir=$(git rev-parse --git-dir 2>/dev/null) && command -v flock >/dev/null 2>&1; then
  exec flock -n -E 3 "$git_dir/codex-run.lock" "${cmd[@]}"
fi
exec "${cmd[@]}"
