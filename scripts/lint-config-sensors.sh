#!/usr/bin/env bash
# Config-file lint sensors for workflows, maintained YAML/TOML, and Dockerfiles.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"
PATH_POLICY_QUERY="$SCRIPT_DIR/path-policy/path-policy-query.ts"

MODE=full
BASE=main
HADOLINT_VERSION=2.14.0

usage() {
  cat <<'EOF'
usage: lint-config-sensors.sh [--changed [base]]

Default: run actionlint, yamllint, taplo, and hadolint over the maintained
workflow/config-file set.
--changed: run only the relevant sensors for maintained config files changed
           vs base plus staged changes. Base defaults to main, then origin/main.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --changed)
      MODE=changed
      shift
      if [ "$#" -gt 0 ]; then
        BASE="$1"
        shift
      fi
      ;;
    *)
      printf 'lint:config-sensors: unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

declare -A SEEN_ACTIONLINT
declare -A SEEN_YAML
declare -A SEEN_TOML
declare -A SEEN_DOCKERFILE
declare -A SEEN_REFERENCE_DOCKERFILE
ACTIONLINT_FILES=()
YAML_FILES=()
TOML_FILES=()
DOCKERFILES=()
REFERENCE_DOCKERFILES=()
FULL_SENSOR_RUN=0

add_actionlint_file() {
  local file="$1"
  [ -f "$file" ] || return 0
  [ -n "${SEEN_ACTIONLINT[$file]:-}" ] && return 0
  SEEN_ACTIONLINT[$file]=1
  ACTIONLINT_FILES+=("$file")
}

add_yaml_file() {
  local file="$1"
  [ -f "$file" ] || return 0
  [ -n "${SEEN_YAML[$file]:-}" ] && return 0
  SEEN_YAML[$file]=1
  YAML_FILES+=("$file")
}

add_toml_file() {
  local file="$1"
  [ -f "$file" ] || return 0
  [ -n "${SEEN_TOML[$file]:-}" ] && return 0
  SEEN_TOML[$file]=1
  TOML_FILES+=("$file")
}

add_dockerfile() {
  local file="$1"
  [ -f "$file" ] || return 0
  [ -n "${SEEN_DOCKERFILE[$file]:-}" ] && return 0
  SEEN_DOCKERFILE[$file]=1
  DOCKERFILES+=("$file")
}

add_reference_dockerfile() {
  local file="$1"
  [ -f "$file" ] || return 0
  [ -n "${SEEN_REFERENCE_DOCKERFILE[$file]:-}" ] && return 0
  SEEN_REFERENCE_DOCKERFILE[$file]=1
  REFERENCE_DOCKERFILES+=("$file")
}

path_policy_has_match() {
  local query="$1"
  shift

  IFS= read -r -d '' < <(printf '%s\0' "$@" | bun --config=/dev/null "$PATH_POLICY_QUERY" "$query")
}

reset_config_sensor_files() {
  ACTIONLINT_FILES=()
  YAML_FILES=()
  TOML_FILES=()
  DOCKERFILES=()
  REFERENCE_DOCKERFILES=()
  SEEN_ACTIONLINT=()
  SEEN_YAML=()
  SEEN_TOML=()
  SEEN_DOCKERFILE=()
  SEEN_REFERENCE_DOCKERFILE=()
}

collect_repo_files() {
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    {
      git ls-files -z --cached --others --exclude-standard
      # Reference Dockerfile is gitignored but explicitly linted with relaxed rules.
      printf '%s\0' "docs/refs/5e-database/Dockerfile"
    } | sort -z -u
    return 0
  fi

  while IFS= read -r -d '' file; do
    printf '%s\0' "${file#./}"
  done < <(find . -path ./.git -prune -o -type f -print0 | sort -z)
}

collect_config_sensor_candidates() {
  local file
  declare -A REFERENCE_POLICY_MATCH=()

  while IFS= read -r -d '' file; do
    REFERENCE_POLICY_MATCH[$file]=1
    add_reference_dockerfile "$file"
  done < <(printf '%s\0' "$@" | bun --config=/dev/null "$PATH_POLICY_QUERY" config-surface:reference-dockerfile)

  while IFS= read -r -d '' file; do
    add_actionlint_file "$file"
  done < <(printf '%s\0' "$@" | bun --config=/dev/null "$PATH_POLICY_QUERY" config-surface:workflow-yaml)

  while IFS= read -r -d '' file; do
    add_yaml_file "$file"
  done < <(printf '%s\0' "$@" | bun --config=/dev/null "$PATH_POLICY_QUERY" config-surface:yaml)

  while IFS= read -r -d '' file; do
    add_toml_file "$file"
  done < <(printf '%s\0' "$@" | bun --config=/dev/null "$PATH_POLICY_QUERY" config-surface:toml)

  while IFS= read -r -d '' file; do
    [ -n "${REFERENCE_POLICY_MATCH[$file]:-}" ] && continue
    add_dockerfile "$file"
  done < <(printf '%s\0' "$@" | bun --config=/dev/null "$PATH_POLICY_QUERY" config-surface:dockerfile)
}

collect_full_files() {
  local candidates=() file

  while IFS= read -r -d '' file; do
    candidates+=("$file")
  done < <(collect_repo_files)

  collect_config_sensor_candidates "${candidates[@]}"
}

collect_changed_files() {
  local changed_files=() file

  # shellcheck source=/dev/null
  . "$SCRIPT_DIR/lib/verify-metadata.sh"
  # shellcheck source=scripts/lib/changed-base.sh
  . "$SCRIPT_DIR/lib/changed-base.sh"

  musi_changed_gate_fail_if_unstaged "$REPO_ROOT" "lint:config-sensors:changed"

  if musi_resolve_changed_base "$BASE"; then
    BASE="$MUSI_CHANGED_BASE"
  else
    echo "lint:config-sensors: $MUSI_CHANGED_BASE_ERROR — checking full maintained config set." >&2
    collect_full_files
    return 0
  fi

  while IFS= read -r -d '' file; do
    changed_files+=("$file")
  done < <(
    {
      git diff -z --name-only --diff-filter=ACMRD "$BASE"...HEAD
      git diff -z --name-only --diff-filter=ACMRD --cached
    }
  )

  if [ "${#changed_files[@]}" -gt 0 ] \
     && path_policy_has_match full-scan-trigger:config-sensors-changed "${changed_files[@]}"; then
    FULL_SENSOR_RUN=1
  fi

  if [ "$FULL_SENSOR_RUN" -eq 1 ]; then
    reset_config_sensor_files
    collect_full_files
    return 0
  fi

  collect_config_sensor_candidates "${changed_files[@]}"
}

command_from_env_or_path() {
  local env_value="$1"
  local local_bin="$2"
  local command_name="$3"

  if [ -n "$env_value" ]; then
    printf '%s\n' "$env_value"
    return 0
  fi
  if [ -x "$local_bin" ]; then
    printf '%s\n' "$local_bin"
    return 0
  fi
  if command -v "$command_name" >/dev/null 2>&1; then
    command -v "$command_name"
    return 0
  fi
  return 1
}

actionlint_command() {
  command_from_env_or_path "${MUSI_ACTIONLINT_BIN:-}" "$REPO_ROOT/node_modules/.bin/node-actionlint" node-actionlint
}

run_actionlint_file() {
  local bin="$1" file="$2" limit="${MUSI_ACTIONLINT_TIMEOUT:-10s}" rc

  if command -v timeout >/dev/null 2>&1; then
    if timeout "$limit" "$bin" "$file"; then
      return 0
    else
      rc=$?
    fi
    if [ "$rc" -eq 124 ]; then
      printf 'lint:config-sensors: actionlint timed out after %s on %s\n' "$limit" "$file" >&2
    fi
    return "$rc"
  fi

  "$bin" "$file"
}

yamllint_command() {
  if command -v yamllint >/dev/null 2>&1; then
    command -v yamllint
    return 0
  fi
  return 1
}

taplo_command() {
  command_from_env_or_path "${MUSI_TAPLO_BIN:-}" "$REPO_ROOT/node_modules/.bin/taplo" taplo
}

hadolint_cache_file() {
  local package_dir wrapper="$1"
  package_dir="$(cd "$(dirname "$wrapper")/../hadolint" 2>/dev/null && pwd -P)" || return 0
  find "$package_dir/.cache/hadolint" -maxdepth 1 -type f \
    -name "hadolint-$HADOLINT_VERSION" -print -quit 2>/dev/null || true
}

hadolint_lock_file() {
  local cache_dir package_dir wrapper="$1"
  package_dir="$(cd "$(dirname "$wrapper")/../hadolint" 2>/dev/null && pwd -P)" || return 1
  cache_dir="$package_dir/.cache/hadolint"
  mkdir -p "$cache_dir"
  printf '%s\n' "$cache_dir/.musi-hadolint.lock"
}

run_with_hadolint_lock() {
  local lock_file wrapper="$1"
  shift
  if ! command -v flock >/dev/null 2>&1; then
    "$@"
    return
  fi
  lock_file="$(hadolint_lock_file "$wrapper")" || {
    "$@"
    return
  }
  (
    flock 9
    "$@"
  ) 9>"$lock_file"
}

ensure_hadolint_wrapper_executable_unlocked() {
  local file wrapper="$1"
  file="$(hadolint_cache_file "$wrapper")"
  if [ -z "$file" ]; then
    # hadolint@0.4.2 downloads the binary without executable mode on first run.
    "$wrapper" --version >/dev/null 2>&1 || true
    file="$(hadolint_cache_file "$wrapper")"
  fi
  [ -n "$file" ] || return 0
  [ -x "$file" ] || chmod +x "$file"
}

ensure_hadolint_wrapper_executable() {
  local wrapper="$1"
  [ -x "$wrapper" ] || return 0
  run_with_hadolint_lock "$wrapper" ensure_hadolint_wrapper_executable_unlocked "$wrapper"
}

hadolint_command() {
  local wrapper="$REPO_ROOT/node_modules/.bin/hadolint"
  if [ -n "${MUSI_HADOLINT_BIN:-}" ]; then
    printf '%s\n' "$MUSI_HADOLINT_BIN"
    return 0
  fi
  ensure_hadolint_wrapper_executable "$wrapper"
  if [ -x "$wrapper" ]; then
    printf '%s\n' "$wrapper"
    return 0
  fi
  if command -v hadolint >/dev/null 2>&1; then
    command -v hadolint
    return 0
  fi
  return 1
}

hadolint_command_unlocked() {
  local wrapper="$1"
  if [ -n "${MUSI_HADOLINT_BIN:-}" ]; then
    printf '%s\n' "$MUSI_HADOLINT_BIN"
    return 0
  fi
  if [ -x "$wrapper" ]; then
    ensure_hadolint_wrapper_executable_unlocked "$wrapper"
    printf '%s\n' "$wrapper"
    return 0
  fi
  if command -v hadolint >/dev/null 2>&1; then
    command -v hadolint
    return 0
  fi
  return 1
}

run_hadolint_locked() {
  local wrapper="$1"
  shift
  local bin
  bin="$(hadolint_command_unlocked "$wrapper")" || {
    cat >&2 <<'EOF'
lint:config-sensors: hadolint is not available.
lint:config-sensors: run `bun install` to install the pinned npm wrapper.
EOF
    return 1
  }

  "$bin" "$@"
}

run_actionlint() {
  [ "${#ACTIONLINT_FILES[@]}" -gt 0 ] || return 0
  local bin failed file
  bin="$(actionlint_command)" || {
    cat >&2 <<'EOF'
lint:config-sensors: actionlint is not available.
lint:config-sensors: run `bun install` to install the pinned npm wrapper.
EOF
    return 1
  }
  echo "lint:config-sensors: actionlint checking ${#ACTIONLINT_FILES[@]} workflow file(s)."
  failed=0
  for file in "${ACTIONLINT_FILES[@]}"; do
    echo "lint:config-sensors: actionlint checking $file."
    if ! run_actionlint_file "$bin" "$file"; then
      failed=1
    fi
  done
  return "$failed"
}

run_yamllint() {
  [ "${#YAML_FILES[@]}" -gt 0 ] || return 0
  local bin
  bin="$(yamllint_command)" || {
    cat >&2 <<'EOF'
lint:config-sensors: yamllint is not available.
lint:config-sensors: install the system package with `apt install yamllint`, then rerun this command.
EOF
    return 1
  }
  echo "lint:config-sensors: yamllint checking ${#YAML_FILES[@]} YAML file(s)."
  "$bin" -c "$REPO_ROOT/.yamllint.yml" --strict -f parsable "${YAML_FILES[@]}"
}

run_taplo() {
  [ "${#TOML_FILES[@]}" -gt 0 ] || return 0
  local bin
  bin="$(taplo_command)" || {
    cat >&2 <<'EOF'
lint:config-sensors: taplo is not available.
lint:config-sensors: run `bun install` to install the pinned npm wrapper.
EOF
    return 1
  }
  echo "lint:config-sensors: taplo format-checking ${#TOML_FILES[@]} TOML file(s)."
  "$bin" fmt --check "${TOML_FILES[@]}"
  echo "lint:config-sensors: taplo linting ${#TOML_FILES[@]} TOML file(s)."
  "$bin" lint "${TOML_FILES[@]}"
}

run_hadolint() {
  [ "${#DOCKERFILES[@]}" -gt 0 ] || [ "${#REFERENCE_DOCKERFILES[@]}" -gt 0 ] || return 0
  local wrapper="$REPO_ROOT/node_modules/.bin/hadolint"
  # The devcontainer base is a local refreshed image tag, not a published
  # release stream. Keep DL3007 out of this repo's floor until that changes.
  if [ "${#DOCKERFILES[@]}" -gt 0 ]; then
    echo "lint:config-sensors: hadolint checking ${#DOCKERFILES[@]} maintained Dockerfile(s)."
    run_with_hadolint_lock "$wrapper" run_hadolint_locked "$wrapper" --ignore DL3007 "${DOCKERFILES[@]}"
  fi
  if [ "${#REFERENCE_DOCKERFILES[@]}" -gt 0 ]; then
    echo "lint:config-sensors: hadolint checking ${#REFERENCE_DOCKERFILES[@]} local reference Dockerfile(s)."
    run_with_hadolint_lock "$wrapper" run_hadolint_locked "$wrapper" --ignore DL3008 --ignore DL3015 --ignore DL4006 "${REFERENCE_DOCKERFILES[@]}"
  fi
}

if [ "$MODE" = changed ]; then
  collect_changed_files
else
  collect_full_files
fi

if [ "${#ACTIONLINT_FILES[@]}" -eq 0 ] \
   && [ "${#YAML_FILES[@]}" -eq 0 ] \
   && [ "${#TOML_FILES[@]}" -eq 0 ] \
   && [ "${#DOCKERFILES[@]}" -eq 0 ] \
   && [ "${#REFERENCE_DOCKERFILES[@]}" -eq 0 ]; then
  if [ "$MODE" = changed ]; then
    echo "lint:config-sensors: no staged/base changed maintained config files vs $BASE — skipping sensors."
  else
    echo "lint:config-sensors: no maintained config files found — skipping sensors."
  fi
  exit 0
fi

run_actionlint
run_yamllint
run_taplo
run_hadolint
