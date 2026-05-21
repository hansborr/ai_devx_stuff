#!/usr/bin/env bash
# Config-file lint sensors for workflows, maintained YAML/TOML, and Dockerfiles.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

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

path_is_excluded() {
  local path="$1"
  case "$path" in
    node_modules/*|*/node_modules/*|worktrees/*|*/worktrees/*|.playwright-cli/*|*/.playwright-cli/*)
      return 0
      ;;
  esac
  return 1
}

is_workflow_path() {
  local path="$1" rest
  path_is_excluded "$path" && return 1
  case "$path" in
    .github/workflows/*.yml|.github/workflows/*.yaml)
      rest="${path#.github/workflows/}"
      case "$rest" in
        */*) return 1 ;;
        *) return 0 ;;
      esac
      ;;
  esac
  return 1
}

is_maintained_yaml_path() {
  local path="$1" rest skill
  path_is_excluded "$path" && return 1
  case "$path" in
    .yamllint.yml|docker-compose.yml|.devcontainer/docker-compose.yml)
      return 0
      ;;
    .github/workflows/*.yml|.github/workflows/*.yaml)
      is_workflow_path "$path"
      return
      ;;
    .codex/skills/*/agents/openai.yaml)
      rest="${path#.codex/skills/}"
      skill="${rest%%/agents/openai.yaml}"
      [ -n "$skill" ] && [ "$skill" != "$rest" ] && [ "${skill#*/}" = "$skill" ]
      return
      ;;
  esac
  return 1
}

is_maintained_toml_path() {
  local path="$1"
  path_is_excluded "$path" && return 1
  case "$path" in
    bunfig.toml|.codex/config.toml)
      return 0
      ;;
  esac
  return 1
}

is_maintained_dockerfile_path() {
  local path="$1"
  path_is_excluded "$path" && return 1
  case "$path" in
    .devcontainer/Dockerfile)
      return 0
      ;;
  esac
  return 1
}

is_reference_dockerfile_path() {
  local path="$1"
  case "$path" in
    docs/refs/5e-database/Dockerfile)
      return 0
      ;;
  esac
  return 1
}

is_config_sensor_infra_path() {
  local path="$1"
  case "$path" in
    package.json|bun.lock|.yamllint.yml|scripts/lint-config-sensors.sh)
      return 0
      ;;
  esac
  return 1
}

add_actionlint_file() {
  local file="$1"
  is_workflow_path "$file" || return 0
  [ -f "$file" ] || return 0
  [ -n "${SEEN_ACTIONLINT[$file]:-}" ] && return 0
  SEEN_ACTIONLINT[$file]=1
  ACTIONLINT_FILES+=("$file")
}

add_yaml_file() {
  local file="$1"
  is_maintained_yaml_path "$file" || return 0
  [ -f "$file" ] || return 0
  [ -n "${SEEN_YAML[$file]:-}" ] && return 0
  SEEN_YAML[$file]=1
  YAML_FILES+=("$file")
}

add_toml_file() {
  local file="$1"
  is_maintained_toml_path "$file" || return 0
  [ -f "$file" ] || return 0
  [ -n "${SEEN_TOML[$file]:-}" ] && return 0
  SEEN_TOML[$file]=1
  TOML_FILES+=("$file")
}

add_dockerfile() {
  local file="$1"
  is_maintained_dockerfile_path "$file" || return 0
  [ -f "$file" ] || return 0
  [ -n "${SEEN_DOCKERFILE[$file]:-}" ] && return 0
  SEEN_DOCKERFILE[$file]=1
  DOCKERFILES+=("$file")
}

add_reference_dockerfile() {
  local file="$1"
  is_reference_dockerfile_path "$file" || return 0
  [ -f "$file" ] || return 0
  [ -n "${SEEN_REFERENCE_DOCKERFILE[$file]:-}" ] && return 0
  SEEN_REFERENCE_DOCKERFILE[$file]=1
  REFERENCE_DOCKERFILES+=("$file")
}

add_config_sensor_file() {
  local file="$1"
  if is_config_sensor_infra_path "$file"; then
    FULL_SENSOR_RUN=1
  fi
  add_actionlint_file "$file"
  add_yaml_file "$file"
  add_toml_file "$file"
  add_dockerfile "$file"
  add_reference_dockerfile "$file"
}

collect_find_results() {
  local dir="$1"
  shift
  [ -d "$dir" ] || return 0
  while IFS= read -r -d '' file; do
    add_config_sensor_file "$file"
  done < <(find "$dir" "$@" -print0 | sort -z)
}

collect_full_files() {
  add_config_sensor_file .yamllint.yml
  add_config_sensor_file docker-compose.yml
  add_config_sensor_file bunfig.toml
  add_config_sensor_file .codex/config.toml
  add_config_sensor_file .devcontainer/docker-compose.yml
  add_config_sensor_file .devcontainer/Dockerfile
  add_config_sensor_file docs/refs/5e-database/Dockerfile
  collect_find_results .github/workflows -maxdepth 1 -type f \( -name '*.yml' -o -name '*.yaml' \)
  collect_find_results .codex/skills -path '*/agents/openai.yaml' -type f
}

resolve_base_ref() {
  if git rev-parse --verify "$BASE" >/dev/null 2>&1; then
    return 0
  fi
  if git rev-parse --verify "origin/$BASE" >/dev/null 2>&1; then
    BASE="origin/$BASE"
    return 0
  fi
  return 1
}

collect_changed_files() {
  # shellcheck source=/dev/null
  . "$SCRIPT_DIR/verify-metadata.sh"

  musi_changed_gate_fail_if_unstaged "$REPO_ROOT" "lint:config-sensors:changed"

  if ! resolve_base_ref; then
    echo "lint:config-sensors: neither '$BASE' nor 'origin/$BASE' exists — checking full maintained config set."
    collect_full_files
    return 0
  fi

  while IFS= read -r -d '' file; do
    add_config_sensor_file "$file"
  done < <(
    {
      git diff -z --name-only --diff-filter=ACMRD "$BASE"...HEAD
      git diff -z --name-only --diff-filter=ACMRD --cached
    }
  )

  if [ "$FULL_SENSOR_RUN" -eq 1 ]; then
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
    collect_full_files
  fi
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

ensure_hadolint_wrapper_executable() {
  local file wrapper="$1"
  [ -x "$wrapper" ] || return 0
  file="$(hadolint_cache_file "$wrapper")"
  if [ -z "$file" ]; then
    # hadolint@0.4.2 downloads the binary without executable mode on first run.
    "$wrapper" --version >/dev/null 2>&1 || true
    file="$(hadolint_cache_file "$wrapper")"
  fi
  [ -n "$file" ] || return 0
  [ -x "$file" ] || chmod +x "$file"
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
    if ! "$bin" "$file"; then
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
  local bin
  bin="$(hadolint_command)" || {
    cat >&2 <<'EOF'
lint:config-sensors: hadolint is not available.
lint:config-sensors: run `bun install` to install the pinned npm wrapper.
EOF
    return 1
  }
  # The devcontainer base is a local refreshed image tag, not a published
  # release stream. Keep DL3007 out of this repo's floor until that changes.
  if [ "${#DOCKERFILES[@]}" -gt 0 ]; then
    echo "lint:config-sensors: hadolint checking ${#DOCKERFILES[@]} maintained Dockerfile(s)."
    "$bin" --ignore DL3007 "${DOCKERFILES[@]}"
  fi
  if [ "${#REFERENCE_DOCKERFILES[@]}" -gt 0 ]; then
    echo "lint:config-sensors: hadolint checking ${#REFERENCE_DOCKERFILES[@]} local reference Dockerfile(s)."
    "$bin" --ignore DL3008 --ignore DL3015 --ignore DL4006 "${REFERENCE_DOCKERFILES[@]}"
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
