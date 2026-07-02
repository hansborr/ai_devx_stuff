#!/usr/bin/env bash
# Dispatch wrapper for delegated Codex runs: owns the devcontainer
# sandbox-bypass flags, owns the stdin policy (codex 0.142.5 blocks
# reading any open non-TTY stdin to EOF, so only a deliberate
# regular-file attach may reach it), and serializes runs per worktree so
# a retry cannot start a second Codex against the same working copy.
# Rejects codex's -C/--cd: the lock guards the wrapper's cwd, so the run
# must be dispatched from the worktree it mutates.
# Exit 2: usage error. Exit 3: another Codex run holds this worktree.
set -euo pipefail
if [ $# -lt 1 ]; then
  echo "Usage: codex-run.sh <codex-subcommand> [args...]" >&2
  exit 2
fi
for arg in "$@"; do
  case "$arg" in
    -C | --cd | --cd=*)
      echo "codex-run.sh: $arg moves the run off this worktree's lock; dispatch from the worktree the run should mutate" >&2
      exit 2
      ;;
  esac
done
# Keep stdin only when it is a regular file (a deliberate `< material`
# attach for `exec`); close every other kind — codex blocks reading an open
# non-TTY stdin to EOF, so a backgrounded dispatch inheriting a never-closing
# pipe would hang before the run starts, holding the worktree lock. `exec
# resume` ignores stdin entirely (0.139.0 and 0.142.5), so an attach there is
# a silently dropped payload — reject it loudly instead.
if [ -f /dev/stdin ]; then
  if [ "${1-}" = "exec" ] && [ "${2-}" = "resume" ] && [ -s /dev/stdin ]; then
    echo "codex-run.sh: 'exec resume' ignores stdin; put the material in the prompt argument or reference a file path for Codex to read" >&2
    exit 2
  fi
else
  exec </dev/null
fi
cmd=(codex -c sandbox_mode=danger-full-access -a never "$@")
if git_dir=$(git rev-parse --git-dir 2>/dev/null) && command -v flock >/dev/null 2>&1; then
  exec flock -n -E 3 "$git_dir/codex-run.lock" "${cmd[@]}"
fi
exec "${cmd[@]}"
