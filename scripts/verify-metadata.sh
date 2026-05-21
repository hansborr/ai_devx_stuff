#!/usr/bin/env bash
# Helpers for verification timing metadata shared by pre-commit, verify, and
# verify:logs. Writers create per-step fragments first so parallel pre-commit
# children never append to the same file concurrently; the wrapper combines
# fragments into run-meta.json at the end of the run.
#
# Lives at the same level as `.husky/pre-commit` so the dash-invoked smoke
# test in `scripts/test-dependency-freshness.sh` can source it without pulling
# in `scripts/ai-hooks/cache.sh` (which contains bash-only constructs).
# `ai_worktree_fingerprint` is defined here for the same reason; cache.sh
# sources this file and re-exports it for ai-hooks callers.

ai_worktree_fingerprint() {
  local repo_root="$1"

  {
    git -C "$repo_root" rev-parse HEAD 2>/dev/null || echo none
    git -C "$repo_root" diff HEAD 2>/dev/null
    (
      cd "$repo_root" || exit 1
      git ls-files --others --exclude-standard -z 2>/dev/null \
        | xargs -0 -r sha256sum 2>/dev/null
    )
  } | sha256sum | awk '{print $1}'
}

ai_staged_fingerprint() {
  local repo_root="$1"

  {
    git -C "$repo_root" rev-parse HEAD 2>/dev/null || echo none
    git -C "$repo_root" diff --cached --binary --diff-filter=ACMRD
  } | sha256sum | awk '{print $1}'
}

musi_changed_gate_relevant_path() {
  local path="$1"

  case "$path" in
    bun.lock|package.json|drift-ai.config.json|lint-ratchet.baseline.json|harness.controls.json|docs/agent_notes/backlog/lint-followups/lint-coverage-map.md|.claude/settings.json|.codex/hooks.json|.devcontainer/devcontainer.json|.playwright/cli.config.json|.yamllint.yml|bunfig.toml|docker-compose.yml|tsconfig*.json|vitest*.config.*|eslint.config.*|commitlint.config.*|stryker.config.*|knip.config.*|playwright.config.*|prisma.config.*)
      return 0
      ;;
    packages/*/package.json|packages/*/tsconfig*.json|packages/*/vitest*.config.*|packages/*/prisma.config.*)
      return 0
      ;;
    .claude/hooks/*.sh|.codex/hooks/*.sh|.devcontainer/*.sh|.devcontainer/Dockerfile|.devcontainer/docker-compose.yml|.github/workflows/*.yml|.github/workflows/*.yaml|.codex/config.toml|.codex/skills/*/agents/openai.yaml)
      return 0
      ;;
  esac

  case "$path" in
    .husky/*|packages/*|e2e/*|scripts/*|eslint-rules/*)
      return 0
      ;;
  esac

  return 1
}

ai_precommit_tracked_relevant_path() {
  local path="$1"

  case "$path" in
    .claude/*|.codex/*)
      return 0
      ;;
  esac

  musi_changed_gate_relevant_path "$path"
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
  (
    cd "$repo_root" || exit 2
    {
      git diff --name-only --diff-filter=ACMRD 2>/dev/null || true
      git ls-files --others --exclude-standard 2>/dev/null || true
    } | sort -u | while IFS= read -r file; do
      [ -n "$file" ] || continue
      if musi_changed_gate_relevant_path "$file"; then
        printf '%s\n' "$file"
      fi
    done
  ) > "$tmp"

  if [ -s "$tmp" ]; then
    printf '%s: source-relevant unstaged or untracked changes are present.\n' "$label" >&2
    printf '%s: stage the intended commit, or stash/restore unrelated source-relevant work, before running changed verification.\n' "$label" >&2
    while IFS= read -r file; do
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

  {
    git -C "$repo_root" rev-parse HEAD 2>/dev/null || echo none
    git -C "$repo_root" diff --cached --binary --diff-filter=ACMRD
    (
      cd "$repo_root" || exit 1
      {
        git diff --name-only --diff-filter=ACMRD HEAD 2>/dev/null
      } | sort -u | while IFS= read -r file; do
        [ -n "$file" ] || continue
        ai_precommit_tracked_relevant_path "$file" || continue
        if [ -f "$file" ]; then
          sha256sum "$file"
        else
          printf 'deleted %s\n' "$file"
        fi
      done
      git ls-files --others --exclude-standard 2>/dev/null | sort -u | while IFS= read -r file; do
        [ -n "$file" ] || continue
        ai_precommit_untracked_relevant_path "$file" || continue
        [ -f "$file" ] || continue
        sha256sum "$file"
      done
    )
  } | sha256sum | awk '{print $1}'
}

musi_read_success_marker() {
  local marker="$1"
  local saw_ts saw_head saw_hash k v
  saw_ts=0
  saw_head=0
  saw_hash=0

  MUSI_MARKER_LAST_TS=0
  MUSI_MARKER_LAST_HEAD=""
  MUSI_MARKER_LAST_HASH=""

  [ -f "$marker" ] || return 1
  while IFS='=' read -r k v || [ -n "$k$v" ]; do
    case "$k" in
      LAST_TS)
        [ "$saw_ts" -eq 0 ] || return 1
        MUSI_MARKER_LAST_TS=$v
        saw_ts=1
        ;;
      LAST_HEAD)
        [ "$saw_head" -eq 0 ] || return 1
        MUSI_MARKER_LAST_HEAD=$v
        saw_head=1
        ;;
      LAST_HASH)
        [ "$saw_hash" -eq 0 ] || return 1
        MUSI_MARKER_LAST_HASH=$v
        saw_hash=1
        ;;
      *)
        return 1
        ;;
    esac
  done < "$marker"

  [ "$saw_ts" -eq 1 ] || return 1
  [ "$saw_head" -eq 1 ] || return 1
  [ "$saw_hash" -eq 1 ] || return 1
  case "$MUSI_MARKER_LAST_TS" in
    ''|*[!0-9]*) return 1 ;;
  esac
  [ "$MUSI_MARKER_LAST_TS" -gt 0 ] || return 1
  [ -n "$MUSI_MARKER_LAST_HEAD" ] || return 1
  case "$MUSI_MARKER_LAST_HASH" in
    ''|*[!0-9a-f]*) return 1 ;;
  esac
  [ "${#MUSI_MARKER_LAST_HASH}" -eq 64 ] || return 1
}

musi_success_marker_matches() {
  local marker="$1"
  local current_head="$2"
  local current_hash="$3"
  local freshness_seconds="${4:-120}"
  local now age

  MUSI_MARKER_MATCH_AGE=""

  musi_read_success_marker "$marker" || return 1
  now=$(date +%s)
  age=$((now - MUSI_MARKER_LAST_TS))
  [ "$age" -ge 0 ] || return 1
  [ "$age" -lt "$freshness_seconds" ] || return 1
  [ "$MUSI_MARKER_LAST_HEAD" = "$current_head" ] || return 1
  [ "$MUSI_MARKER_LAST_HASH" = "$current_hash" ] || return 1

  MUSI_MARKER_MATCH_AGE=$age
}

musi_write_success_marker() {
  local marker="$1"
  local head="$2"
  local hash="$3"
  local marker_dir marker_base marker_tmp

  marker_dir=$(dirname "$marker")
  marker_base=$(basename "$marker")
  mkdir -p "$marker_dir" || return 1
  marker_tmp=$(mktemp "$marker_dir/.${marker_base}.tmp.XXXXXX") || marker_tmp=""
  if [ -n "$marker_tmp" ] && {
    printf 'LAST_TS=%s\n' "$(date +%s)"
    printf 'LAST_HEAD=%s\n' "$head"
    printf 'LAST_HASH=%s\n' "$hash"
  } > "$marker_tmp" && mv -f "$marker_tmp" "$marker"; then
    return 0
  fi

  [ -n "$marker_tmp" ] && rm -f "$marker_tmp"
  return 1
}

musi_try_single_verify_marker_bridge() {
  local repo_root="$1"
  local precommit_marker="$2"
  local verify_marker="$3"
  local label="$4"
  local freshness_seconds="$5"
  local current_head="$6"
  local current_verify_hash="$7"
  local current_precommit_hash age

  musi_success_marker_matches "$verify_marker" "$current_head" "$current_verify_hash" "$freshness_seconds" || return 1
  age=$MUSI_MARKER_MATCH_AGE
  current_precommit_hash=$(ai_precommit_fingerprint "$repo_root")
  if ! musi_write_success_marker "$precommit_marker" "$current_head" "$current_precommit_hash"; then
    printf 'pre-commit: WARN: failed to write marker %s\n' "$precommit_marker" >&2
  fi
  printf 'pre-commit: %s passed %ss ago for this staged/worktree state — skipping (set FORCE_VERIFY=1 to re-run).\n' \
    "$label" "$age"
}

musi_try_verify_marker_bridge() {
  local repo_root="$1"
  local precommit_marker="${2:-${MUSI_PRECOMMIT_MARKER:-/tmp/musi-pre-commit-last}}"
  local freshness_seconds="${3:-120}"
  local current_head current_staged_hash current_worktree_hash changed_marker full_marker

  [ "${FORCE_VERIFY:-}" = "1" ] && return 1

  current_head=$(git -C "$repo_root" rev-parse HEAD 2>/dev/null || echo none)
  current_staged_hash=$(ai_staged_fingerprint "$repo_root")
  current_worktree_hash=$(ai_worktree_fingerprint "$repo_root")
  changed_marker="${MUSI_VERIFY_MARKER_CHANGED:-/tmp/musi-verify-changed-last}"
  full_marker="${MUSI_VERIFY_MARKER_FULL:-/tmp/musi-verify-last}"

  musi_try_single_verify_marker_bridge "$repo_root" "$precommit_marker" "$changed_marker" \
    "verify:changed" "$freshness_seconds" "$current_head" "$current_staged_hash" \
    && return 0
  musi_try_single_verify_marker_bridge "$repo_root" "$precommit_marker" "$full_marker" \
    "verify" "$freshness_seconds" "$current_head" "$current_worktree_hash"
}

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
  local head="${9:-}"
  local fingerprint="${10:-}"
  local elapsed=$((end_epoch - start_epoch))
  [ "$elapsed" -lt 0 ] && elapsed=0

  mkdir -p "$(dirname "$file")"
  {
    printf '{'
    printf '"name":"wrapper",'
    printf '"mode":"%s",' "$(musi_meta_json_escape "$mode")"
    printf '"start_time":"%s",' "$(musi_meta_json_escape "$start_time")"
    printf '"end_time":"%s",' "$(musi_meta_json_escape "$end_time")"
    printf '"elapsed_seconds":%s,' "$elapsed"
    printf '"exit_code":%s,' "$exit_code"
    printf '"head":"%s",' "$(musi_meta_json_escape "$head")"
    printf '"fingerprint":"%s",' "$(musi_meta_json_escape "$fingerprint")"
    printf '"command":"%s"' "$(musi_meta_json_escape "$command")"
    printf '}\n'
  } > "$file"
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
