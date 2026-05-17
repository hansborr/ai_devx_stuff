#!/usr/bin/env bash
# Pure-shell tests for dependency freshness diagnostics.

set -euo pipefail

# When run inside a parent `git commit`, git exports GIT_DIR / GIT_INDEX_FILE /
# GIT_WORK_TREE / GIT_PREFIX. Inherited values would make every `git add` and
# `git diff --cached` below operate on the outer repo's index, leaking staged
# entries into the parent and tripping the pre-commit flock. Clear them so the
# sandbox repos this script creates stand alone.
unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE GIT_PREFIX

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/dependency-freshness.sh"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/verify-metadata.sh"

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

copy_precommit_fixture() {
  local target="$1"

  mkdir -p "$target/scripts/ai-hooks" "$target/.husky" "$target/node_modules/.bin" "$target/bin"
  cp "$SCRIPT_DIR/dependency-freshness.sh" "$target/scripts/dependency-freshness.sh"
  cp "$SCRIPT_DIR/prisma-client-freshness.sh" "$target/scripts/prisma-client-freshness.sh"
  cp "$SCRIPT_DIR/doc-length-policy.sh" "$target/scripts/doc-length-policy.sh"
  cp "$SCRIPT_DIR/verify-metadata.sh" "$target/scripts/verify-metadata.sh"
  cp "$SCRIPT_DIR/ai-hooks/output-filter.sh" "$target/scripts/ai-hooks/output-filter.sh"
  cp "$SCRIPT_DIR/../.husky/pre-commit" "$target/.husky/pre-commit"
  cat > "$target/bin/bun" <<'STUB'
#!/usr/bin/env sh
printf 'stub bun %s\n' "$*" >> "$STUB_LOG"
exit 0
STUB
  chmod +x "$target/bin/bun"
}

init_bridge_repo() {
  local repo="$1"

  copy_precommit_fixture "$repo"
  (
    cd "$repo"
    git init -q
    git config user.name "Test User"
    git config user.email "test@example.invalid"
    git add .husky scripts bin
    git commit -q -m init
    mkdir -p packages
    printf 'initial\n' > packages/example.ts
    git add packages/example.ts
    git commit -q -m source
  )
}

write_marker_with_ts() {
  local marker="$1"
  local ts="$2"
  local head="$3"
  local hash="$4"

  mkdir -p "$(dirname "$marker")"
  {
    printf 'LAST_TS=%s\n' "$ts"
    printf 'LAST_HEAD=%s\n' "$head"
    printf 'LAST_HASH=%s\n' "$hash"
  } > "$marker"
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
cp "$SCRIPT_DIR/verify-metadata.sh" "$hook_repo/scripts/verify-metadata.sh"
cp "$SCRIPT_DIR/ai-hooks/output-filter.sh" "$hook_repo/scripts/ai-hooks/output-filter.sh"
cp "$SCRIPT_DIR/../.husky/pre-commit" "$hook_repo/.husky/pre-commit"
(
  cd "$hook_repo"
  git init -q
  git config user.name "Test User"
  git config user.email "test@example.invalid"
  git add .husky scripts
  git commit -q -m init
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
if [ "${2:-}" = "lint:changed" ] && [ -n "${STUB_SLEEP_LINT_CHANGED:-}" ]; then
  sleep "$STUB_SLEEP_LINT_CHANGED"
fi
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
  [ -f "$log_dir/run-meta.json" ] || fail "pre-commit did not write run-meta.json"
  grep -q '"mode":"parallel-precommit"' "$log_dir/run-meta.json" \
    || fail "pre-commit metadata should record parallel-precommit mode"
  grep -q '"name":"wrapper"' "$log_dir/run-meta.json" \
    || fail "pre-commit metadata should record wrapper timing"
  grep -q 'bun run test:changed --reporter=dot --reporter=json --outputFile.json='"$log_dir"'/test-timings.json' "$log_dir/run-meta.json" \
    || fail "pre-commit metadata should record json timing capture command"
  grep -q '^LAST_TS=[0-9]\+$' "$marker" || fail "pre-commit did not rewrite marker with numeric LAST_TS"
)
ok "pre-commit treats corrupt success marker as a cache miss"

gate_repo="$TMP_ROOT/gate-repo"
mkdir -p "$gate_repo/scripts/ai-hooks" "$gate_repo/.husky" "$gate_repo/node_modules/.bin" "$gate_repo/bin" "$gate_repo/eslint-rules"
cp "$SCRIPT_DIR/dependency-freshness.sh" "$gate_repo/scripts/dependency-freshness.sh"
cp "$SCRIPT_DIR/prisma-client-freshness.sh" "$gate_repo/scripts/prisma-client-freshness.sh"
cp "$SCRIPT_DIR/doc-length-policy.sh" "$gate_repo/scripts/doc-length-policy.sh"
cp "$SCRIPT_DIR/verify-metadata.sh" "$gate_repo/scripts/verify-metadata.sh"
cp "$SCRIPT_DIR/ai-hooks/output-filter.sh" "$gate_repo/scripts/ai-hooks/output-filter.sh"
cp "$SCRIPT_DIR/../.husky/pre-commit" "$gate_repo/.husky/pre-commit"
cat > "$gate_repo/bin/bun" <<'STUB'
#!/usr/bin/env sh
printf 'stub bun %s\n' "$*" >> "$STUB_LOG"
exit 0
STUB
chmod +x "$gate_repo/bin/bun"
(
  cd "$gate_repo"
  git init -q
  git config user.name "Test User"
  git config user.email "test@example.invalid"
  git add .husky scripts bin
  git commit -q -m init
  printf 'rule\n' > eslint-rules/example.js
  git add eslint-rules/example.js

  marker="$gate_repo/precommit-marker-eslint-rules"
  log_dir="$gate_repo/precommit-logs-eslint-rules"
  stub_log="$gate_repo/bun-eslint-rules.log"
  : > "$stub_log"

  output="$(
    PATH="$gate_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    MUSI_PRECOMMIT_MARKER="$marker" \
    MUSI_VERIFY_LOCK="$gate_repo/precommit-lock-eslint-rules" \
    MUSI_VERIFY_LOG_DIR="$log_dir" \
      sh .husky/pre-commit 2>&1
  )" || fail "pre-commit should run checks for staged eslint-rules edits: $output"

  grep -qF "stub bun run lint:changed" "$stub_log" \
    || fail "eslint-rules staged change did not run lint"
  grep -qF "stub bun run test:changed --reporter=dot" "$stub_log" \
    || fail "eslint-rules staged change did not run test:changed"
  grep -qF "pre-commit: OK" <<< "$output" \
    || fail "pre-commit with eslint-rules edit missing OK output: $output"
)
ok "pre-commit runs checks for staged eslint-rules changes"

deletion_repo="$TMP_ROOT/deletion-repo"
mkdir -p "$deletion_repo/scripts/ai-hooks" "$deletion_repo/.husky" "$deletion_repo/node_modules/.bin" "$deletion_repo/bin"
copy_precommit_fixture "$deletion_repo"
(
  cd "$deletion_repo"
  git init -q
  git config user.name "Test User"
  git config user.email "test@example.invalid"
  git add .husky scripts bin
  git commit -q -m init

  mkdir -p packages
  printf 'delete me\n' > packages/delete-me.ts
  git add packages/delete-me.ts
  git commit -q -m source
  git rm -q packages/delete-me.ts

  marker="$deletion_repo/precommit-marker-deletion"
  log_dir="$deletion_repo/precommit-logs-deletion"
  stub_log="$deletion_repo/bun-deletion.log"
  : > "$stub_log"

  output="$(
    PATH="$deletion_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    MUSI_PRECOMMIT_MARKER="$marker" \
    MUSI_VERIFY_LOCK="$deletion_repo/precommit-lock-deletion" \
    MUSI_VERIFY_LOG_DIR="$log_dir" \
      sh .husky/pre-commit 2>&1
  )" || fail "pre-commit should run checks for staged source deletions: $output"

  grep -qF "stub bun run lint:changed" "$stub_log" \
    || fail "staged source deletion did not run lint"
  grep -qF "stub bun run typecheck" "$stub_log" \
    || fail "staged source deletion did not run typecheck"
  grep -qF "stub bun run test:changed --reporter=dot" "$stub_log" \
    || fail "staged source deletion did not run test:changed"
  grep -qF "pre-commit: OK" <<< "$output" \
    || fail "pre-commit with source deletion missing OK output: $output"
)
ok "pre-commit runs checks for staged source deletions"

cache_repo="$TMP_ROOT/cache-repo"
mkdir -p "$cache_repo/scripts/ai-hooks" "$cache_repo/.husky" "$cache_repo/node_modules/.bin" "$cache_repo/bin"
cp "$SCRIPT_DIR/dependency-freshness.sh" "$cache_repo/scripts/dependency-freshness.sh"
cp "$SCRIPT_DIR/prisma-client-freshness.sh" "$cache_repo/scripts/prisma-client-freshness.sh"
cp "$SCRIPT_DIR/doc-length-policy.sh" "$cache_repo/scripts/doc-length-policy.sh"
cp "$SCRIPT_DIR/verify-metadata.sh" "$cache_repo/scripts/verify-metadata.sh"
cp "$SCRIPT_DIR/ai-hooks/output-filter.sh" "$cache_repo/scripts/ai-hooks/output-filter.sh"
cp "$SCRIPT_DIR/../.husky/pre-commit" "$cache_repo/.husky/pre-commit"
cat > "$cache_repo/bin/bun" <<'STUB'
#!/usr/bin/env sh
printf 'stub bun %s\n' "$*" >> "$STUB_LOG"
exit 0
STUB
chmod +x "$cache_repo/bin/bun"
(
  cd "$cache_repo"
  git init -q
  git config user.name "Test User"
  git config user.email "test@example.invalid"
  git add .husky scripts
  git commit -q -m init

  mkdir -p packages
  printf 'staged\n' > packages/example.ts
  git add packages/example.ts

  marker="$cache_repo/precommit-marker-cache"
  log_dir="$cache_repo/precommit-logs-cache"
  stub_log="$cache_repo/bun-cache.log"
  : > "$stub_log"

  output="$(
    PATH="$cache_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    MUSI_PRECOMMIT_MARKER="$marker" \
    MUSI_VERIFY_LOCK="$cache_repo/precommit-lock-cache" \
    MUSI_VERIFY_LOG_DIR="$log_dir" \
      sh .husky/pre-commit 2>&1
  )" || fail "initial pre-commit should run checks: $output"
  grep -qF "pre-commit: OK" <<< "$output" \
    || fail "initial pre-commit missing OK output: $output"

  printf 'staged\nunstaged\n' > packages/example.ts
  set +e
  output="$(
    PATH="$cache_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    MUSI_PRECOMMIT_MARKER="$marker" \
    MUSI_VERIFY_LOCK="$cache_repo/precommit-lock-cache" \
    MUSI_VERIFY_LOG_DIR="$log_dir" \
      sh .husky/pre-commit 2>&1
  )"
  exit_code=$?
  set -e

  [ "$exit_code" -ne 0 ] || fail "pre-commit should fail after unstaged source changes"
  grep -qF "source-relevant unstaged or untracked changes" <<< "$output" \
    || fail "pre-commit unstaged source diagnostic missing reason: $output"
  grep -qF "packages/example.ts" <<< "$output" \
    || fail "pre-commit unstaged source diagnostic missing file: $output"
  grep -qF "stage" <<< "$output" \
    || fail "pre-commit unstaged source diagnostic should mention staging: $output"
  grep -qF "stash" <<< "$output" \
    || fail "pre-commit unstaged source diagnostic should mention stashing: $output"
  lint_runs=$(grep -cF "stub bun run lint:changed" "$stub_log")
  [ "$lint_runs" -eq 1 ] || fail "pre-commit should fail before rerunning lint after unstaged source change; lint runs=$lint_runs"
  if grep -qF "already verified" <<< "$output"; then
    fail "pre-commit should not short-circuit after unstaged source change: $output"
  fi
)
ok "pre-commit fails fast on unstaged source changes before cache reuse"

bridge_changed_repo="$TMP_ROOT/bridge-changed-repo"
init_bridge_repo "$bridge_changed_repo"
(
  cd "$bridge_changed_repo"
  printf 'tracked edit\n' > packages/example.ts
  git add packages/example.ts
  staged_hash="$(ai_staged_fingerprint "$PWD")"

  precommit_marker="$TMP_ROOT/bridge-changed-precommit-marker"
  changed_marker="$TMP_ROOT/bridge-changed-verify-marker"
  full_marker="$TMP_ROOT/bridge-changed-full-marker"
  log_dir="$TMP_ROOT/bridge-changed-logs"
  stub_log="$TMP_ROOT/bridge-changed-bun.log"
  mkdir -p "$log_dir/meta"
  printf 'verify run meta\n' > "$log_dir/run-meta.json"
  printf 'verify wrapper\n' > "$log_dir/meta/wrapper.json"
  : > "$stub_log"
  musi_write_success_marker "$changed_marker" "$(git rev-parse HEAD)" "$staged_hash" \
    || fail "test setup failed to write changed verify marker"

  output="$(
    PATH="$bridge_changed_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    MUSI_PRECOMMIT_MARKER="$precommit_marker" \
    MUSI_VERIFY_MARKER_CHANGED="$changed_marker" \
    MUSI_VERIFY_MARKER_FULL="$full_marker" \
    MUSI_VERIFY_LOCK="$TMP_ROOT/bridge-changed-lock" \
    MUSI_VERIFY_LOG_DIR="$log_dir" \
      sh .husky/pre-commit 2>&1
  )" || fail "pre-commit should bridge from verify:changed marker: $output"

  grep -qF "pre-commit: verify:changed passed" <<< "$output" \
    || fail "bridge skip should name verify:changed source: $output"
  [ ! -s "$stub_log" ] || fail "bridge skip should not invoke bun commands"
  [ -f "$precommit_marker" ] || fail "bridge skip did not write pre-commit marker"
  grep -qxF "verify run meta" "$log_dir/run-meta.json" \
    || fail "bridge skip should not replace run-meta.json"
  grep -qxF "verify wrapper" "$log_dir/meta/wrapper.json" \
    || fail "bridge skip should not replace wrapper metadata"

  output="$(
    PATH="$bridge_changed_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    MUSI_PRECOMMIT_MARKER="$precommit_marker" \
    MUSI_VERIFY_MARKER_CHANGED="$changed_marker" \
    MUSI_VERIFY_MARKER_FULL="$full_marker" \
    MUSI_VERIFY_LOCK="$TMP_ROOT/bridge-changed-lock" \
    MUSI_VERIFY_LOG_DIR="$log_dir" \
      sh .husky/pre-commit 2>&1
  )" || fail "second pre-commit should use native pre-commit marker: $output"
  grep -qF "pre-commit: already verified" <<< "$output" \
    || fail "second pre-commit did not use native marker: $output"
  if grep -qF "verify:changed passed" <<< "$output"; then
    fail "second pre-commit should not re-use the bridge path: $output"
  fi
)
ok "pre-commit bridges from staged verify:changed marker and writes native marker"

bridge_changed_stale_repo="$TMP_ROOT/bridge-changed-stale-repo"
init_bridge_repo "$bridge_changed_stale_repo"
(
  cd "$bridge_changed_stale_repo"
  printf 'first staged edit\n' > packages/example.ts
  git add packages/example.ts
  staged_hash="$(ai_staged_fingerprint "$PWD")"
  printf 'second staged file\n' > packages/second.ts
  git add packages/second.ts

  precommit_marker="$TMP_ROOT/bridge-changed-stale-precommit-marker"
  changed_marker="$TMP_ROOT/bridge-changed-stale-verify-marker"
  full_marker="$TMP_ROOT/bridge-changed-stale-full-marker"
  log_dir="$TMP_ROOT/bridge-changed-stale-logs"
  stub_log="$TMP_ROOT/bridge-changed-stale-bun.log"
  : > "$stub_log"
  musi_write_success_marker "$changed_marker" "$(git rev-parse HEAD)" "$staged_hash" \
    || fail "test setup failed to write stale staged verify marker"

  output="$(
    PATH="$bridge_changed_stale_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    MUSI_PRECOMMIT_MARKER="$precommit_marker" \
    MUSI_VERIFY_MARKER_CHANGED="$changed_marker" \
    MUSI_VERIFY_MARKER_FULL="$full_marker" \
    MUSI_VERIFY_LOCK="$TMP_ROOT/bridge-changed-stale-lock" \
    MUSI_VERIFY_LOG_DIR="$log_dir" \
      sh .husky/pre-commit 2>&1
  )" || fail "pre-commit should run when staged diff changes after verify:changed: $output"

  grep -qF "pre-commit: OK" <<< "$output" \
    || fail "staged-diff bridge miss should run checks successfully: $output"
  grep -qF "stub bun run lint:changed" "$stub_log" \
    || fail "staged-diff bridge miss did not run lint"
  if grep -qF "passed" <<< "$output"; then
    fail "staged-diff bridge miss should not print a bridge skip: $output"
  fi
)
ok "pre-commit does not bridge when staged diff changes after verify:changed"

bridge_full_repo="$TMP_ROOT/bridge-full-repo"
init_bridge_repo "$bridge_full_repo"
(
  cd "$bridge_full_repo"
  printf 'tracked full edit\n' > packages/example.ts
  git add packages/example.ts
  worktree_hash="$(ai_worktree_fingerprint "$PWD")"
  head="$(git rev-parse HEAD)"

  precommit_marker="$TMP_ROOT/bridge-full-precommit-marker"
  changed_marker="$TMP_ROOT/bridge-full-changed-marker"
  full_marker="$TMP_ROOT/bridge-full-verify-marker"
  log_dir="$TMP_ROOT/bridge-full-logs"
  stub_log="$TMP_ROOT/bridge-full-bun.log"
  stale_ts=$(( $(date +%s) - 500 ))
  write_marker_with_ts "$changed_marker" "$stale_ts" "$head" "$worktree_hash"
  musi_write_success_marker "$full_marker" "$head" "$worktree_hash" \
    || fail "test setup failed to write full verify marker"
  : > "$stub_log"

  output="$(
    PATH="$bridge_full_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    MUSI_PRECOMMIT_MARKER="$precommit_marker" \
    MUSI_VERIFY_MARKER_CHANGED="$changed_marker" \
    MUSI_VERIFY_MARKER_FULL="$full_marker" \
    MUSI_VERIFY_LOCK="$TMP_ROOT/bridge-full-lock" \
    MUSI_VERIFY_LOG_DIR="$log_dir" \
      sh .husky/pre-commit 2>&1
  )" || fail "pre-commit should fall through to matching full verify marker: $output"

  grep -qF "pre-commit: verify passed" <<< "$output" \
    || fail "full verify bridge skip should name verify source: $output"
  if grep -qF "verify:changed passed" <<< "$output"; then
    fail "stale changed marker should not be accepted before full marker: $output"
  fi
  [ ! -s "$stub_log" ] || fail "full verify bridge skip should not invoke bun commands"
)
ok "pre-commit falls through from stale changed marker to full verify marker"

bridge_negative_repo="$TMP_ROOT/bridge-negative-repo"
init_bridge_repo "$bridge_negative_repo"
(
  cd "$bridge_negative_repo"
  printf 'tracked negative edit\n' > packages/example.ts
  git add packages/example.ts
  staged_hash="$(ai_staged_fingerprint "$PWD")"
  head="$(git rev-parse HEAD)"

  run_bridge_miss_case() {
    local name="$1"
    local force="${2:-}"
    local precommit_marker="$TMP_ROOT/${name}-precommit-marker"
    local changed_marker="$TMP_ROOT/${name}-changed-marker"
    local full_marker="$TMP_ROOT/${name}-full-marker"
    local log_dir="$TMP_ROOT/${name}-logs"
    local stub_log="$TMP_ROOT/${name}-bun.log"
    local output

    : > "$stub_log"
    output="$(
      PATH="$bridge_negative_repo/bin:$PATH" \
      STUB_LOG="$stub_log" \
      FORCE_VERIFY="$force" \
      MUSI_PRECOMMIT_MARKER="$precommit_marker" \
      MUSI_VERIFY_MARKER_CHANGED="$changed_marker" \
      MUSI_VERIFY_MARKER_FULL="$full_marker" \
      MUSI_VERIFY_LOCK="$TMP_ROOT/${name}-lock" \
      MUSI_VERIFY_LOG_DIR="$log_dir" \
        sh .husky/pre-commit 2>&1
    )" || fail "$name should run checks after bridge miss: $output"

    grep -qF "pre-commit: OK" <<< "$output" \
      || fail "$name bridge miss should finish with OK output: $output"
    grep -qF "stub bun run lint:changed" "$stub_log" \
      || fail "$name bridge miss did not run lint"
    if grep -qF "for this staged/worktree state" <<< "$output"; then
      fail "$name should not print a bridge skip: $output"
    fi
  }

  stale_ts=$(( $(date +%s) - 500 ))
  write_marker_with_ts "$TMP_ROOT/stale-manual-changed-marker" "$stale_ts" "$head" "$staged_hash"
  run_bridge_miss_case stale-manual

  {
    printf 'LAST_TS=%s\n' "$(date +%s)"
    printf 'LAST_HEAD=%s\n' "$head"
  } > "$TMP_ROOT/missing-fields-changed-marker"
  run_bridge_miss_case missing-fields

  {
    printf 'LAST_TS=%s\n' "$(date +%s)"
    printf 'LAST_HEAD=%s\n' "$head"
    printf 'LAST_HASH=%s\n' "$staged_hash"
    printf 'EXTRA=unexpected\n'
  } > "$TMP_ROOT/unknown-key-changed-marker"
  run_bridge_miss_case unknown-key

  musi_write_success_marker "$TMP_ROOT/wrong-head-changed-marker" "wrong-head" "$staged_hash" \
    || fail "test setup failed to write wrong-head marker"
  run_bridge_miss_case wrong-head

  bad_hash="$(printf '0%.0s' {1..64})"
  [ "$bad_hash" = "$staged_hash" ] && bad_hash="$(printf '1%.0s' {1..64})"
  musi_write_success_marker "$TMP_ROOT/hash-mismatch-changed-marker" "$head" "$bad_hash" \
    || fail "test setup failed to write hash-mismatch marker"
  run_bridge_miss_case hash-mismatch

  musi_write_success_marker "$TMP_ROOT/force-verify-changed-marker" "$head" "$staged_hash" \
    || fail "test setup failed to write force marker"
  run_bridge_miss_case force-verify 1
)
ok "pre-commit bridge fails closed for stale malformed mismatched and FORCE markers"

(
  cd "$hook_repo"
  printf 'timeout source\n' > packages/timeout.ts
  git add packages/timeout.ts

  marker="$hook_repo/precommit-marker-timeout"
  log_dir="$hook_repo/precommit-logs-timeout"
  stub_log="$hook_repo/bun-timeout.log"
  : > "$stub_log"

  set +e
  output="$(
    PATH="$hook_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    STUB_SLEEP_LINT_CHANGED=10 \
    MUSI_VERIFY_TIMEOUT=2 \
    MUSI_PRECOMMIT_MARKER="$marker" \
    MUSI_VERIFY_LOCK="$hook_repo/precommit-lock-timeout" \
    MUSI_VERIFY_LOG_DIR="$log_dir" \
      sh .husky/pre-commit 2>&1
  )"
  exit_code=$?
  set -e

  [ "$exit_code" -eq 124 ] || fail "pre-commit timeout should exit 124 (got $exit_code): $output"
  grep -qF "PRE-COMMIT TIMED OUT" <<< "$output" \
    || fail "pre-commit timeout missing banner: $output"
  grep -qF "logs: $log_dir" <<< "$output" \
    || fail "pre-commit timeout missing log breadcrumb: $output"
  [ -f "$log_dir/run-meta.json" ] || fail "pre-commit timeout did not write run-meta.json"
  grep -q '"mode":"parallel-precommit"' "$log_dir/run-meta.json" \
    || fail "pre-commit timeout metadata should record parallel-precommit mode"
  grep -q '"name":"wrapper"' "$log_dir/run-meta.json" \
    || fail "pre-commit timeout metadata should record wrapper timing"
  grep -q '"exit_code":124' "$log_dir/run-meta.json" \
    || fail "pre-commit timeout metadata should record exit_code 124"
  if [ -f "$marker" ]; then
    fail "pre-commit timeout should not write success marker"
  fi
)
ok "pre-commit timeout records wrapper metadata"

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

script_deletion_repo="$TMP_ROOT/script-deletion-repo"
mkdir -p "$script_deletion_repo"
copy_precommit_fixture "$script_deletion_repo"
(
  cd "$script_deletion_repo"
  git init -q
  git config user.name "Test User"
  git config user.email "test@example.invalid"
  git add .husky scripts bin
  git commit -q -m init
  printf 'script source\n' > scripts/example.sh
  git add scripts/example.sh
  git commit -q -m script
  git rm -q scripts/example.sh

  marker="$script_deletion_repo/precommit-marker-script-deletion"
  log_dir="$script_deletion_repo/precommit-logs-script-deletion"
  stub_log="$script_deletion_repo/bun-script-deletion.log"
  : > "$stub_log"

  output="$(
    PATH="$script_deletion_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    MUSI_PRECOMMIT_MARKER="$marker" \
    MUSI_VERIFY_LOCK="$script_deletion_repo/precommit-lock-script-deletion" \
    MUSI_VERIFY_LOG_DIR="$log_dir" \
      sh .husky/pre-commit 2>&1
  )" || fail "pre-commit should run script smoke tests for staged script deletions: $output"

  grep -qF "stub bun run test:scripts:changed" "$stub_log" \
    || fail "staged script deletion did not run test:scripts:changed"
  grep -qF "pre-commit: OK" <<< "$output" \
    || fail "pre-commit with script deletion missing OK output: $output"
)
ok "pre-commit runs script smoke tests for staged script deletions"

hook_only_repo="$TMP_ROOT/hook-only-repo"
mkdir -p "$hook_only_repo/scripts/ai-hooks" "$hook_only_repo/.husky" "$hook_only_repo/node_modules/.bin" "$hook_only_repo/bin"
cp "$SCRIPT_DIR/dependency-freshness.sh" "$hook_only_repo/scripts/dependency-freshness.sh"
cp "$SCRIPT_DIR/prisma-client-freshness.sh" "$hook_only_repo/scripts/prisma-client-freshness.sh"
cp "$SCRIPT_DIR/doc-length-policy.sh" "$hook_only_repo/scripts/doc-length-policy.sh"
cp "$SCRIPT_DIR/verify-metadata.sh" "$hook_only_repo/scripts/verify-metadata.sh"
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
  git config user.name "Test User"
  git config user.email "test@example.invalid"
  git add scripts bin
  git commit -q -m init
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
