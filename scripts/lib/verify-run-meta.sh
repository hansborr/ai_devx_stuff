#!/usr/bin/env bash
# Run-meta reporting shims: the bash side of verification run metadata —
# per-step and wrapper fragments, the pre-commit short-circuit history entry,
# history pruning, and the final combine into run-meta.json.
#
# Every JSON parse/serialize is delegated to the TS codec
# scripts/lib/verify-metadata-core.ts per the substrate ruling
# (docs/ai-harness.md); the functions here are thin shims around it. Writers
# create per-step fragments first so parallel pre-commit children never append
# to the same file concurrently; the wrapper combines fragments at the end of
# the run.
#
# Owns: musi_verify_meta_core_script, musi_verify_meta_core,
# musi_meta_command_string, the musi_run_meta_* family,
# musi_prune_run_meta_history, musi_persist_run_meta_history,
# musi_record_precommit_shortcircuit, musi_write_step_meta,
# musi_write_wrapper_meta, musi_restamp_verify_wrapper, musi_combine_run_meta.
#
# Source order: none — this leaf calls nothing outside itself. Leaf libs never
# source each other; scripts/lib/verify-metadata.sh is the sole public entry
# point and owns the ordering. Consumers keep sourcing that aggregator.
#
# The codec is resolved beside this file (see musi_verify_meta_core_script), so
# a sandbox that copies this lib without the codec must set
# MUSI_VERIFY_META_CORE.
#
# Standing invariant: function definitions only, no source-time side effects
# (the re-source guard below is the sole exception).

if [ -n "${__MUSI_VERIFY_RUN_META_SOURCED:-}" ]; then
  return 0
fi
__MUSI_VERIFY_RUN_META_SOURCED=1

# --- Run-meta JSON codec shims ----------------------------------------------
# The codec entrypoint is scripts/lib/verify-metadata-core.ts; resolution and
# override seam mirror musi_path_policy_query_script (MUSI_PATH_POLICY_QUERY):
#   MUSI_VERIFY_META_CORE - absolute path to the codec entrypoint
#   MUSI_VERIFY_META_BUN  - bun binary used to spawn it
# Core exit codes (fail closed, distinct per class): 0 ok, 1 verdict refusal,
# 2 usage, 3 malformed JSON, 4 invalid argument, 5 invalid fingerprint.
musi_verify_meta_core_script() {
  if [ -n "${MUSI_VERIFY_META_CORE:-}" ]; then
    printf '%s\n' "$MUSI_VERIFY_META_CORE"
    return 0
  fi

  if [ -n "${REPO_ROOT:-}" ] && [ -f "$REPO_ROOT/scripts/lib/verify-metadata-core.ts" ]; then
    printf '%s\n' "$REPO_ROOT/scripts/lib/verify-metadata-core.ts"
    return 0
  fi

  if [ -n "${BASH_SOURCE:-}" ]; then
    printf '%s\n' "$(cd "$(dirname "$BASH_SOURCE")" && pwd)/verify-metadata-core.ts"
    return 0
  fi

  printf '%s\n' "$(cd "$(dirname "$0")" && pwd)/verify-metadata-core.ts"
}

musi_verify_meta_core() {
  local script bun_bin
  script="$(musi_verify_meta_core_script)"
  bun_bin="${MUSI_VERIFY_META_BUN:-bun}"
  "$bun_bin" --config=/dev/null "$script" "$@"
}

musi_meta_command_string() {
  local out="" arg
  for arg in "$@"; do
    if [ -z "$out" ]; then
      out="$arg"
    else
      out="$out $arg"
    fi
  done
  printf '%s' "$out"
}

# Extractor shims. Legacy sed out-contract preserved: on empty input or any
# codec failure they emit nothing and return 0 — consumers already treat an
# empty result as missing/malformed metadata and fail closed on it.
musi_run_meta_wrapper_fragment() {
  local json="$1"
  local out

  [ -n "$json" ] || return 0
  out=$(printf '%s\n' "$json" | musi_verify_meta_core wrapper-fragment) || return 0
  printf '%s\n' "$out"
}

musi_run_meta_json_string_field() {
  local json="$1"
  local key="$2"
  local out

  [ -n "$json" ] || return 0
  out=$(printf '%s\n' "$json" | musi_verify_meta_core string-field "$key") || return 0
  [ -n "$out" ] || return 0
  printf '%s\n' "$out"
}

musi_run_meta_json_int_field() {
  local json="$1"
  local key="$2"
  local out

  [ -n "$json" ] || return 0
  out=$(printf '%s\n' "$json" | musi_verify_meta_core int-field "$key") || return 0
  [ -n "$out" ] || return 0
  printf '%s\n' "$out"
}

musi_run_meta_warn() {
  printf 'verify history: WARN: %s\n' "$*" >&2
}

musi_run_meta_start_epoch() {
  local start_time="$1"
  local elapsed_seconds="${2:-}"
  local epoch now

  if [ -n "$start_time" ] && epoch=$(date -d "$start_time" +%s 2>/dev/null); then
    case "$epoch" in
      ''|*[!0-9]*) ;;
      *) printf '%s\n' "$epoch"; return 0 ;;
    esac
  fi

  case "$elapsed_seconds" in
    ''|*[!0-9]*) return 1 ;;
  esac
  now=$(date +%s)
  epoch=$((now - elapsed_seconds))
  [ "$epoch" -lt 0 ] && epoch=0
  printf '%s\n' "$epoch"
}

musi_prune_run_meta_history() {
  local history_dir="$1"
  local limit="$2"
  local keep_from files

  case "$limit" in
    ''|*[!0-9]*)
      musi_run_meta_warn "invalid MUSI_VERIFY_HISTORY_LIMIT '$limit'; using 50"
      limit=50
      ;;
  esac

  keep_from=$((limit + 1))
  (
    cd "$history_dir" || exit 1
    files=$(ls -1t -- *.json 2>/dev/null || true)
    [ -n "$files" ] || exit 0
    printf '%s\n' "$files" | tail -n +"$keep_from" | xargs -r rm --
  )
}

musi_persist_run_meta_history() {
  local log_dir="$1"
  local history_dir="$2"
  local run_meta="$log_dir/run-meta.json"
  local limit="${MUSI_VERIFY_HISTORY_LIMIT:-50}"
  local json wrapper mode start_time elapsed_seconds exit_code start_epoch target

  if [ ! -f "$run_meta" ]; then
    musi_run_meta_warn "missing run metadata at $run_meta"
    return 0
  fi
  # Whole-file read (not first-line): pre-port combine wrote multi-line
  # run-meta documents, and the codec parses either shape as one document.
  if ! json=$(cat "$run_meta" 2>/dev/null); then
    musi_run_meta_warn "could not read run metadata at $run_meta"
    return 0
  fi

  wrapper=$(musi_run_meta_wrapper_fragment "$json")
  if [ -z "$wrapper" ]; then
    musi_run_meta_warn "could not find wrapper metadata in $run_meta"
    return 0
  fi

  mode=$(musi_run_meta_json_string_field "$wrapper" mode)
  start_time=$(musi_run_meta_json_string_field "$wrapper" start_time)
  elapsed_seconds=$(musi_run_meta_json_int_field "$wrapper" elapsed_seconds)
  exit_code=$(musi_run_meta_json_int_field "$wrapper" exit_code)

  case "$mode" in
    ''|*[!A-Za-z0-9._-]*)
      musi_run_meta_warn "malformed wrapper mode in $run_meta"
      return 0
      ;;
  esac
  case "$exit_code" in
    ''|*[!0-9]*)
      musi_run_meta_warn "malformed wrapper exit_code in $run_meta"
      return 0
      ;;
  esac
  if ! start_epoch=$(musi_run_meta_start_epoch "$start_time" "$elapsed_seconds"); then
    musi_run_meta_warn "malformed wrapper start_time in $run_meta"
    return 0
  fi

  if ! mkdir -p "$history_dir"; then
    musi_run_meta_warn "could not create history directory $history_dir"
    return 0
  fi

  target="$history_dir/$start_epoch-$mode-$exit_code.json"
  if ! cp "$run_meta" "$target"; then
    musi_run_meta_warn "could not write history file $target"
    return 0
  fi

  if ! musi_prune_run_meta_history "$history_dir" "$limit"; then
    musi_run_meta_warn "could not prune history directory $history_dir"
  fi

  return 0
}

# Record a minimal audit entry when a pre-commit short-circuit (fresh
# success marker) or a manual-verify marker bridge admits a commit without
# running any steps. Those paths exit before a run-meta.json exists, so unlike
# musi_persist_run_meta_history (which copies an existing run-meta) this writes
# the entry directly, using the same <epoch>-<mode>-<exit>.json history naming
# so bridged/marker landings stay greppable after the fact.
#
# Deliberately writes ONLY under history_dir: it is never handed the live
# LOG_DIR/meta/wrapper.json that .husky/pre-push reads as its verify-evidence
# fallback, so a bridged commit leaves that evidence untouched. Best-effort and
# non-fatal — the commit is already admitted, so a recording problem only warns.
#
# Args: <history_dir> <mode> <head> <fingerprint> <satisfied_marker>
#   mode: precommit-marker | precommit-bridged (embedded in the filename)
musi_record_precommit_shortcircuit() {
  local history_dir="$1"
  local mode="$2"
  local head="$3"
  local fingerprint="$4"
  local satisfied="$5"
  local limit="${MUSI_VERIFY_HISTORY_LIMIT:-50}"
  local epoch iso target json rc

  epoch=$(date +%s)
  iso=$(date -Iseconds)
  # The codec validates mode (filename-safe charset) and fingerprint and emits
  # the combined-run-meta-shaped audit document with an empty steps list.
  rc=0
  json=$(musi_verify_meta_core shortcircuit-meta \
    "$mode" "$head" "$fingerprint" "$satisfied" "$iso" < /dev/null 2>/dev/null) || rc=$?
  if [ "$rc" -ne 0 ]; then
    case "$rc" in
      4) musi_run_meta_warn "refusing to record short-circuit with malformed mode '$mode'" ;;
      5) musi_run_meta_warn "refusing to record short-circuit with invalid fingerprint" ;;
      *) musi_run_meta_warn "could not build short-circuit metadata (core exit $rc)" ;;
    esac
    return 0
  fi
  if [ -z "$json" ]; then
    musi_run_meta_warn "could not build short-circuit metadata (empty codec output)"
    return 0
  fi

  if ! mkdir -p "$history_dir"; then
    musi_run_meta_warn "could not create history directory $history_dir"
    return 0
  fi

  target="$history_dir/$epoch-$mode-0.json"
  if ! printf '%s\n' "$json" > "$target"; then
    musi_run_meta_warn "could not write history file $target"
    return 0
  fi

  if ! musi_prune_run_meta_history "$history_dir" "$limit"; then
    musi_run_meta_warn "could not prune history directory $history_dir"
  fi
  return 0
}

# Writer shims. The codec builds the document; bash keeps mkdir and the file
# write. The document is captured before the write, so a codec failure returns
# nonzero without truncating or half-writing the target file.
#
# Argv-only codec spawns redirect stdin from /dev/null: these shims run inside
# `git commit` and foreground verify, where the inherited stdin can be an
# interactive terminal, and must never hand the codec a readable stdin it
# could block on. The codec independently skips stdin for these subcommands.
musi_write_step_meta() {
  local file="$1"
  shift
  local out

  out=$(musi_verify_meta_core step-meta "$@" < /dev/null) || return 1
  [ -n "$out" ] || return 1
  mkdir -p "$(dirname "$file")" || return 1
  printf '%s\n' "$out" > "$file"
}

# Argument order is unchanged: <file> <mode> <start_epoch> <start_time>
# <end_epoch> <end_time> <exit_code> <command> [head] [fingerprint]. The codec
# refuses an invalid fingerprint (exit 5) before anything touches the file.
musi_write_wrapper_meta() {
  local file="$1"
  shift
  local out

  out=$(musi_verify_meta_core wrapper-meta "${1:-}" "${2:-}" "${3:-}" "${4:-}" "${5:-}" \
    "${6:-}" "${7:-}" "${8:-}" "${9:-}" < /dev/null) || return 1
  [ -n "$out" ] || return 1
  mkdir -p "$(dirname "$file")" || return 1
  printf '%s\n' "$out" > "$file"
}

# Re-stamp a passing verify wrapper.json (the pre-push evidence fallback that
# `.husky/pre-push` reads at `<verify-log-dir>/meta/wrapper.json`) onto a new
# HEAD/fingerprint, so no artifact still points at the pre-merge HEAD after a
# re-stamped land. Preserves mode/start_time/command and refreshes end_time to
# now. Refuses unless the existing wrapper records a passing (exit 0)
# serial/parallel verify — it never fabricates a fresh pass from nothing.
#
# Args: <wrapper_json> <new_head> <new_fingerprint>
# Returns: 0 re-stamped; 1 missing or non-passing wrapper.
musi_restamp_verify_wrapper() {
  local wrapper="$1"
  local new_head="$2"
  local new_fingerprint="$3"
  local json out now_epoch now_iso

  [ -f "$wrapper" ] || return 1
  json=$(cat "$wrapper" 2>/dev/null) || return 1
  [ -n "$json" ] || return 1

  now_epoch=$(date +%s)
  now_iso=$(date -Iseconds)
  # The codec refuses (exit 1) unless the wrapper records a passing
  # serial/parallel verify, and preserves mode/start_time/command; only a
  # successful transform overwrites the file.
  out=$(printf '%s\n' "$json" | musi_verify_meta_core restamp-wrapper \
    "$new_head" "$new_fingerprint" "$now_epoch" "$now_iso") || return 1
  [ -n "$out" ] || return 1
  printf '%s\n' "$out" > "$wrapper"
}

# Bash globs the fragment files (orchestration) and hands the codec one
# single-line JSON document per stdin line: line 1 is the wrapper fragment (or
# the literal `null` when it is missing), the rest are step fragments. The
# codec drops malformed fragments instead of embedding garbage, so
# run-meta.json is always well-formed JSON; on a codec/spawn failure the stale
# output is removed rather than left lying (fail closed, non-fatal like the
# legacy writer).
musi_combine_run_meta() {
  local log_dir="$1"
  local mode="$2"
  local wrapper_fragment="$3"
  local output="$log_dir/run-meta.json"
  local fragment wrapper_line out

  wrapper_line=""
  if [ -f "$wrapper_fragment" ]; then
    wrapper_line=$(sed -n '1p' "$wrapper_fragment" 2>/dev/null) || wrapper_line=""
  fi
  [ -n "$wrapper_line" ] || wrapper_line=null

  if ! out=$(
    {
      printf '%s\n' "$wrapper_line"
      for fragment in "$log_dir"/meta/*.json; do
        [ -f "$fragment" ] || continue
        [ "$fragment" = "$wrapper_fragment" ] && continue
        sed -n '1p' "$fragment"
      done
    } | musi_verify_meta_core combine "$mode" "$(date -Iseconds)"
  ); then
    musi_run_meta_warn "could not combine run metadata into $output"
    rm -f "$output"
    return 0
  fi
  # Empty output means the spawn was intercepted (e.g. a stubbed bun): treat
  # it like a codec failure rather than writing an empty document.
  if [ -z "$out" ]; then
    musi_run_meta_warn "could not combine run metadata into $output"
    rm -f "$output"
    return 0
  fi
  printf '%s\n' "$out" > "$output"
}
