#!/usr/bin/env bash
# mutation-run.sh — supervised wrapper around one Stryker mutation lane.
#
# Three of this repo's Stryker lanes set `inPlace: true`: Stryker writes into
# the contributor's active worktree over runs that are meant to take hours.
#
# What "in place" writes is wider than the lane's `mutate` globs, and the whole
# design below follows from that. Checked against @stryker-mutator/core 9.6.1:
#
#   - `disableTypeChecks` defaults to `true` (schema/stryker-schema.json), and
#     none of the three lanes overrides it — `stryker.shared.mjs` deliberately
#     does not expose the key (CQ25-221 owns that allowlist).
#   - With `true`, config/file-matcher.js expands it to
#     `**/*.{js,ts,jsx,tsx,html,vue,mjs,mts,cts,cjs}` and
#     sandbox/disable-type-checks-preprocessor.js runs over `project.files` —
#     every crawled input file, not just the mutate targets. Each one gets
#     `// @ts-nocheck` prefixed (instrumenter's disable-type-checks.js).
#   - fs/project-reader.js crawls the whole working directory minus a small
#     always-ignore list (node_modules, .git, .stryker-tmp, the report files);
#     `.gitignore` is not consulted.
#   - sandbox/sandbox.js#sandboxFile then backs up and rewrites *every* file
#     with changes. So an in-place run rewrites thousands of files, of which the
#     mutate targets are a small subset.
#
# That makes `.stryker-tmp/backup-<mkdtemp>` — not git — the complete restore
# source: it holds the pre-run contents of everything the run rewrote,
# *including the operator's unrelated uncommitted work* in files outside the
# mutate globs. `git restore` over the mutate targets would leave every other
# file carrying `@ts-nocheck`, and over a wider scope it would destroy that
# uncommitted work outright. Stryker itself restores by moving that directory
# back (fileUtils.moveDirectoryRecursiveSync from Sandbox.dispose), and it does
# so on a clean exit and on the signals it handles (SIGABRT/SIGINT/SIGHUP/
# SIGTERM — see unexpected-exit-handler.js). What it cannot cover is a kill it
# never observes: SIGKILL, an OOM kill, a container that dies under an overnight
# run. After one of those, the backup directory survives and the worktree is
# still full of rewritten files.
#
# This runner adds three rails around that window:
#
#   1. Preflight. Resolve the lane's `mutate` globs — or the `-m/--mutate`
#      override, when the invocation carries one — to tracked files and refuse
#      to start if any of them is modified (staged or unstaged), or if an
#      untracked file matches them. Only the targets are checked — an overnight
#      run must not require the whole tree to be clean, and the wider write
#      scope is recoverable from the backup regardless. What preflight buys is
#      the git *fallback*: once the targets are known-clean at start, a
#      `git restore` over exactly them is lossless, which is what makes recovery
#      possible even when no backup directory survives.
#   2. Stale-state detection. A leftover `.stryker-tmp/backup-*` means an
#      earlier run was interrupted. Refuse to start, print recovery commands
#      that work as printed, and perform recovery under `--restore`. `--restore`
#      deliberately requires that marker, so it can never be the command that
#      silently discards ordinary uncommitted work.
#   3. Exit trap. Keep the `stryker-setup-*.js` scratch cleanup the inline
#      wrappers had, and extend it to recover the worktree. This is a second
#      line behind Stryker's own handler, for what that handler misses (the
#      wrapper killed while Stryker is mid-write; Stryker dying before its
#      handler runs). No trap fires on SIGKILL or an OOM kill — rail 2, not this
#      one, is what covers those.
#
# Recovery in rails 2 and 3 is always backup-first: move `.stryker-tmp/backup-*`
# back over the worktree exactly as Stryker's own dispose does, and only then
# fall back to `git restore` over the recorded preflight list for whatever the
# backup did not cover (a kill that landed before Stryker had written one).
#
# Sandboxed lanes (no `inPlace`) get none of the rails: they never touch the
# worktree, so they keep exactly the scratch-file cleanup they had before, and
# they are not held to any stricter config contract than `stryker run` itself.
#
# Usage:
#   bash scripts/mutation-run.sh [--restore] [<stryker-config>] [<stryker args>...]
#
# The config argument is optional and is passed through to `stryker run`
# untouched; with none, Stryker's own config-file lookup applies. Every other
# argument is forwarded verbatim. `-m/--mutate` is forwarded *and* read: in
# Stryker it replaces the config's globs, so the rails resolve their target
# scope from it too. Preflighting the config's globs while the run mutates a
# different set is a silent under-preflight, and it would leave the git
# fallback unable to restore what was actually mutated.
#
# Env:
#   MUSI_MUTATION_RUN_STRYKER — command used to invoke Stryker; default is the
#                               repo's own node_modules/.bin/stryker, falling
#                               back to `stryker` on PATH. Tests use it to stub
#                               the run.

set -uo pipefail

LABEL="mutation-run"
SCRATCH_GLOB="stryker-setup-*.js"
STRYKER_TMP_DIR=".stryker-tmp"
RUN_MARKER="$STRYKER_TMP_DIR/mutation-run.pid"
USAGE_EXIT_CODE=2
PREFLIGHT_EXIT_CODE=1
SANDBOXED_LANE_EXIT_CODE=3
# resolve_targets: the candidate producer (git) failed rather than the resolver,
# so an empty result must not be read as "nothing matches". Deliberately
# distinct from the resolver's own 2 (bad config) and 3 (sandboxed lane).
CANDIDATE_SOURCE_EXIT_CODE=4

usage() {
  cat <<'EOF'
usage: mutation-run.sh [--restore] [<stryker-config>] [<stryker args>...]

Runs one Stryker lane. For an in-place lane, refuses to start unless the lane's
mutate targets are clean and no interrupted run is detected, and recovers the
worktree on exit.

-m/--mutate <globs>: forwarded to Stryker and honoured by the rails. Stryker
           takes these comma-separated globs over the config's, so preflight
           and recovery resolve their target scope from them too.

--restore: recover from an interrupted in-place run and then continue. Recovery
           moves Stryker's own .stryker-tmp/backup-* directory back over the
           worktree — the complete pre-run state, including uncommitted work in
           files outside the mutate globs — and only falls back to git for
           targets the backup did not cover. Refuses unless a
           .stryker-tmp/backup-* directory proves a run was interrupted, so it
           cannot discard ordinary uncommitted work.
EOF
}

# Resolved before the cd, so the sibling resolver is found by this script's own
# location rather than by whichever worktree it is supervising.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MUTATION_TARGETS="$SCRIPT_DIR/mutation-targets.ts"

if ! REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  printf '%s: not inside a git worktree.\n' "$LABEL" >&2
  exit "$USAGE_EXIT_CODE"
fi
cd "$REPO_ROOT" || exit "$USAGE_EXIT_CODE"

RESTORE=0
STRYKER_ARGS=()
LANE_CONFIG=""
MUTATE_OVERRIDE=""
MUTATE_OVERRIDDEN=0

# `stryker run -m/--mutate <globs>` replaces the config's `mutate` (commander
# parses the value with createSplitter(','), and the last flag wins because that
# splitter ignores the previous value). The rails must see the same set Stryker
# will mutate, so the override is recorded here and passed to the resolver.
take_mutate_override() {
  MUTATE_OVERRIDE="$1"
  MUTATE_OVERRIDDEN=1
}

while [ "$#" -gt 0 ]; do
  arg="$1"
  shift
  case "$arg" in
    --restore)
      RESTORE=1
      continue
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --mutate|-m)
      STRYKER_ARGS+=("$arg")
      if [ "$#" -gt 0 ]; then
        take_mutate_override "$1"
        STRYKER_ARGS+=("$1")
        shift
      fi
      continue
      ;;
    --mutate=*)
      take_mutate_override "${arg#--mutate=}"
      ;;
    -m?*)
      take_mutate_override "${arg#-m}"
      ;;
    *)
      # The first argument naming an existing Stryker config file is the lane;
      # `stryker run [configFile]` reads it the same way. That argument is
      # forwarded too — the runner only needs to know which config to import.
      if [ -z "$LANE_CONFIG" ] && [ -f "$arg" ]; then
        case "$arg" in
          *.mjs|*.cjs|*.js|*.json) LANE_CONFIG="$arg" ;;
        esac
      fi
      ;;
  esac
  STRYKER_ARGS+=("$arg")
done

# Resolve the local bin first, the way scripts/vitest.sh and scripts/typecheck.sh
# do. Bare `stryker` only exists on PATH under `bun run`, which would make every
# recovery command this script prints die with "command not found" the moment an
# operator pasted it into a plain shell.
if [ -n "${MUSI_MUTATION_RUN_STRYKER:-}" ]; then
  STRYKER_BIN="$MUSI_MUTATION_RUN_STRYKER"
elif [ -x "$REPO_ROOT/node_modules/.bin/stryker" ]; then
  STRYKER_BIN="$REPO_ROOT/node_modules/.bin/stryker"
else
  STRYKER_BIN="stryker"
fi

# State the traps read. RECORDED_TARGETS is the *recorded* preflight list: the
# git fallback restores exactly this list and never a re-evaluated glob, so its
# scope can never drift from the scope preflight proved clean.
TARGETS_FILE=""
UNTRACKED_FILE=""
RAILS_ACTIVE=0
STRYKER_PID=""
RECORDED_TARGETS=()

cleanup_scratch_files() {
  # shellcheck disable=SC2086 # deliberate glob expansion of the scratch pattern
  rm -f $SCRATCH_GLOB
}

remove_state_files() {
  [ -n "$TARGETS_FILE" ] && rm -f "$TARGETS_FILE"
  [ -n "$UNTRACKED_FILE" ] && rm -f "$UNTRACKED_FILE"
  return 0
}

# Stryker's in-place backup directory is an mkdtemp name (`backup-XXXXXX`), so
# its presence — not a fixed path — is the interrupted-run signal.
backup_dirs() {
  find "$STRYKER_TMP_DIR" -maxdepth 1 -type d -name 'backup-*' -print 2>/dev/null
}

has_interrupted_run_marker() {
  [ -n "$(backup_dirs)" ]
}

# Move one backup tree back over the worktree. This is a transcription of
# Stryker's own fileUtils.moveDirectoryRecursiveSync, which is what
# Sandbox.dispose calls: every backed-up file is renamed onto its repo-relative
# path and the directory is then removed. Files the run never changed are not in
# the backup and are left alone.
restore_from_backup_dir() {
  local dir="$1" file rel
  while IFS= read -r -d '' file; do
    rel="${file#"$dir"/}"
    mkdir -p -- "$(dirname -- "$rel")" || return 1
    mv -f -- "$file" "$rel" || return 1
  done < <(find "$dir" -type f -print0 2>/dev/null)
  rm -rf -- "$dir"
  return 0
}

# Nothing to restore from is not a failure: the git fallback below covers the
# kill that landed before Stryker wrote a backup.
restore_from_backup_dirs() {
  local dir status=0
  while IFS= read -r dir; do
    [ -n "$dir" ] || continue
    restore_from_backup_dir "$dir" || status=1
  done < <(backup_dirs)
  return "$status"
}

# The recorded targets that are dirty right now, one per line. git does the
# scoping (the recorded list is the pathspec), so the answer cannot drift out of
# the preflight scope. `--no-renames` keeps every record a plain `XY <path>`.
dirty_recorded_targets() {
  local entry
  [ "${#RECORDED_TARGETS[@]}" -gt 0 ] || return 0
  while IFS= read -r -d '' entry; do
    printf '%s\n' "${entry:3}"
  done < <(git status --porcelain=v1 -z --untracked-files=no --no-renames \
    -- "${RECORDED_TARGETS[@]}" 2>/dev/null)
  return 0
}

restore_recorded_targets() {
  git restore --worktree --pathspec-from-file="$TARGETS_FILE" --pathspec-file-nul
}

# Backup first, git second. The backup holds the pre-run contents of every file
# the run rewrote, so it is both the complete restore and the only one that
# preserves uncommitted work outside the mutate globs. git is the fallback for
# the case the backup cannot cover: a kill that landed before Stryker wrote one.
recover_worktree() {
  local status=0
  restore_from_backup_dirs || status=1
  if [ -n "$(dirty_recorded_targets)" ]; then
    restore_recorded_targets || status=1
  fi
  return "$status"
}

print_paths() {
  sed "s/^/$LABEL:   - /" >&2
}

print_recovery_command() {
  printf '%s: recover with:\n' "$LABEL" >&2
  if [ -n "$LANE_CONFIG" ]; then
    printf '%s:   bash scripts/mutation-run.sh --restore %s\n' "$LABEL" "$LANE_CONFIG" >&2
  else
    printf '%s:   bash scripts/mutation-run.sh --restore\n' "$LABEL" >&2
  fi
  if has_interrupted_run_marker; then
    printf '%s: or by hand, moving Stryker'"'"'s backup back the way it does itself on a clean exit:\n' \
      "$LABEL" >&2
    printf '%s:   for d in %s/backup-*/; do cp -a "$d." . && rm -rf "$d"; done\n' \
      "$LABEL" "$STRYKER_TMP_DIR" >&2
    printf '%s: use the backup, not git: the run also rewrote every other JS/TS file in the tree\n' \
      "$LABEL" >&2
    printf '%s: (disableTypeChecks prefixes @ts-nocheck), and the backup is what holds your\n' "$LABEL" >&2
    printf '%s: uncommitted work in those files. Do not delete %s before restoring from it.\n' \
      "$LABEL" "$STRYKER_TMP_DIR" >&2
  else
    printf '%s: no backup directory survives, so git is all that is left, and it reaches\n' "$LABEL" >&2
    printf '%s: only the mutate targets:\n' "$LABEL" >&2
    if [ "$#" -gt 0 ]; then
      printf '%s:   git restore --worktree -- %s\n' "$LABEL" "$*" >&2
    else
      printf '%s:   git restore --worktree -- <mutate target paths>\n' "$LABEL" >&2
    fi
  fi
}

# A supervised run writes its pid here for the length of the run. Without it,
# `.stryker-tmp/backup-*` cannot tell an interrupted run from a healthy one that
# is still going in another terminal — and recovering over a live run is exactly
# the stranding this script exists to prevent.
#
# The marker records three lines: the pid, an identity for the process that
# claimed it, and the lane it was claiming for. The identity is what keeps the
# marker from wedging recovery after the SIGKILL/OOM this script exists for: no
# trap fires then, so the marker outlives the run, and a bare `kill -0` on a
# recycled pid would name an unrelated process and make the recovery rail
# unreachable in exactly the case it was built for.
process_start_identity() {
  ps -o lstart= -p "$1" 2>/dev/null | tr -s '[:space:]' ' ' | sed 's/^ //;s/ $//'
}

claim_run_marker() {
  mkdir -p "$STRYKER_TMP_DIR" || return 1
  {
    printf '%s\n' "$$"
    printf '%s\n' "$(process_start_identity "$$")"
    printf '%s\n' "${LANE_CONFIG:-<Stryker default config>}"
  } > "$RUN_MARKER"
}

release_run_marker() {
  rm -f "$RUN_MARKER"
  rmdir "$STRYKER_TMP_DIR" 2>/dev/null
  return 0
}

# Echo the pid of another live supervised run, or fail if there is none.
live_supervised_run_pid() {
  local pid recorded current
  [ -f "$RUN_MARKER" ] || return 1
  pid="$(sed -n '1p' "$RUN_MARKER" 2>/dev/null)"
  case "$pid" in
    ''|*[!0-9]*) return 1 ;;
  esac
  [ "$pid" = "$$" ] && return 1
  kill -0 "$pid" 2>/dev/null || return 1
  recorded="$(sed -n '2p' "$RUN_MARKER" 2>/dev/null)"
  current="$(process_start_identity "$pid")"
  # A mismatch means the pid was recycled, so this is a stale marker, not a
  # live run. Both sides have to be known before that can be concluded: where
  # `ps` cannot answer, the liveness check above is all there is.
  if [ -n "$recorded" ] && [ -n "$current" ] && [ "$recorded" != "$current" ]; then
    return 1
  fi
  printf '%s\n' "$pid"
}

refuse_over_live_run() {
  local pid="$1" lane
  lane="$(sed -n '3p' "$RUN_MARKER" 2>/dev/null)"
  printf '%s: another supervised run is in progress (pid %s%s); this is not an interrupted run.\n' \
    "$LABEL" "$pid" "${lane:+, lane $lane}" >&2
  printf '%s: recovering now would move its backup out from under it and strand its mutants.\n' \
    "$LABEL" >&2
  printf '%s: wait for it to finish, or stop it and re-run this command.\n' "$LABEL" >&2
  printf '%s: if no such run exists, the marker is stale — it outlives a SIGKILL, since no trap\n' \
    "$LABEL" >&2
  printf '%s: fires then. Clear it with: rm %s\n' "$LABEL" "$RUN_MARKER" >&2
}

on_exit() {
  local status="$1" stranded
  cleanup_scratch_files
  if [ "$RAILS_ACTIVE" -eq 1 ]; then
    stranded="$(dirty_recorded_targets)"
    if [ -n "$stranded" ]; then
      printf '%s: stranded mutants in %s mutate target(s); recovering the worktree.\n' \
        "$LABEL" "$(printf '%s\n' "$stranded" | wc -l | tr -d ' ')" >&2
      printf '%s\n' "$stranded" | print_paths
    fi
    if [ -n "$stranded" ] || has_interrupted_run_marker; then
      if ! recover_worktree || [ -n "$(dirty_recorded_targets)" ]; then
        printf '%s: could not fully recover the worktree.\n' "$LABEL" >&2
        # shellcheck disable=SC2086 # word splitting is the intended path list
        print_recovery_command $stranded
      fi
    fi
    # Released only here: for the whole of the recovery above, `.stryker-tmp`
    # holds a backup directory, and without the marker beside it another
    # terminal's `--restore` would read that as an interrupted run and race
    # this one's `mv`/`rm -rf` over the same tree.
    release_run_marker
  fi
  remove_state_files
  exit "$status"
}

forward_signal() {
  [ -n "$STRYKER_PID" ] && kill -"$1" "$STRYKER_PID" 2>/dev/null
  return 0
}

# Resolve one NUL-delimited path list through the lane's mutate globs. Exits 3
# for a sandboxed lane and 2 for an unreadable config, per mutation-targets.ts,
# and CANDIDATE_SOURCE_EXIT_CODE when the candidate producer itself failed.
resolve_targets() {
  local output_file="$1"
  shift

  local resolver_args=()
  [ -n "$LANE_CONFIG" ] && resolver_args=(--config "$LANE_CONFIG")
  [ "$MUTATE_OVERRIDDEN" -eq 1 ] && resolver_args+=(--mutate "$MUTATE_OVERRIDE")
  "$@" | bun "$MUTATION_TARGETS" "${resolver_args[@]}" --require-in-place > "$output_file"
  local producer_status="${PIPESTATUS[0]}" resolver_status="${PIPESTATUS[1]}"
  # The resolver's answer wins when it has one: 3 classifies the lane as
  # sandboxed whatever the producer did, and 2 is the resolver's own failure.
  # Only then does the producer matter — this function cannot return
  # `pipefail`'s status without losing those codes, and a `git ls-files` that
  # died looks from here exactly like a clean, empty target set.
  [ "$resolver_status" -ne 0 ] && return "$resolver_status"
  [ "$producer_status" -ne 0 ] && return "$CANDIDATE_SOURCE_EXIT_CODE"
  return 0
}

# --- Lane classification ----------------------------------------------------

# One trap instead of a cleanup call on every abort path below; the
# supervised-run trap installed later calls remove_state_files itself, and the
# sandboxed-lane trap chains it.
trap 'remove_state_files' EXIT

if ! TARGETS_FILE="$(mktemp "${TMPDIR:-/tmp}/musi-mutation-targets.XXXXXX")"; then
  printf '%s: failed to allocate preflight state.\n' "$LABEL" >&2
  exit "$USAGE_EXIT_CODE"
fi
resolve_targets "$TARGETS_FILE" git ls-files -z
resolve_status=$?

if [ "$resolve_status" -eq "$SANDBOXED_LANE_EXIT_CODE" ]; then
  # Sandboxed lane: Stryker copies the tree, so the worktree is never at risk
  # and the rails would only cost startup time and false refusals.
  trap 'remove_state_files; cleanup_scratch_files' EXIT INT TERM
  "$STRYKER_BIN" run "${STRYKER_ARGS[@]}"
  exit $?
fi

if [ "$resolve_status" -eq "$CANDIDATE_SOURCE_EXIT_CODE" ]; then
  # Fail closed for the same reason the untracked pass does below: an empty
  # candidate list from a broken `git ls-files` preflights as spotless.
  printf '%s: could not list the worktree tracked files; refusing to start.\n' "$LABEL" >&2
  exit "$PREFLIGHT_EXIT_CODE"
fi

if [ "$resolve_status" -ne 0 ]; then
  printf '%s: could not resolve the lane mutate globs.\n' "$LABEL" >&2
  exit "$USAGE_EXIT_CODE"
fi

mapfile -d '' RECORDED_TARGETS < "$TARGETS_FILE"

if [ "${#RECORDED_TARGETS[@]}" -eq 0 ]; then
  printf '%s: the lane mutate globs match no tracked files; refusing to run blind.\n' "$LABEL" >&2
  exit "$PREFLIGHT_EXIT_CODE"
fi

# --- Stale-state detection and preflight ------------------------------------

if LIVE_RUN_PID="$(live_supervised_run_pid)"; then
  refuse_over_live_run "$LIVE_RUN_PID"
  exit "$PREFLIGHT_EXIT_CODE"
fi

if [ "$RESTORE" -eq 1 ]; then
  if ! has_interrupted_run_marker; then
    printf '%s: --restore needs evidence of an interrupted run (%s/backup-*), and none is present.\n' \
      "$LABEL" "$STRYKER_TMP_DIR" >&2
    printf '%s: dirty mutate targets without that marker are ordinary uncommitted work; commit or stash them instead.\n' \
      "$LABEL" >&2
    exit "$PREFLIGHT_EXIT_CODE"
  fi
  printf '%s: recovering from an interrupted run: moving %s/backup-* back over the worktree.\n' \
    "$LABEL" "$STRYKER_TMP_DIR" >&2
  if ! recover_worktree; then
    printf '%s: recovery failed; not starting a new run.\n' "$LABEL" >&2
    exit "$PREFLIGHT_EXIT_CODE"
  fi
fi

if has_interrupted_run_marker; then
  printf '%s: a previous in-place run was interrupted (%s/backup-* is present).\n' \
    "$LABEL" "$STRYKER_TMP_DIR" >&2
  printf '%s: its rewrites are still on disk in this worktree, mutate targets and beyond.\n' "$LABEL" >&2
  # shellcheck disable=SC2046 # word splitting is the intended path list
  print_recovery_command $(dirty_recorded_targets)
  exit "$PREFLIGHT_EXIT_CODE"
fi

DIRTY="$(dirty_recorded_targets)"
if [ -n "$DIRTY" ]; then
  printf '%s: mutate targets have staged or unstaged changes; refusing to start.\n' "$LABEL" >&2
  printf '%s: an in-place run would mix mutants into this work with no way to tell them apart.\n' "$LABEL" >&2
  printf '%s: commit or stash these first:\n' "$LABEL" >&2
  printf '%s\n' "$DIRTY" | print_paths
  exit "$PREFLIGHT_EXIT_CODE"
fi

if ! UNTRACKED_FILE="$(mktemp "${TMPDIR:-/tmp}/musi-mutation-untracked.XXXXXX")"; then
  printf '%s: failed to allocate preflight state.\n' "$LABEL" >&2
  exit "$USAGE_EXIT_CODE"
fi
resolve_targets "$UNTRACKED_FILE" git ls-files --others --exclude-standard -z
untracked_status=$?
if [ "$untracked_status" -ne 0 ]; then
  # Fail closed: an empty result here is indistinguishable from "the resolver
  # broke", and untracked targets are the one case git cannot recover at all.
  printf '%s: could not resolve untracked mutate targets (exit %s); refusing to start.\n' \
    "$LABEL" "$untracked_status" >&2
  exit "$PREFLIGHT_EXIT_CODE"
fi
if [ -s "$UNTRACKED_FILE" ]; then
  printf '%s: untracked files match the lane mutate globs; refusing to start.\n' "$LABEL" >&2
  printf '%s: Stryker would mutate them in place and git could not restore them.\n' "$LABEL" >&2
  tr '\0' '\n' < "$UNTRACKED_FILE" | print_paths
  exit "$PREFLIGHT_EXIT_CODE"
fi

# --- Supervised run ---------------------------------------------------------

RAILS_ACTIVE=1
trap 'on_exit $?' EXIT
trap 'forward_signal INT' INT
trap 'forward_signal TERM' TERM
claim_run_marker

printf '%s: %s mutate target(s) verified clean; starting the in-place run.\n' \
  "$LABEL" "${#RECORDED_TARGETS[@]}" >&2

"$STRYKER_BIN" run "${STRYKER_ARGS[@]}" &
STRYKER_PID=$!

# `wait` returns 128+n when a trapped signal interrupts it, not when the child
# exits, so keep waiting until the child is actually reaped. Recovering while
# Stryker is still mid-write is exactly the race this avoids.
STRYKER_STATUS=0
while :; do
  wait "$STRYKER_PID"
  STRYKER_STATUS=$?
  kill -0 "$STRYKER_PID" 2>/dev/null || break
done

exit "$STRYKER_STATUS"
