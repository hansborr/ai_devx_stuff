#!/bin/bash

# Write-path extraction from Bash command text for the shared policy layer.
#
# COPIED VERBATIM out of policy.sh. These tokenizers are deliberately
# conservative rather than a shell parser, and their specification is the
# header comments here plus the shell corpus (scripts/ai-hooks/test.sh and its
# test-*.sh siblings). Do not reimplement or tune them: they decide which paths
# a command would write, and every relaxation is a hole in the protected-file
# guard.

ai_policy_clean_shell_path_token() {
  local token="$1"

  while [[ "$token" == \"* || "$token" == \'* ]]; do
    token="${token:1}"
  done
  while [[ "$token" == *\" || "$token" == *\' || "$token" == *\; || "$token" == *\& || "$token" == *\| ]]; do
    token="${token%?}"
  done

  printf '%s' "$token"
}

ai_policy_shell_token_ends_segment() {
  local token="$1"

  [[ "$token" == ";" || "$token" == "&&" || "$token" == "||" || "$token" == "|" \
    || "$token" == *";" || "$token" == *"&&" || "$token" == *"||" || "$token" == *"|" ]]
}

ai_policy_resolve_bash_path() {
  local path="$1"
  local candidate repo_root

  [ -n "$path" ] || return 1
  case "$path" in
    -|--|[0-9]|'&'*) return 1 ;;
  esac

  repo_root="${REPO_ROOT:-$(ai_repo_root)}"
  if [[ "$path" = /* ]]; then
    candidate="$path"
  else
    candidate="$repo_root/$path"
  fi

  realpath -m -- "$candidate" 2>/dev/null || printf '%s\n' "$candidate"
}

ai_policy_print_resolved_bash_path() {
  local token="$1"
  local path

  path=$(ai_policy_clean_shell_path_token "$token")
  ai_policy_resolve_bash_path "$path"
}

ai_policy_bash_redirect_path_from_token() {
  local token="$1"
  local path=""

  case "$token" in
    \'*|\"*) return 1 ;;
  esac

  case "$token" in
    *"&>>"*) path="${token##*&>>}" ;;
    *"&>"*) path="${token##*&>}" ;;
    *">|"*) path="${token##*>|}" ;;
    *">>"*) path="${token##*>>}" ;;
    *">"*) path="${token##*>}" ;;
    *) return 1 ;;
  esac

  [ -n "$path" ] || return 1
  printf '%s' "$path"
}

ai_policy_bash_redirect_write_paths() {
  local cmd="$1"
  local -a tokens=()
  local token path expect_target=0

  read -r -a tokens <<< "$cmd"
  for token in "${tokens[@]}"; do
    if [ "$expect_target" -eq 1 ]; then
      ai_policy_print_resolved_bash_path "$token" || true
      expect_target=0
      continue
    fi

    case "$token" in
      \'*|\"*) continue ;;
      ">"|">>"|">|"|[0-9]">"|[0-9]">>"|[0-9]">|"|"&>"|"&>>")
        expect_target=1
        continue
        ;;
      *)
        path=$(ai_policy_bash_redirect_path_from_token "$token") || continue
        ;;
    esac

    ai_policy_print_resolved_bash_path "$path" || true
  done
}

ai_policy_bash_sed_write_paths() {
  local cmd="$1"
  local -a tokens=()
  local token clean active=0 inplace=0 ends_segment

  ai_policy_has_command "$cmd" "sed$AI_POLICY_CMD_END" || return 0

  read -r -a tokens <<< "$cmd"
  for token in "${tokens[@]}"; do
    clean=$(ai_policy_clean_shell_path_token "$token")
    ends_segment=0
    ai_policy_shell_token_ends_segment "$token" && ends_segment=1

    if [ "$active" -eq 1 ]; then
      case "$clean" in
        -i|-[A-Za-z]*i[A-Za-z]*|-i*|--in-place|--in-place=*) inplace=1 ;;
        -*|"") ;;
        *)
          if [ "$inplace" -eq 1 ]; then
            ai_policy_resolve_bash_path "$clean" || true
          fi
          ;;
      esac

      if [ "$ends_segment" -eq 1 ]; then
        active=0
        inplace=0
      fi
      continue
    fi

    if [ "$clean" = "sed" ]; then
      active=1
      inplace=0
    fi
  done
}

ai_policy_bash_tee_write_paths() {
  local cmd="$1"
  local -a tokens=()
  local token clean active=0 ends_segment

  ai_policy_has_command "$cmd" "tee$AI_POLICY_CMD_END" || return 0

  read -r -a tokens <<< "$cmd"
  for token in "${tokens[@]}"; do
    clean=$(ai_policy_clean_shell_path_token "$token")
    ends_segment=0
    ai_policy_shell_token_ends_segment "$token" && ends_segment=1

    if [ "$active" -eq 1 ]; then
      case "$clean" in
        -*|"") ;;
        *) ai_policy_resolve_bash_path "$clean" || true ;;
      esac

      if [ "$ends_segment" -eq 1 ]; then
        active=0
      fi
      continue
    fi

    if [ "$clean" = "tee" ]; then
      active=1
    fi
  done
}

ai_policy_emit_copy_like_paths() {
  local command_name="$1"
  shift
  local -a paths=("$@")
  local path last_index

  [ "${#paths[@]}" -gt 0 ] || return 0

  if [ "$command_name" = "mv" ]; then
    for path in "${paths[@]}"; do
      ai_policy_resolve_bash_path "$path" || true
    done
    return 0
  fi

  last_index=$((${#paths[@]} - 1))
  ai_policy_resolve_bash_path "${paths[$last_index]}" || true
}

ai_policy_bash_copy_like_write_paths() {
  local cmd="$1"
  local -a tokens=()
  local -a paths=()
  local token clean active=0 command_name="" ends_segment

  ai_policy_has_command "$cmd" "(cp|install|mv)$AI_POLICY_CMD_END" || return 0

  read -r -a tokens <<< "$cmd"
  for token in "${tokens[@]}"; do
    clean=$(ai_policy_clean_shell_path_token "$token")
    ends_segment=0
    ai_policy_shell_token_ends_segment "$token" && ends_segment=1

    if [ "$active" -eq 1 ]; then
      case "$clean" in
        -*|"") ;;
        *) paths+=("$clean") ;;
      esac

      if [ "$ends_segment" -eq 1 ]; then
        ai_policy_emit_copy_like_paths "$command_name" "${paths[@]}"
        active=0
        command_name=""
        paths=()
      fi
      continue
    fi

    case "$clean" in
      cp|install|mv)
        active=1
        command_name="$clean"
        paths=()
        ;;
    esac
  done

  [ "$active" -eq 1 ] && ai_policy_emit_copy_like_paths "$command_name" "${paths[@]}"
}

ai_policy_bash_write_candidate_paths() {
  local cmd="$1"

  ai_policy_bash_redirect_write_paths "$cmd"
  ai_policy_bash_sed_write_paths "$cmd"
  ai_policy_bash_tee_write_paths "$cmd"
  ai_policy_bash_copy_like_write_paths "$cmd"
}

# Completion sentinel: policy.sh resets this before sourcing and fails closed
# unless this module reaches its final statement. An empty or truncated module
# still sources cleanly, so this is what proves the definitions above ran.
# shellcheck disable=SC2034 # read by policy.sh's module guard, which sources this file
declare -g AI_POLICY_MODULE_COMMAND_PATHS_COMPLETE=1
