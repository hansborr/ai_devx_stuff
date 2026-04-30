#!/usr/bin/env bash
# Pure-shell tests for dependency freshness diagnostics.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/dependency-freshness.sh"

PASS=0
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok() { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }

assert_status() {
  local repo="$1"
  local expected="$2"
  local got
  got="$(musi_dependency_status "$repo")"
  [[ "$got" == "$expected" ]] || fail "expected status $expected, got $got"
}

repo="$TMP_ROOT/repo"
mkdir -p "$repo"

assert_status "$repo" warn
musi_dependency_message "$repo" | grep -qF "no bun.lock" || fail "missing lock message"
ok "missing lockfile reports a warning"

printf 'lock\n' > "$repo/bun.lock"
assert_status "$repo" missing
musi_dependency_message "$repo" | grep -qF "node_modules missing" || fail "missing node_modules message"
ok "missing install reports missing state"

mkdir -p "$repo/node_modules"
assert_status "$repo" stale
musi_dependency_message "$repo" | grep -qF "node_modules/.bin missing" || fail "missing .bin message"
ok "missing install marker reports stale state"

mkdir -p "$repo/node_modules/.bin"
touch -t 202604260101 "$repo/bun.lock"
touch -t 202604260102 "$repo/node_modules/.bin"
assert_status "$repo" fresh
ok "install marker newer than lockfile reports fresh state"

touch -t 202604260103 "$repo/bun.lock"
touch -t 202604260102 "$repo/node_modules/.bin"
assert_status "$repo" stale
musi_dependency_message "$repo" | grep -qF "bun.lock newer" || fail "stale lockfile message"
ok "lockfile newer than install marker reports stale state"

hook_repo="$TMP_ROOT/hook-repo"
mkdir -p "$hook_repo/scripts/ai-hooks" "$hook_repo/.husky" "$hook_repo/node_modules/.bin"
cp "$SCRIPT_DIR/dependency-freshness.sh" "$hook_repo/scripts/dependency-freshness.sh"
cp "$SCRIPT_DIR/prisma-client-freshness.sh" "$hook_repo/scripts/prisma-client-freshness.sh"
cp "$SCRIPT_DIR/doc-length-policy.sh" "$hook_repo/scripts/doc-length-policy.sh"
cp "$SCRIPT_DIR/ai-hooks/output-filter.sh" "$hook_repo/scripts/ai-hooks/output-filter.sh"
cp "$SCRIPT_DIR/../.husky/pre-commit" "$hook_repo/.husky/pre-commit"
(
  cd "$hook_repo"
  git init -q
  printf 'lock\n' > bun.lock
  touch -t 202604260102 node_modules/.bin
  touch -t 202604260103 bun.lock
  git add bun.lock
  output="$(sh .husky/pre-commit 2>&1)" || fail "sh pre-commit lockfile-only path failed: $output"
  printf '%s\n' "$output" | grep -qF "pre-commit: WARN: bun.lock is staged" || fail "sh pre-commit output missing freshness warning: $output"
  printf '%s\n' "$output" | grep -qF "no source changes staged" || fail "sh pre-commit output missing skip message: $output"
  if printf '%s\n' "$output" | grep -qF "[[: not found"; then
    fail "sh pre-commit output leaked bash [[ syntax error: $output"
  fi
)
ok "pre-commit lockfile warning works when invoked through sh"

(
  cd "$hook_repo"
  mkdir -p bin packages
  cat > bin/bun <<'STUB'
#!/usr/bin/env sh
printf 'stub bun %s\n' "$*" >> "$STUB_LOG"
exit 0
STUB
  chmod +x bin/bun

  printf 'source\n' > packages/example.ts
  git add packages/example.ts

  marker="$hook_repo/precommit-marker"
  log_dir="$hook_repo/precommit-logs"
  stub_log="$hook_repo/bun.log"
  cat > "$marker" <<'BAD_MARKER'
LAST_TS=abc
LAST_HEAD=whatever
LAST_HASH=whatever
BAD_MARKER
  : > "$stub_log"

  output="$(
    PATH="$hook_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    MUSI_PRECOMMIT_MARKER="$marker" \
    MUSI_VERIFY_LOCK="$hook_repo/precommit-lock" \
    MUSI_VERIFY_LOG_DIR="$log_dir" \
      sh .husky/pre-commit 2>&1
  )" || fail "pre-commit should ignore corrupt marker and run checks: $output"

  grep -qF "pre-commit: OK" <<< "$output" || fail "pre-commit missing OK output: $output"
  grep -qF "stub bun run lint:changed" "$stub_log" || fail "corrupt marker did not rerun lint"
  grep -qF "stub bun run typecheck" "$stub_log" || fail "corrupt marker did not rerun typecheck"
  grep -qF "stub bun run test:changed --reporter=dot" "$stub_log" || fail "corrupt marker did not rerun test"
  if grep -qF "stub bun run test:scripts:changed" "$stub_log"; then
    fail "non-script staged change should not run script smoke tests"
  fi
  grep -q '^LAST_TS=[0-9]\+$' "$marker" || fail "pre-commit did not rewrite marker with numeric LAST_TS"
)
ok "pre-commit treats corrupt success marker as a cache miss"

(
  cd "$hook_repo"
  printf 'script source\n' > scripts/example.sh
  git add scripts/example.sh

  marker="$hook_repo/precommit-marker-scripts"
  log_dir="$hook_repo/precommit-logs-scripts"
  stub_log="$hook_repo/bun-scripts.log"
  : > "$stub_log"

  output="$(
    PATH="$hook_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    MUSI_PRECOMMIT_MARKER="$marker" \
    MUSI_VERIFY_LOCK="$hook_repo/precommit-lock-scripts" \
    MUSI_VERIFY_LOG_DIR="$log_dir" \
      sh .husky/pre-commit 2>&1
  )" || fail "pre-commit should run script smoke tests for staged script edits: $output"

  grep -qF "stub bun run test:scripts:changed" "$stub_log" \
    || fail "script staged change did not run test:scripts:changed"
  grep -qF "pre-commit: OK" <<< "$output" \
    || fail "pre-commit with scripts missing OK output: $output"
)
ok "pre-commit runs script smoke tests for staged script changes"

hook_only_repo="$TMP_ROOT/hook-only-repo"
mkdir -p "$hook_only_repo/scripts/ai-hooks" "$hook_only_repo/.husky" "$hook_only_repo/node_modules/.bin" "$hook_only_repo/bin"
cp "$SCRIPT_DIR/dependency-freshness.sh" "$hook_only_repo/scripts/dependency-freshness.sh"
cp "$SCRIPT_DIR/prisma-client-freshness.sh" "$hook_only_repo/scripts/prisma-client-freshness.sh"
cp "$SCRIPT_DIR/doc-length-policy.sh" "$hook_only_repo/scripts/doc-length-policy.sh"
cp "$SCRIPT_DIR/ai-hooks/output-filter.sh" "$hook_only_repo/scripts/ai-hooks/output-filter.sh"
cp "$SCRIPT_DIR/../.husky/pre-commit" "$hook_only_repo/.husky/pre-commit"
cat > "$hook_only_repo/bin/bun" <<'STUB'
#!/usr/bin/env sh
printf 'stub bun %s\n' "$*" >> "$STUB_LOG"
exit 0
STUB
chmod +x "$hook_only_repo/bin/bun"
(
  cd "$hook_only_repo"
  git init -q
  git add .husky/pre-commit

  marker="$hook_only_repo/precommit-marker"
  log_dir="$hook_only_repo/precommit-logs"
  stub_log="$hook_only_repo/bun.log"
  : > "$stub_log"

  output="$(
    PATH="$hook_only_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    MUSI_PRECOMMIT_MARKER="$marker" \
    MUSI_VERIFY_LOCK="$hook_only_repo/precommit-lock" \
    MUSI_VERIFY_LOG_DIR="$log_dir" \
      sh .husky/pre-commit 2>&1
  )" || fail "pre-commit should run checks for staged hook edits: $output"

  grep -qF "stub bun run test:scripts:changed" "$stub_log" \
    || fail "hook staged change did not run test:scripts:changed"
  grep -qF "pre-commit: OK" <<< "$output" \
    || fail "pre-commit with hook edit missing OK output: $output"
)
ok "pre-commit runs script smoke tests for staged hook changes"

printf 'dependency freshness tests passed\n'
