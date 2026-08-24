#!/usr/bin/env bash
# Config-file lint sensors for workflows, maintained YAML/TOML, and Dockerfiles.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/lib/verify-metadata.sh"
# shellcheck source=scripts/lib/changed-lintable-files.sh
. "$SCRIPT_DIR/lib/changed-lintable-files.sh"

MODE=full
BASE=main
HADOLINT_VERSION="$(bun -e '
  const pkg = require(process.argv[1]);
  const version = pkg.config?.hadolint;
  if (typeof version !== "string" || version.length === 0) process.exit(1);
  process.stdout.write(version);
' "$REPO_ROOT/package.json" 2>/dev/null)" || {
  printf 'lint:config-sensors: package.json config.hadolint must be a non-empty string.\n' >&2
  exit 2
}

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

select_config_policy_paths() {
  local query="$1" tmp file
  shift
  tmp=$(mktemp "${TMPDIR:-/tmp}/musi-config-selected.XXXXXX") || return 2
  if ! printf '%s\0' "$@" | musi_path_policy_query_nul "$query" > "$tmp"; then
    printf 'lint:config-sensors: path selection failed for %s.\n' "$query" >&2
    rm -f "$tmp"
    return 2
  fi
  MUSI_CONFIG_POLICY_FILES=()
  while IFS= read -r -d '' file; do
    MUSI_CONFIG_POLICY_FILES+=("$file")
  done < "$tmp"
  rm -f "$tmp"
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
      git ls-files -z --cached --others --exclude-standard || exit $?
      # Reference Dockerfile is gitignored but explicitly linted with relaxed rules.
      printf '%s\0' "docs/refs/5e-database/Dockerfile"
    } | sort -z -u
    return $?
  fi

  while IFS= read -r -d '' file; do
    printf '%s\0' "${file#./}"
  done < <(find . -path ./.git -prune -o -type f -print0 | sort -z)
}

collect_config_sensor_candidates() {
  local file
  declare -A REFERENCE_POLICY_MATCH=()

  select_config_policy_paths config-surface:reference-dockerfile "$@" || return 2
  for file in "${MUSI_CONFIG_POLICY_FILES[@]}"; do
    REFERENCE_POLICY_MATCH[$file]=1
    add_reference_dockerfile "$file"
  done

  select_config_policy_paths config-surface:workflow-yaml "$@" || return 2
  for file in "${MUSI_CONFIG_POLICY_FILES[@]}"; do
    add_actionlint_file "$file"
  done

  select_config_policy_paths config-surface:yaml "$@" || return 2
  for file in "${MUSI_CONFIG_POLICY_FILES[@]}"; do
    add_yaml_file "$file"
  done

  select_config_policy_paths config-surface:toml "$@" || return 2
  for file in "${MUSI_CONFIG_POLICY_FILES[@]}"; do
    add_toml_file "$file"
  done

  select_config_policy_paths config-surface:dockerfile "$@" || return 2
  for file in "${MUSI_CONFIG_POLICY_FILES[@]}"; do
    [ -n "${REFERENCE_POLICY_MATCH[$file]:-}" ] && continue
    add_dockerfile "$file"
  done
}

collect_full_files() {
  local candidates=() file candidates_file

  candidates_file=$(mktemp "${TMPDIR:-/tmp}/musi-config-input.XXXXXX") || return 2
  if ! collect_repo_files > "$candidates_file"; then
    printf 'lint:config-sensors: path selection failed while collecting repository files.\n' >&2
    rm -f "$candidates_file"
    return 2
  fi
  while IFS= read -r -d '' file; do
    candidates+=("$file")
  done < "$candidates_file"
  rm -f "$candidates_file"

  collect_config_sensor_candidates "${candidates[@]}"
}

collect_changed_files() {
  local selector_rc

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

  if ! musi_collect_changed_candidates "$REPO_ROOT" "$BASE" gate; then
    printf 'lint:config-sensors: path selection failed while collecting changed files.\n' >&2
    return 2
  fi

  selector_rc=0
  musi_changed_candidates_trigger_full_scan full-scan-trigger:config-sensors-changed || selector_rc=$?
  case "$selector_rc" in
    0) FULL_SENSOR_RUN=1 ;;
    1) ;;
    *)
      printf 'lint:config-sensors: path selection failed for full-scan-trigger:config-sensors-changed.\n' >&2
      return 2
      ;;
  esac

  if [ "$FULL_SENSOR_RUN" -eq 1 ]; then
    reset_config_sensor_files
    collect_full_files
    return 0
  fi

  collect_config_sensor_candidates "${CHANGED_FILES[@]}"
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
  local bin="$1" file="$2" limit="${MUSI_ACTIONLINT_TIMEOUT:-60s}" rc

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
  # Repair unconditionally: a concurrent extraction can drop the executable bit
  # after an earlier [ -x ] check would have skipped it, so always (re)assert it
  # before the path is handed back for a direct spawn.
  chmod +x "$file" 2>/dev/null || true
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
  local wrapper="$1" cache_file
  if [ -n "${MUSI_HADOLINT_BIN:-}" ]; then
    printf '%s\n' "$MUSI_HADOLINT_BIN"
    return 0
  fi
  if [ -x "$wrapper" ]; then
    ensure_hadolint_wrapper_executable_unlocked "$wrapper"
    # Prefer spawning the extracted binary directly over re-entering the npm
    # wrapper. The wrapper checks the cache for existence only (not an
    # executable bit) and re-fetches a missing binary without one, so invoking
    # it can race a concurrent extraction and die with an unhandled spawn
    # EACCES. The binary we just repaired under the lock is safe to launch
    # directly, and the wrapper's own execute() spawns it exactly this way.
    cache_file="$(hadolint_cache_file "$wrapper")"
    if [ -n "$cache_file" ] && [ -x "$cache_file" ]; then
      printf '%s\n' "$cache_file"
      return 0
    fi
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

# A concurrent config-sensors run — or the npm wrapper's first-run
# self-extraction of the pinned binary — can momentarily leave the shared
# hadolint cache binary non-executable (0644) or mid-write, so an otherwise
# healthy invocation dies with a Node spawn EACCES/ETXTBSY/ENOENT instead of a
# lint result. That transient infrastructure failure is distinguishable from a
# genuine nonzero exit: hadolint reports Dockerfile findings on stdout and never
# emits a spawn errno, so a spawn-shaped stderr means the binary could not be
# launched, not that the Dockerfile is dirty.
hadolint_stderr_is_spawn_failure() {
  local stderr_file="$1"
  grep -qE 'spawn[[:print:]]*(EACCES|ETXTBSY|ENOENT)' "$stderr_file" 2>/dev/null
}

# Run one locked hadolint invocation; on a spawn-shaped failure only, re-run the
# locked executable-bit repair and retry exactly once. The retry is gated on the
# stderr shape so a Dockerfile with real findings is never linted twice and a
# real regression can never be masked, and each lock is acquired fresh (never
# nested) so the repair cannot deadlock against the invocation's own flock.
run_hadolint_with_repair_retry() {
  local wrapper="$1"
  shift
  local stderr_file status
  stderr_file="$(mktemp "${TMPDIR:-/tmp}/musi-hadolint-stderr.XXXXXX")"
  if run_with_hadolint_lock "$wrapper" run_hadolint_locked "$wrapper" "$@" 2>"$stderr_file"; then
    status=0
  else
    status=$?
  fi
  if [ "$status" -ne 0 ] && hadolint_stderr_is_spawn_failure "$stderr_file"; then
    echo "lint:config-sensors: hadolint could not be launched (transient shared-cache spawn failure); repairing the executable bit and retrying once." >&2
    run_with_hadolint_lock "$wrapper" ensure_hadolint_wrapper_executable_unlocked "$wrapper" || true
    : >"$stderr_file"
    if run_with_hadolint_lock "$wrapper" run_hadolint_locked "$wrapper" "$@" 2>"$stderr_file"; then
      status=0
    else
      status=$?
    fi
  fi
  cat "$stderr_file" >&2
  rm -f "$stderr_file"
  return "$status"
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
  if ! "$bin" -c "$REPO_ROOT/.yamllint.yml" --strict -f parsable "${YAML_FILES[@]}"; then
    return 1
  fi
}

run_taplo() {
  [ "${#TOML_FILES[@]}" -gt 0 ] || return 0
  local bin failed=0
  bin="$(taplo_command)" || {
    cat >&2 <<'EOF'
lint:config-sensors: taplo is not available.
lint:config-sensors: run `bun install` to install the pinned npm wrapper.
EOF
    return 1
  }
  echo "lint:config-sensors: taplo format-checking ${#TOML_FILES[@]} TOML file(s)."
  if ! "$bin" fmt --check "${TOML_FILES[@]}"; then
    failed=1
  fi
  echo "lint:config-sensors: taplo linting ${#TOML_FILES[@]} TOML file(s)."
  if ! "$bin" lint "${TOML_FILES[@]}"; then
    failed=1
  fi
  return "$failed"
}

run_hadolint() {
  [ "${#DOCKERFILES[@]}" -gt 0 ] || [ "${#REFERENCE_DOCKERFILES[@]}" -gt 0 ] || return 0
  local wrapper="$REPO_ROOT/node_modules/.bin/hadolint" failed=0
  # The devcontainer base is a local refreshed image tag, not a published
  # release stream. Keep DL3007 out of this repo's floor until that changes.
  if [ "${#DOCKERFILES[@]}" -gt 0 ]; then
    echo "lint:config-sensors: hadolint checking ${#DOCKERFILES[@]} maintained Dockerfile(s)."
    if ! run_hadolint_with_repair_retry "$wrapper" --ignore DL3007 "${DOCKERFILES[@]}"; then
      failed=1
    fi
  fi
  if [ "${#REFERENCE_DOCKERFILES[@]}" -gt 0 ]; then
    echo "lint:config-sensors: hadolint checking ${#REFERENCE_DOCKERFILES[@]} local reference Dockerfile(s)."
    if ! run_hadolint_with_repair_retry "$wrapper" --ignore DL3008 --ignore DL3015 --ignore DL4006 "${REFERENCE_DOCKERFILES[@]}"; then
      failed=1
    fi
  fi
  return "$failed"
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

failed=0
run_actionlint || failed=1
run_yamllint || failed=1
run_taplo || failed=1
run_hadolint || failed=1
exit "$failed"
