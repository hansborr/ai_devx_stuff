#!/usr/bin/env bash
# Path policy and staged-change classification: the bash bridge to the
# path-policy query engine, the staged/untracked selectors built on it, and the
# staged and pre-commit fingerprints those selectors feed.
#
# Every path classification goes through scripts/path-policy/path-policy-query.ts
# (see musi_path_policy_query_script for the MUSI_PATH_POLICY_QUERY seam), so the
# gates and the policy share one definition of "source-relevant". Selectors speak
# NUL-delimited paths end to end because a source-relevant path may contain a
# newline.
#
# Owns: musi_path_policy_query_script, musi_path_policy_query_nul,
# musi_path_policy_query_lines, musi_path_policy_path_matches,
# ai_staged_fingerprint, musi_changed_gate_relevant_path,
# musi_staged_source_paths_nul, musi_staged_has_source_relevant_change,
# musi_staged_blob_nul_status, musi_staged_source_blobs_reject_nul,
# ai_precommit_tracked_relevant_path, ai_precommit_untracked_relevant_path,
# musi_changed_gate_fail_if_unstaged, ai_precommit_fingerprint,
# musi_staged_has_script_relevant_deletion, musi_nul_paths_are_line_safe,
# musi_classify_staged_script_input.
#
# The last three sat lexically among the success-marker codecs but are
# staged-classification helpers consumed by scripts/verify/steps-lib.sh, so they
# live here: membership follows the call graph, not lexical position.
#
# Source order: calls musi_git_readonly, musi_fingerprint_digest_file, and
# musi_git_common_identity_path from scripts/lib/verify-state-paths.sh.
# Bash resolves those at call time, so no ordering is required — and
# leaf libs never source each other regardless: verify-metadata.sh is the sole
# public entry point and owns the ordering. Consumers keep sourcing that
# aggregator.
#
# Standing invariant: function definitions only, no source-time side effects
# (the re-source guard below is the sole exception).

if [ -n "${__MUSI_VERIFY_PATH_POLICY_SOURCED:-}" ]; then
  return 0
fi
__MUSI_VERIFY_PATH_POLICY_SOURCED=1

musi_path_policy_query_script() {
  if [ -n "${MUSI_PATH_POLICY_QUERY:-}" ]; then
    printf '%s\n' "$MUSI_PATH_POLICY_QUERY"
    return 0
  fi

  if [ -n "${REPO_ROOT:-}" ] && [ -f "$REPO_ROOT/scripts/path-policy/path-policy-query.ts" ]; then
    printf '%s\n' "$REPO_ROOT/scripts/path-policy/path-policy-query.ts"
    return 0
  fi

  if [ -n "${BASH_SOURCE:-}" ]; then
    printf '%s\n' "$(cd "$(dirname "$BASH_SOURCE")/.." && pwd)/path-policy/path-policy-query.ts"
    return 0
  fi

  printf '%s\n' "$(cd "$(dirname "$0")/.." && pwd)/path-policy/path-policy-query.ts"
}

musi_path_policy_query_nul() {
  local query="$1"
  local script bun_bin tmp
  script="$(musi_path_policy_query_script)"
  bun_bin="${MUSI_PATH_POLICY_BUN:-bun}"
  tmp=$(mktemp "${TMPDIR:-/tmp}/musi-path-policy-query.XXXXXX") || return 2
  if ! "$bun_bin" --config=/dev/null "$script" "$query" > "$tmp"; then
    rm -f "$tmp"
    return 2
  fi
  if ! cat "$tmp"; then
    rm -f "$tmp"
    return 2
  fi
  rm -f "$tmp"
}

musi_path_policy_query_lines() {
  local query="$1"
  local tmp status
  tmp=$(mktemp "${TMPDIR:-/tmp}/musi-path-policy-lines.XXXXXX") || return 2
  if ! musi_path_policy_query_nul "$query" > "$tmp"; then
    rm -f "$tmp"
    return 2
  fi
  tr '\0' '\n' < "$tmp"
  status=$?
  rm -f "$tmp"
  return "$status"
}

musi_path_policy_path_matches() {
  local query="$1"
  local path="$2"
  local tmp status

  tmp=$(mktemp "${TMPDIR:-/tmp}/musi-path-policy-match.XXXXXX") || return 2
  if ! printf '%s\0' "$path" | musi_path_policy_query_nul "$query" > "$tmp"; then
    rm -f "$tmp"
    return 2
  fi
  status=1
  [ -s "$tmp" ] && status=0
  rm -f "$tmp"
  return "$status"
}

ai_staged_fingerprint() {
  local repo_root="$1"
  local input_file

  input_file=$(mktemp "${TMPDIR:-/tmp}/musi-staged-fingerprint.XXXXXX") || return 1
  if ! musi_git_readonly -C "$repo_root" rev-parse HEAD > "$input_file" 2>/dev/null; then
    printf 'none\n' > "$input_file"
  fi
  if ! musi_git_readonly -C "$repo_root" diff --no-ext-diff --cached --binary --diff-filter=ACMRD >> "$input_file"; then
    rm -f "$input_file"
    return 1
  fi
  if ! musi_fingerprint_digest_file "$input_file"; then
    rm -f "$input_file"
    return 1
  fi
  rm -f "$input_file"
}

musi_changed_gate_relevant_path() {
  local path="$1"

  musi_path_policy_path_matches source-relevant "$path"
}

musi_staged_source_paths_nul() (
  local diff_filter="$1"
  local policy_query="$2"

  set -o pipefail
  git diff --cached --name-only -z --diff-filter="$diff_filter" 2>/dev/null \
    | musi_path_policy_query_nul "$policy_query"
)

musi_staged_has_source_relevant_change() {
  local tmp

  tmp=$(mktemp "${TMPDIR:-/tmp}/musi-staged-source.XXXXXX") || return 2
  if ! musi_staged_source_paths_nul \
    ACMRD source-relevant:precommit-staged > "$tmp"; then
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

musi_staged_blob_nul_status() (
  local path="$1"
  local -a pipeline_status

  set +e
  git cat-file blob ":$path" | {
    if IFS= read -r -d ''; then
      cat >/dev/null || exit 2
      exit 10
    fi
    exit 0
  }
  pipeline_status=("${PIPESTATUS[@]}")

  [ "${pipeline_status[0]}" -eq 0 ] || return 2
  case "${pipeline_status[1]}" in
    0) return 0 ;;
    10) return 1 ;;
    *) return 2 ;;
  esac
)

musi_staged_source_blobs_reject_nul() {
  local paths_tmp path blob_status object_type status=0

  paths_tmp=$(mktemp "${TMPDIR:-/tmp}/musi-staged-source-paths.XXXXXX") || return 2
  if ! musi_staged_source_paths_nul ACMR source-relevant > "$paths_tmp"; then
    printf 'staged source NUL check: source-relevant path selection failed.\n' >&2
    rm -f "$paths_tmp"
    return 2
  fi

  while IFS= read -r -d '' path; do
    if musi_staged_blob_nul_status "$path"; then
      continue
    else
      blob_status=$?
    fi
    if [ "$blob_status" -eq 1 ]; then
      printf 'staged source NUL check: literal NUL byte found in %s.\n' "$path" >&2
      printf '%s\n' \
        'Replace program values with an escaped source spelling such as \u0000, then stage the corrected file.' >&2
      status=1
      continue
    fi

    object_type=$(git cat-file -t ":$path" 2>/dev/null || true)
    if [ -n "$object_type" ] && [ "$object_type" != "blob" ]; then
      printf \
        'staged source NUL check: %s is a staged %s, not an inspectable blob.\n' \
        "$path" "$object_type" >&2
    else
      printf \
        'staged source NUL check: could not inspect staged object for %s as a blob.\n' \
        "$path" >&2
    fi
    status=2
    break
  done < "$paths_tmp"

  rm -f "$paths_tmp"
  return "$status"
}

ai_precommit_tracked_relevant_path() {
  local path="$1"

  musi_path_policy_path_matches source-relevant:precommit-tracked "$path"
}

ai_precommit_untracked_relevant_path() {
  local path="$1"

  musi_changed_gate_relevant_path "$path"
}

musi_changed_gate_fail_if_unstaged() {
  local repo_root="$1"
  local label="${2:-changed verification}"
  local tmp file

  tmp=$(mktemp "${TMPDIR:-/tmp}/musi-changed-gate.XXXXXX") || return 2
  if ! (
    cd "$repo_root" || exit 2
    set -o pipefail
    {
      git diff --name-only -z --diff-filter=ACMRD 2>/dev/null \
        && git ls-files --others --exclude-standard -z 2>/dev/null
    } | sort -z -u | musi_path_policy_query_nul source-relevant
  ) > "$tmp"; then
    printf '%s: source-relevant path selection failed.\n' "$label" >&2
    rm -f "$tmp"
    return 2
  fi

  if [ -s "$tmp" ]; then
    printf '%s: source-relevant unstaged or untracked changes are present.\n' "$label" >&2
    printf '%s: stage the intended commit; inspect unrelated work with git diff or git show HEAD:<path>, copy a file aside, or ask the user before changing it.\n' "$label" >&2
    while IFS= read -r -d '' file; do
      [ -n "$file" ] || continue
      printf '%s:   - %s\n' "$label" "$file" >&2
    done < "$tmp"
    rm -f "$tmp"
    return 1
  fi

  rm -f "$tmp"
  return 0
}

ai_precommit_fingerprint() {
  local repo_root="$1"
  local input_file paths_file selected_file file hash_status

  input_file=$(mktemp "${TMPDIR:-/tmp}/musi-precommit-fingerprint.XXXXXX") || return 1
  paths_file=$(mktemp "${TMPDIR:-/tmp}/musi-precommit-paths.XXXXXX") || {
    rm -f "$input_file"
    return 1
  }
  selected_file=$(mktemp "${TMPDIR:-/tmp}/musi-precommit-selected.XXXXXX") || {
    rm -f "$input_file" "$paths_file"
    return 1
  }

  if ! musi_git_readonly -C "$repo_root" rev-parse HEAD > "$input_file" 2>/dev/null; then
    printf 'none\n' > "$input_file"
  fi
  # Fast-commit mode skips slow pre-commit test slots; fold its presence in so
  # a partial (fast) success marker cannot short-circuit a later full
  # pre-commit at the same HEAD/diff. Absent ⇒ byte-identical to the legacy
  # fingerprint. The gate supplies its under-lock snapshot so every later
  # identity read uses the same mode; standalone callers fall back to the
  # worktree-shared marker in the Git common dir.
  case "${MUSI_FAST_COMMIT_ENABLED_SNAPSHOT:-}" in
    1) printf 'fast-commit=1\n' >> "$input_file" ;;
    0) ;;
    *)
      if [ -f "$(musi_git_common_identity_path "$repo_root")/musi-fast-commit" ]; then
        printf 'fast-commit=1\n' >> "$input_file"
      fi
      ;;
  esac
  if ! musi_git_readonly -C "$repo_root" diff --no-ext-diff --cached --binary --diff-filter=ACMRD >> "$input_file" \
     || ! musi_git_readonly -C "$repo_root" diff --no-ext-diff --name-only -z --diff-filter=ACMRD HEAD > "$paths_file" 2>/dev/null \
     || ! (set -o pipefail; sort -z -u "$paths_file" | musi_path_policy_query_nul source-relevant:precommit-tracked) > "$selected_file"; then
    rm -f "$input_file" "$paths_file" "$selected_file"
    return 1
  fi

  hash_status=0
  while IFS= read -r -d '' file; do
    [ -n "$file" ] || continue
    if [ -f "$repo_root/$file" ]; then
      (cd "$repo_root" && sha256sum "$file") >> "$input_file" || {
        hash_status=$?
        break
      }
    else
      printf 'deleted\0%s\0' "$file" >> "$input_file"
    fi
  done < "$selected_file"
  if [ "$hash_status" -ne 0 ] \
     || ! musi_git_readonly -C "$repo_root" ls-files --others --exclude-standard -z > "$paths_file" 2>/dev/null \
     || ! (set -o pipefail; sort -z -u "$paths_file" | musi_path_policy_query_nul source-relevant) > "$selected_file"; then
    rm -f "$input_file" "$paths_file" "$selected_file"
    return 1
  fi

  hash_status=0
  while IFS= read -r -d '' file; do
    [ -n "$file" ] || continue
    [ -f "$repo_root/$file" ] || continue
    (cd "$repo_root" && sha256sum "$file") >> "$input_file" || {
      hash_status=$?
      break
    }
  done < "$selected_file"
  rm -f "$paths_file" "$selected_file"
  if [ "$hash_status" -ne 0 ]; then
    rm -f "$input_file"
    return 1
  fi
  if ! musi_fingerprint_digest_file "$input_file"; then
    rm -f "$input_file"
    return 1
  fi
  rm -f "$input_file"
}

# --- Staged script-input classification --------------------------------------
# The changed-mode script-smoke handoff: decide whether a staged change can be
# described to scripts/verify/steps-lib.sh over the environment (newline-free
# paths, no script-smoke-sensitive deletion) or whether the full suite is owed.

musi_staged_has_script_relevant_deletion() {
  local tmp
  tmp=$(mktemp "${TMPDIR:-/tmp}/musi-script-deletion.XXXXXX") || return 2
  printf '%s\n' "$1" | musi_path_policy_query_lines deletion-class:script-smoke-sensitive > "$tmp"
  if [ -s "$tmp" ]; then
    rm -f "$tmp"
    return 0
  fi
  rm -f "$tmp"
  return 1
}

musi_nul_paths_are_line_safe() {
  local path

  while IFS= read -r -d '' path; do
    case "$path" in
      *$'\n'*) return 1 ;;
    esac
  done
  return 0
}

musi_classify_staged_script_input() {
  local all_file deleted_file line_safe_rc=0

  all_file=$(mktemp "${TMPDIR:-/tmp}/musi-staged-script-all.XXXXXX") || return 2
  deleted_file=$(mktemp "${TMPDIR:-/tmp}/musi-staged-script-deleted.XXXXXX") || {
    rm -f "$all_file"
    return 2
  }
  if ! git diff --cached --name-only -z --diff-filter=ACMRD > "$all_file" 2>/dev/null \
     || ! git diff --cached --name-only -z --diff-filter=D > "$deleted_file" 2>/dev/null; then
    rm -f "$all_file" "$deleted_file"
    return 2
  fi

  [ -s "$all_file" ] || {
    rm -f "$all_file" "$deleted_file"
    return 2
  }
  musi_nul_paths_are_line_safe < "$all_file" || line_safe_rc=$?
  if [ "$line_safe_rc" -ne 0 ]; then
    rm -f "$all_file" "$deleted_file"
    # The changed-smoke handoff uses environment variables, which cannot carry
    # NUL records. Conservatively request the full suite for newline paths.
    return 1
  fi

  # shellcheck disable=SC2034 # Read by scripts/verify/steps-lib.sh after classification.
  MUSI_STAGED_SCRIPT_ALL="$(tr '\0' '\n' < "$all_file")"
  # shellcheck disable=SC2034 # Read by scripts/verify/steps-lib.sh after classification.
  MUSI_STAGED_SCRIPT_DELETED="$(tr '\0' '\n' < "$deleted_file")"
  rm -f "$all_file" "$deleted_file"

  if [ -n "$MUSI_STAGED_SCRIPT_DELETED" ] \
     && musi_staged_has_script_relevant_deletion "$MUSI_STAGED_SCRIPT_DELETED"; then
    return 1
  fi

  return 0
}
