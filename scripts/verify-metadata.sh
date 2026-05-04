#!/usr/bin/env bash
# Helpers for verification timing metadata shared by pre-commit, verify, and
# verify:logs. Writers create per-step fragments first so parallel pre-commit
# children never append to the same file concurrently; the wrapper combines
# fragments into run-meta.json at the end of the run.

musi_meta_json_escape() {
  local s="${1-}"
  printf '%s' "$s" | awk '
    {
      gsub(/\\/, "\\\\")
      gsub(/"/, "\\\"")
      gsub(/\t/, "\\t")
      gsub(/\r/, "\\r")
      if (NR > 1) {
        printf "\\n"
      }
      printf "%s", $0
    }
  '
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

musi_write_step_meta() {
  local file="$1"
  local name="$2"
  local mode="$3"
  local start_epoch="$4"
  local start_time="$5"
  local end_epoch="$6"
  local end_time="$7"
  local exit_code="$8"
  local command="$9"
  local elapsed=$((end_epoch - start_epoch))
  [ "$elapsed" -lt 0 ] && elapsed=0

  mkdir -p "$(dirname "$file")"
  {
    printf '{'
    printf '"name":"%s",' "$(musi_meta_json_escape "$name")"
    printf '"mode":"%s",' "$(musi_meta_json_escape "$mode")"
    printf '"start_time":"%s",' "$(musi_meta_json_escape "$start_time")"
    printf '"end_time":"%s",' "$(musi_meta_json_escape "$end_time")"
    printf '"elapsed_seconds":%s,' "$elapsed"
    printf '"exit_code":%s,' "$exit_code"
    printf '"command":"%s"' "$(musi_meta_json_escape "$command")"
    printf '}\n'
  } > "$file"
}

musi_write_wrapper_meta() {
  local file="$1"
  local mode="$2"
  local start_epoch="$3"
  local start_time="$4"
  local end_epoch="$5"
  local end_time="$6"
  local exit_code="$7"
  local command="$8"
  musi_write_step_meta "$file" wrapper "$mode" "$start_epoch" "$start_time" "$end_epoch" "$end_time" "$exit_code" "$command"
}

musi_combine_run_meta() {
  local log_dir="$1"
  local mode="$2"
  local wrapper_fragment="$3"
  local output="$log_dir/run-meta.json"
  local first=1 fragment

  {
    printf '{'
    printf '"version":1,'
    printf '"mode":"%s",' "$(musi_meta_json_escape "$mode")"
    printf '"generated_at":"%s",' "$(date -Iseconds)"
    printf '"wrapper":'
    if [ -f "$wrapper_fragment" ]; then
      cat "$wrapper_fragment"
    else
      printf 'null'
    fi
    printf ',"steps":['
    for fragment in "$log_dir"/meta/*.json; do
      [ -f "$fragment" ] || continue
      [ "$fragment" = "$wrapper_fragment" ] && continue
      if [ "$first" -eq 0 ]; then
        printf ','
      fi
      first=0
      cat "$fragment"
    done
    printf ']}\n'
  } > "$output"
}
