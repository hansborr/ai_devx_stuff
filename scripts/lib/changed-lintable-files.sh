#!/usr/bin/env bash
# Shared changed-file collection and path-policy selection for changed lint gates.
# Callers must source verify-metadata.sh first so musi_path_policy_query_nul is
# available. Results are returned in the global CHANGED_FILES and FILES arrays.

path_policy_has_match() {
  local query="$1"
  local tmp
  shift

  tmp=$(mktemp "${TMPDIR:-/tmp}/musi-changed-lint-match.XXXXXX") || return 2
  if ! printf '%s\0' "$@" | musi_path_policy_query_nul "$query" > "$tmp"; then
    rm -f "$tmp"
    return 2
  fi
  if [ -s "$tmp" ]; then
    rm -f "$tmp"
    return 0
  fi
  rm -f "$tmp"
  return 1
}

musi_collect_changed_candidates() {
  local repo_root="$1" base="$2" mode="$3"
  local changed_file file

  CHANGED_FILES=()
  changed_file=$(mktemp "${TMPDIR:-/tmp}/musi-changed-lint-input.XXXXXX") || return 2
  if ! git -C "$repo_root" diff -z --name-only --diff-filter=ACMRD "$base"...HEAD > "$changed_file" \
     || ! git -C "$repo_root" diff -z --name-only --diff-filter=ACMRD --cached >> "$changed_file"; then
    rm -f "$changed_file"
    return 2
  fi

  case "$mode" in
    gate) ;;
    agent)
      if ! git -C "$repo_root" diff -z --name-only --diff-filter=ACMRD >> "$changed_file" \
         || ! git -C "$repo_root" ls-files -z --others --exclude-standard >> "$changed_file"; then
        rm -f "$changed_file"
        return 2
      fi
      ;;
    *)
      rm -f "$changed_file"
      return 2
      ;;
  esac

  while IFS= read -r -d '' file; do
    CHANGED_FILES+=("$file")
  done < "$changed_file"
  rm -f "$changed_file"
}

musi_changed_candidates_trigger_full_scan() {
  local query="$1"

  [ "${#CHANGED_FILES[@]}" -gt 0 ] || return 1
  path_policy_has_match "$query" "${CHANGED_FILES[@]}"
}

musi_select_changed_lintable_files() {
  local repo_root="$1" query="$2"
  local selected_file file
  local -A seen=()

  FILES=()
  selected_file=$(mktemp "${TMPDIR:-/tmp}/musi-changed-lint-selected.XXXXXX") || return 2
  if ! printf '%s\0' "${CHANGED_FILES[@]}" \
    | musi_path_policy_query_nul "$query" > "$selected_file"; then
    rm -f "$selected_file"
    return 2
  fi
  while IFS= read -r -d '' file; do
    [ -f "$repo_root/$file" ] || continue
    [ -n "${seen[$file]:-}" ] && continue
    seen[$file]=1
    FILES+=("$file")
  done < "$selected_file"
  rm -f "$selected_file"
}
