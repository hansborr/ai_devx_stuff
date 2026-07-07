#!/usr/bin/env bash
# worktree-new.sh — create a secondary worktree, provision it, and print the
# resulting URLs / DB names / Redis index in one step.
#
# Usage:
#   bun run worktree:new <path> [-b <new-branch>] [<existing-branch>] [--from <start>]
#
# Examples:
#   bun run worktree:new ../feat/foo -b feat/foo
#   bun run worktree:new ../feat/foo feat/foo               # check out existing branch
#   bun run worktree:new ../feat/foo -b feat/foo --from main
#
# Steps:
#   1. `git worktree add <path> [-b <branch>] [<start>]`
#   2. From inside the new worktree: `bun run worktree:init` (idempotent —
#      reuses .worktreeinclude carry-over already wired into init).
#   3. Print the assigned ports, URLs, DB names, Redis logical DB, and a
#      one-line "next" hint.
#
# This is a thin wrapper. All allocation/state logic stays in worktree-db.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# Source the helper library, but only once per process — sourcing twice would
# re-run its top-level `readonly` declarations and fail. Tests source both
# files; production runs source this file alone.
if ! declare -F compute_slug >/dev/null 2>&1; then
  # shellcheck source=./worktree-db.sh disable=SC1091
  . "$SCRIPT_DIR/worktree-db.sh"
fi

usage() {
  cat >&2 <<'EOF'
Usage:
  bun run worktree:new <path> [-b <new-branch>] [<existing-branch>] [--from <start>]

Creates a secondary git worktree at <path>, runs `worktree:init`, then prints
the assigned URLs, DB names, Redis DB index, and next commands.

Arguments:
  <path>               Path for the new worktree (passed through to git worktree add).
  -b <new-branch>      Create a new branch with this name.
  <existing-branch>    Check out an existing branch instead of creating one.
  --from <start>       Start point for the new branch (only valid with -b).

Reuses the existing .worktreeinclude carry-over performed by worktree:init.
EOF
}

# parse_new_args reads $@ and writes to globals so callers (and tests) can read
# the parsed values back. Returns 0 on success, dies on invalid input.
parse_new_args() {
  WT_NEW_PATH=""
  WT_NEW_NEW_BRANCH=""
  WT_NEW_EXISTING_BRANCH=""
  WT_NEW_START_REF=""

  local positional=()
  while (( $# > 0 )); do
    case "$1" in
      -h|--help)
        usage
        exit 0
        ;;
      -b)
        [[ $# -ge 2 ]] || die "-b requires a branch name"
        [[ -n "$WT_NEW_NEW_BRANCH" ]] && die "-b given twice"
        WT_NEW_NEW_BRANCH="$2"
        shift 2
        ;;
      --from)
        [[ $# -ge 2 ]] || die "--from requires a ref"
        [[ -n "$WT_NEW_START_REF" ]] && die "--from given twice"
        WT_NEW_START_REF="$2"
        shift 2
        ;;
      --)
        shift
        while (( $# > 0 )); do positional+=("$1"); shift; done
        ;;
      -*)
        die "unknown flag: $1 (run with --help for usage)"
        ;;
      *)
        positional+=("$1")
        shift
        ;;
    esac
  done

  case "${#positional[@]}" in
    0) die "missing <path> (run with --help for usage)" ;;
    1) WT_NEW_PATH="${positional[0]}" ;;
    2)
      WT_NEW_PATH="${positional[0]}"
      WT_NEW_EXISTING_BRANCH="${positional[1]}"
      ;;
    *) die "too many positional arguments: ${positional[*]}" ;;
  esac

  if [[ -n "$WT_NEW_NEW_BRANCH" && -n "$WT_NEW_EXISTING_BRANCH" ]]; then
    die "cannot combine -b <new-branch> with a positional <existing-branch>"
  fi
  if [[ -n "$WT_NEW_START_REF" && -z "$WT_NEW_NEW_BRANCH" ]]; then
    die "--from requires -b <new-branch>"
  fi
}

git_worktree_add() {
  local path="$1" new_branch="$2" existing_branch="$3" start_ref="$4"
  local args=(worktree add)
  if [[ -n "$new_branch" ]]; then
    args+=(-b "$new_branch" "$path")
    [[ -n "$start_ref" ]] && args+=("$start_ref")
  elif [[ -n "$existing_branch" ]]; then
    args+=("$path" "$existing_branch")
  else
    args+=("$path")
  fi
  log "running: git ${args[*]}"
  git "${args[@]}" >&2
}

print_summary() {
  local wt_path="$1"
  local slug allocation_json server_port client_port redis_db
  slug="$(compute_slug "$wt_path")"
  allocation_json="$(allocation_read)"
  if ! printf '%s' "$allocation_json" | jq -e --arg s "$slug" 'has($s)' >/dev/null; then
    die "missing allocation for slug=$slug after init — see prior warnings"
  fi
  server_port="$(printf '%s' "$allocation_json" | jq -r --arg s "$slug" '.[$s].server')"
  client_port="$(printf '%s' "$allocation_json" | jq -r --arg s "$slug" '.[$s].client')"
  redis_db="$(printf '%s' "$allocation_json" | jq -r --arg s "$slug" '.[$s].redis')"

  local branch fp template_db
  branch="$(git -C "$wt_path" rev-parse --abbrev-ref HEAD 2>/dev/null || printf '<detached>')"
  fp="$(safe_compute_fingerprint "$wt_path")"
  if [[ -n "$fp" ]]; then
    template_db="$(template_db_for_fingerprint "$fp")"
  else
    template_db="<unknown>"
  fi

  local db="musi_wt_${slug}"
  local testdb="musi_wt_${slug}_test"
  local e2edb="musi_wt_${slug}_e2e"

  printf '\n# worktree:new\n'
  printf 'worktree: %s\n' "$wt_path"
  printf 'branch: %s\n' "$branch"
  printf 'slug: %s\n' "$slug"
  printf 'server_port: %s (http://localhost:%s)\n' "$server_port" "$server_port"
  printf 'client_port: %s (http://localhost:%s)\n' "$client_port" "$client_port"
  printf 'redis_db: /%s (%s)\n' "$redis_db" "$(worktree_redis_url "$redis_db")"
  printf 'db: %s\n' "$db"
  printf 'test_db: %s\n' "$testdb"
  printf 'e2e_db: %s\n' "$e2edb"
  printf 'template_db: %s\n' "$template_db"
  printf '\nnext:\n'
  printf '  cd %s\n' "$wt_path"
  printf '  bun run dev\n'
}

cmd_new() {
  parse_new_args "$@"
  require_cmd git jq

  if [[ -e "$WT_NEW_PATH" ]]; then
    die "target path already exists: $WT_NEW_PATH"
  fi

  git_worktree_add "$WT_NEW_PATH" "$WT_NEW_NEW_BRANCH" "$WT_NEW_EXISTING_BRANCH" "$WT_NEW_START_REF"

  local target
  target="$(cd "$WT_NEW_PATH" && pwd -P)" \
    || die "git worktree add reported success but $WT_NEW_PATH is not accessible"

  log "running: bun run worktree:init (in $target)"
  ( cd "$target" && bun run worktree:init >&2 ) \
    || die "worktree:init failed in $target — leaving the worktree in place for inspection"

  print_summary "$target"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  cmd_new "$@"
fi
