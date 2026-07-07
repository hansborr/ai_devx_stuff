# shellcheck shell=bash
# shellcheck disable=SC2034
# Cache arguments for the main ESLint lane. The normal flat config is broadly
# type-aware and locally extended, so the cache location is salted by inputs
# that can change diagnostics for otherwise unchanged linted files.

MUSI_ESLINT_MAIN_CACHE_ARGS=()

musi_eslint_main_repo_root() {
  local repo_root="${1:-}"
  if [ -z "$repo_root" ]; then
    repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
  fi
  printf '%s\n' "$repo_root"
}

musi_eslint_main_cache_identity_paths0() {
  local repo_root
  repo_root="$(musi_eslint_main_repo_root "${1:-}")"
  (
    cd "$repo_root" || exit 1
    find . \
      \( \
        -path './.git' \
        -o -name 'node_modules' \
        -o -path './.auth' \
        -o -path './.playwright-mcp' \
        -o -path './.stryker-tmp' \
        -o -path './.tools' \
        -o -path './coverage' \
        -o -path './e2e-ux-screenshots' \
        -o -path './playwright-report' \
        -o -path './reports' \
        -o -path './test-results' \
        -o -path './tmp' \
        -o -path './worktrees' \
      \) -prune -o \
      -type f \( \
        -name '*.ts' \
        -o -name '*.tsx' \
        -o -name '*.mts' \
        -o -name '*.cts' \
        -o -name 'tsconfig*.json' \
        -o -name 'tsconfig*.jsonc' \
        -o -name 'tsconfig.tsbuildinfo' \
        -o -path './eslint.config.*' \
        -o -path './eslint-config/*' \
        -o \( -path './eslint-rules/*' -a -name '*.js' \) \
        -o -name 'package.json' \
        -o -name 'bun.lock' \
      \) -print0
  ) | LC_ALL=C sort -z
}

musi_eslint_main_cache_identity_paths() {
  musi_eslint_main_cache_identity_paths0 "$@" | tr '\0' '\n'
}

musi_eslint_main_cache_identity_fingerprint_from_paths() {
  local repo_root paths_file rc
  repo_root="$(musi_eslint_main_repo_root "${1:-}")"
  paths_file="$(mktemp "${TMPDIR:-/tmp}/musi-eslint-main-cache-paths.XXXXXX")" || return 1
  cat > "$paths_file"

  if ! command -v node >/dev/null 2>&1; then
    rm -f "$paths_file"
    printf 'eslint-main-cache: node is required for cache salting\n' >&2
    return 1
  fi

  node - "$repo_root" "$paths_file" <<'NODE'
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const [, , repoRoot, pathsFile] = process.argv;
const paths = readFileSync(pathsFile);
const fingerprint = createHash("sha256");

function updatePath(path) {
  if (!path) return;

  fingerprint.update("path\0");
  fingerprint.update(path);
  fingerprint.update("\0");
  try {
    const content = readFileSync(join(repoRoot, path));
    fingerprint.update("sha256\0");
    fingerprint.update(createHash("sha256").update(content).digest("hex"));
    fingerprint.update("\0");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      fingerprint.update("missing\0");
      fingerprint.update(path);
      fingerprint.update("\0");
      return;
    }
    throw error;
  }
}

let start = 0;
for (let index = 0; index < paths.length; index += 1) {
  if (paths[index] !== 0) continue;
  updatePath(paths.subarray(start, index).toString("utf8"));
  start = index + 1;
}
if (start < paths.length) {
  updatePath(paths.subarray(start).toString("utf8"));
}

process.stdout.write(`${fingerprint.digest("hex")}\n`);
NODE
  rc=$?
  rm -f "$paths_file"
  return "$rc"
}

musi_eslint_main_cache_identity_fingerprint() {
  local repo_root
  repo_root="$(musi_eslint_main_repo_root "${1:-}")"
  musi_eslint_main_cache_identity_paths0 "$repo_root" \
    | musi_eslint_main_cache_identity_fingerprint_from_paths "$repo_root"
}

musi_eslint_main_absolute_cache_root() {
  local repo_root="$1" cache_root="$2"
  # A trailing slash would derive "<root>//identity-<fp>" while find(1) prints
  # single-slash children, so the prune self-exclusion would never match and
  # the just-created cache dir would be deleted every run.
  while [ "${cache_root%/}" != "$cache_root" ] && [ -n "${cache_root%/}" ]; do
    cache_root="${cache_root%/}"
  done
  case "$cache_root" in
    /*) printf '%s\n' "$cache_root" ;;
    *) printf '%s/%s\n' "$repo_root" "$cache_root" ;;
  esac
}

musi_eslint_main_prune_cache_dirs() {
  local cache_root="$1" current_dir="$2"
  [ -d "$cache_root" ] || return 0
  find "$cache_root" -mindepth 1 -maxdepth 1 -type d -name 'identity-*' \
    ! -path "$current_dir" -exec rm -rf {} +
}

musi_eslint_main_cache_args() {
  local repo_root fingerprint cache_root cache_root_abs cache_dir cache_location
  repo_root="$(musi_eslint_main_repo_root "${1:-}")"
  fingerprint="$(musi_eslint_main_cache_identity_fingerprint "$repo_root")" || return 1
  cache_root="${MUSI_ESLINT_MAIN_CACHE_ROOT:-node_modules/.cache/eslint-main}"
  cache_root_abs="$(musi_eslint_main_absolute_cache_root "$repo_root" "$cache_root")"
  cache_dir="$cache_root_abs/identity-$fingerprint"
  cache_location="$cache_dir/.eslintcache"
  mkdir -p "$cache_dir"
  musi_eslint_main_prune_cache_dirs "$cache_root_abs" "$cache_dir"
  MUSI_ESLINT_MAIN_CACHE_ARGS=(
    --cache
    --cache-location
    "$cache_location"
    --cache-strategy
    content
  )
}
