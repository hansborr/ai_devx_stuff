#!/usr/bin/env bash
# Smoke test for scripts/lint-agent-changed.sh.
#
# The wrapper's job is file selection (committed + staged + unstaged diff
# vs base, dedup, filter by lintable extension and existence on disk),
# with a fall-back to FULL_SCAN on lint-affecting config changes and an
# EMPTY path when nothing matches. The actual `bun lint-agent.ts`
# invocation is exercised by `scripts/test-lint-agent.sh`; this smoke
# uses the wrapper's `--print-files` debug flag so we can verify
# selection on a synthetic git repo without setting up a full ESLint
# fixture.
#
# Each case rebuilds an isolated temp repo with a `base` ref and then
# makes the indicated changes vs base. The assertions compare
# `--print-files` stdout against the expected outcome.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WRAPPER="$SCRIPT_DIR/lint-agent-changed.sh"

PASS=0
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok()   { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }

bash -n "$WRAPPER" || fail "lint-agent-changed.sh fails bash -n"
ok "lint-agent-changed.sh passes bash -n"

new_repo() {
  local repo="$1"
  rm -rf "$repo"
  mkdir -p "$repo"
  git -C "$repo" init -q -b base
  git -C "$repo" config user.email "smoke@example.com"
  git -C "$repo" config user.name "smoke"
  printf 'export const seed = 1;\n' >"$repo/seed.ts"
  git -C "$repo" add seed.ts
  git -C "$repo" -c commit.gpgsign=false commit -q -m "seed"
}

run_print() {
  local repo="$1"
  ( cd "$repo" && bash "$WRAPPER" --print-files base ) 2>/dev/null
}

make_nonempty() {
  local repo="$1"
  printf 'export const seed = 2;\n' >"$repo/seed.ts"
}

expect_wrapper_reject() {
  local label="$1" repo="$2" expected="$3"
  shift 3
  local out err rc
  out="$ROOT/$label.out"
  err="$ROOT/$label.err"
  set +e
  ( cd "$repo" && bash "$WRAPPER" "$@" >"$out" 2>"$err" )
  rc=$?
  set -e
  [ "$rc" -ne 0 ] || {
    printf 'stdout:\n%s\nstderr:\n%s\n' "$(cat "$out")" "$(cat "$err")"
    fail "$label expected wrapper rejection"
  }
  grep -qF "$expected" "$err" || {
    printf 'stderr:\n%s\n' "$(cat "$err")"
    fail "$label missing expected error: $expected"
  }
}

ROOT=$(mktemp -d "${TMPDIR:-/tmp}/lint-agent-changed-smoke-XXXXXX")
trap 'rm -rf "$ROOT"' EXIT

REPO1="$ROOT/case1"
new_repo "$REPO1"
out=$(run_print "$REPO1")
[ "$out" = "EMPTY" ] || { printf '%s\n' "$out"; fail "case1 expected EMPTY, got '$out'"; }
ok "no changes vs base → EMPTY"

REPO2="$ROOT/case2"
new_repo "$REPO2"
printf 'export const seed = 2;\n' >"$REPO2/seed.ts"
out=$(run_print "$REPO2")
[ "$out" = "seed.ts" ] || { printf '%s\n' "$out"; fail "case2 expected 'seed.ts', got '$out'"; }
ok "unstaged .ts change is selected"

REPO3="$ROOT/case3"
new_repo "$REPO3"
printf 'export const seed = 3;\n' >"$REPO3/seed.ts"
git -C "$REPO3" add seed.ts
printf 'export const seed = 4;\n' >"$REPO3/seed.ts"
printf 'export const other = true;\n' >"$REPO3/other.tsx"
git -C "$REPO3" add other.tsx
printf 'readme\n' >"$REPO3/notes.md"
git -C "$REPO3" add notes.md
out=$(run_print "$REPO3" | sort)
expected=$(printf 'other.tsx\nseed.ts\n')
[ "$out" = "$expected" ] || { printf 'got:\n%s\nwant:\n%s\n' "$out" "$expected"; fail "case3 selection wrong"; }
ok "staged + unstaged dedup, non-lintable filtered out"

REPO4="$ROOT/case4"
new_repo "$REPO4"
rm "$REPO4/seed.ts"
out=$(run_print "$REPO4")
[ "$out" = "EMPTY" ] || { printf '%s\n' "$out"; fail "case4 expected EMPTY (deleted file is not lintable), got '$out'"; }
ok "deleted file is not selected"

REPO5="$ROOT/case5"
new_repo "$REPO5"
printf 'export default [];\n' >"$REPO5/eslint.config.js"
git -C "$REPO5" add eslint.config.js
out=$(run_print "$REPO5")
[ "$out" = "FULL_SCAN" ] || { printf '%s\n' "$out"; fail "case5 expected FULL_SCAN on eslint.config.js change, got '$out'"; }
ok "eslint.config.* change triggers FULL_SCAN"

REPO6="$ROOT/case6"
new_repo "$REPO6"
printf '{"name":"x"}\n' >"$REPO6/package.json"
git -C "$REPO6" add package.json
out=$(run_print "$REPO6")
[ "$out" = "FULL_SCAN" ] || { printf '%s\n' "$out"; fail "case6 expected FULL_SCAN on package.json change, got '$out'"; }
ok "package.json change triggers FULL_SCAN"

REPO7="$ROOT/case7"
new_repo "$REPO7"
printf '{}\n' >"$REPO7/tsconfig.json"
git -C "$REPO7" add tsconfig.json
out=$(run_print "$REPO7")
[ "$out" = "FULL_SCAN" ] || { printf '%s\n' "$out"; fail "case7 expected FULL_SCAN on tsconfig.json change, got '$out'"; }
ok "tsconfig*.json change triggers FULL_SCAN"

REPO8="$ROOT/case8"
new_repo "$REPO8"
mkdir -p "$REPO8/eslint-rules"
printf 'export default {};\n' >"$REPO8/eslint-rules/my-rule.ts"
git -C "$REPO8" add eslint-rules/my-rule.ts
out=$(run_print "$REPO8")
[ "$out" = "FULL_SCAN" ] || { printf '%s\n' "$out"; fail "case8 expected FULL_SCAN on eslint-rules/* change, got '$out'"; }
ok "eslint-rules/* change triggers FULL_SCAN"

REPO8b="$ROOT/case8b"
new_repo "$REPO8b"
printf '{}\n' >"$REPO8b/bun.lock"
git -C "$REPO8b" add bun.lock
out=$(run_print "$REPO8b")
[ "$out" = "FULL_SCAN" ] || { printf '%s\n' "$out"; fail "case8b expected FULL_SCAN on bun.lock change, got '$out'"; }
ok "bun.lock change triggers FULL_SCAN"

REPO8c="$ROOT/case8c"
new_repo "$REPO8c"
mkdir -p "$REPO8c/packages/server"
printf '{"name":"server"}\n' >"$REPO8c/packages/server/package.json"
git -C "$REPO8c" add packages/server/package.json
out=$(run_print "$REPO8c")
[ "$out" = "FULL_SCAN" ] || { printf '%s\n' "$out"; fail "case8c expected FULL_SCAN on packages/*/package.json change, got '$out'"; }
ok "packages/*/package.json change triggers FULL_SCAN"

REPO8d="$ROOT/case8d"
new_repo "$REPO8d"
mkdir -p "$REPO8d/packages/client"
printf '{}\n' >"$REPO8d/packages/client/tsconfig.json"
git -C "$REPO8d" add packages/client/tsconfig.json
out=$(run_print "$REPO8d")
[ "$out" = "FULL_SCAN" ] || { printf '%s\n' "$out"; fail "case8d expected FULL_SCAN on packages/*/tsconfig*.json change, got '$out'"; }
ok "packages/*/tsconfig*.json change triggers FULL_SCAN"

REPO9="$ROOT/case9"
new_repo "$REPO9"
git -C "$REPO9" checkout -q -b feature
printf 'export const seed = 9;\n' >"$REPO9/seed.ts"
git -C "$REPO9" add seed.ts
git -C "$REPO9" -c commit.gpgsign=false commit -q -m "branch change"
out=$(run_print "$REPO9")
[ "$out" = "seed.ts" ] || { printf '%s\n' "$out"; fail "case9 expected base..HEAD diff to surface seed.ts, got '$out'"; }
ok "committed change on branch (base..HEAD) is selected"

REPO10="$ROOT/case10"
new_repo "$REPO10"
out=$( (cd "$REPO10" && bash "$WRAPPER" --print-files nonexistent-base-ref) 2>/dev/null)
[ "$out" = "FULL_SCAN" ] || { printf '%s\n' "$out"; fail "case10 expected FULL_SCAN on missing base ref, got '$out'"; }
ok "missing base ref triggers FULL_SCAN"

# Untracked files: agents routinely create new files without staging
# them first. The wrapper must include them in the changed set so a
# brand-new lintable file isn't silently dropped.
REPO11="$ROOT/case11"
new_repo "$REPO11"
printf 'export const fresh = 11;\n' >"$REPO11/fresh.ts"
out=$(run_print "$REPO11")
[ "$out" = "fresh.ts" ] || { printf '%s\n' "$out"; fail "case11 expected 'fresh.ts' (untracked), got '$out'"; }
ok "untracked .ts file is selected"

# Untracked + tracked unstaged: both must appear, deduped, in sorted order.
REPO12="$ROOT/case12"
new_repo "$REPO12"
printf 'export const seed = 12;\n' >"$REPO12/seed.ts"
printf 'export const fresh = 12;\n' >"$REPO12/fresh.ts"
out=$(run_print "$REPO12" | sort)
expected=$(printf 'fresh.ts\nseed.ts\n')
[ "$out" = "$expected" ] || { printf 'got:\n%s\nwant:\n%s\n' "$out" "$expected"; fail "case12 expected tracked+untracked, got '$out'"; }
ok "untracked + tracked unstaged are merged and deduped"

# Smoke against the real run mode (not --print-files): empty changed
# set must still produce a schema-valid envelope on stdout. This is the
# only path the smoke exercises end-to-end through bun; the rest stay
# in --print-files for hermetic selection coverage.
REPO13="$ROOT/case13"
new_repo "$REPO13"
empty_stdout=$( (cd "$REPO13" && bash "$WRAPPER" base) 2>/dev/null)
case "$empty_stdout" in
  *'"version": "1"'*'"tool": "lint:agent"'*'"findings": []'*) ;;
  *) printf 'stdout:\n%s\n' "$empty_stdout"; fail "case13 expected empty envelope on stdout";;
esac
ok "empty changed set emits schema-valid envelope on stdout"

# Empty path must honor --output so machine-readable consumers see the
# envelope in the destination file, not stdout. The wrapper extracts
# --output before exec-ing the emitter. Preserve stderr so a wrapper
# crash (set -u violation, missing bun, syntax error) surfaces with an
# actionable message rather than a bare "expected file" assertion.
REPO14="$ROOT/case14"
new_repo "$REPO14"
err=$( (cd "$REPO14" && bash "$WRAPPER" base --output out.json) 2>&1 >/dev/null) || true
[ -f "$REPO14/out.json" ] || { printf 'stderr:\n%s\n' "$err"; fail "case14 expected --output to write out.json"; }
grep -q '"findings": \[\]' "$REPO14/out.json" || {
  cat "$REPO14/out.json"
  fail "case14 expected findings: [] in out.json"
}
ok "empty path honors --output (space-separated form)"

REPO15="$ROOT/case15"
new_repo "$REPO15"
err=$( (cd "$REPO15" && bash "$WRAPPER" base --output=out15.json) 2>&1 >/dev/null) || true
[ -f "$REPO15/out15.json" ] || { printf 'stderr:\n%s\n' "$err"; fail "case15 expected --output=path to write out15.json"; }
ok "empty path honors --output=path (equals form)"

# Leading flag (no positional base) must NOT be consumed as the base
# ref. Default to `main` and forward the flag intact. Use a no-change
# repo so the flag flows through the empty-envelope path where we can
# verify the output file got created.
REPO16="$ROOT/case16"
new_repo "$REPO16"
git -C "$REPO16" branch -m base main
err=$( (cd "$REPO16" && bash "$WRAPPER" --output out16.json) 2>&1 >/dev/null) || true
[ -f "$REPO16/out16.json" ] || { printf 'stderr:\n%s\n' "$err"; fail "case16 expected leading --output to write out16.json"; }
ok "leading --output is not consumed as the base ref"

REPO17="$ROOT/case17-empty-no-output"
new_repo "$REPO17"
expect_wrapper_reject "case17-empty-no-output" "$REPO17" \
  "lint:agent:changed: --output requires a path argument" \
  base --output
REPO17b="$ROOT/case17b-nonempty-no-output"
new_repo "$REPO17b"
make_nonempty "$REPO17b"
expect_wrapper_reject "case17b-nonempty-no-output" "$REPO17b" \
  "lint:agent:changed: --output requires a path argument" \
  base --output
ok "--output with no value is rejected on empty and non-empty paths"

REPO18="$ROOT/case18-empty-flag-output"
new_repo "$REPO18"
expect_wrapper_reject "case18-empty-flag-output" "$REPO18" \
  "lint:agent:changed: --output requires a path argument" \
  base --output --prefix
REPO18b="$ROOT/case18b-nonempty-flag-output"
new_repo "$REPO18b"
make_nonempty "$REPO18b"
expect_wrapper_reject "case18b-nonempty-flag-output" "$REPO18b" \
  "lint:agent:changed: --output requires a path argument" \
  base --output --prefix
ok "--output rejects flag-shaped values on empty and non-empty paths"

REPO19="$ROOT/case19-empty-equals-flag-output"
new_repo "$REPO19"
expect_wrapper_reject "case19-empty-equals-flag-output" "$REPO19" \
  "lint:agent:changed: --output= requires a path argument, got: --prefix" \
  base --output=--prefix
REPO19b="$ROOT/case19b-nonempty-equals-flag-output"
new_repo "$REPO19b"
make_nonempty "$REPO19b"
expect_wrapper_reject "case19b-nonempty-equals-flag-output" "$REPO19b" \
  "lint:agent:changed: --output= requires a path argument, got: --prefix" \
  base --output=--prefix
ok "--output= rejects flag-shaped values on empty and non-empty paths"

REPO20="$ROOT/case20-empty-unknown"
new_repo "$REPO20"
expect_wrapper_reject "case20-empty-unknown" "$REPO20" \
  "lint:agent:changed: unknown argument: --bogus" \
  base --bogus
REPO20b="$ROOT/case20b-nonempty-unknown"
new_repo "$REPO20b"
make_nonempty "$REPO20b"
expect_wrapper_reject "case20b-nonempty-unknown" "$REPO20b" \
  "lint:agent:changed: unknown argument: --bogus" \
  base --bogus
ok "unknown flags are rejected on empty and non-empty paths"

REPO21="$ROOT/case21-empty-prefix"
new_repo "$REPO21"
prefix_stdout=$( (cd "$REPO21" && bash "$WRAPPER" base --prefix agent) 2>/dev/null)
case "$prefix_stdout" in
  *'"version": "1"'*'"tool": "lint:agent"'*'"findings": []'*) ;;
  *) printf 'stdout:\n%s\n' "$prefix_stdout"; fail "case21 expected empty envelope with --prefix";;
esac
REPO21b="$ROOT/case21b-nonempty-prefix"
new_repo "$REPO21b"
make_nonempty "$REPO21b"
err=$( (cd "$REPO21b" && bash "$WRAPPER" base --prefix=agent --output prefix.json) 2>&1 >/dev/null) || {
  printf 'stderr:\n%s\n' "$err"
  fail "case21b expected --prefix=agent to be accepted"
}
[ -f "$REPO21b/prefix.json" ] || { printf 'stderr:\n%s\n' "$err"; fail "case21b expected prefix.json"; }
ok "--prefix is accepted on empty and non-empty paths"

REPO22="$ROOT/case22-no-merge-base-print-files"
new_repo "$REPO22"
git -C "$REPO22" checkout -q --orphan orphan
git -C "$REPO22" rm -q -rf .
printf 'orphan\n' >"$REPO22/README.md"
git -C "$REPO22" add README.md
git -C "$REPO22" -c commit.gpgsign=false commit -q -m "orphan seed"
out=$(run_print "$REPO22")
[ "$out" = "FULL_SCAN" ] || { printf '%s\n' "$out"; fail "case22 expected FULL_SCAN when base shares no history, got '$out'"; }
ok "no merge base triggers FULL_SCAN in --print-files mode"

REPO23="$ROOT/case23-no-merge-base-real-run"
new_repo "$REPO23"
git -C "$REPO23" checkout -q --orphan orphan
git -C "$REPO23" rm -q -rf .
printf 'orphan\n' >"$REPO23/README.md"
git -C "$REPO23" add README.md
git -C "$REPO23" -c commit.gpgsign=false commit -q -m "orphan seed"
out="$ROOT/case23.out"
err="$ROOT/case23.err"
set +e
( cd "$REPO23" && bash "$WRAPPER" base >"$out" 2>"$err" )
rc=$?
set -e
[ "$rc" -eq 0 ] || {
  printf 'stdout:\n%s\nstderr:\n%s\n' "$(cat "$out")" "$(cat "$err")"
  fail "case23 expected no-history full-scan fallback to exit 0"
}
grep -qF "lint:agent:changed: 'base' shares no history with HEAD" "$err" || {
  printf 'stderr:\n%s\n' "$(cat "$err")"
  fail "case23 missing no-history fallback diagnostic"
}
ok "no merge base real run falls back to full lint:agent"

REPO24="$ROOT/case24-subdir-print-files"
new_repo "$REPO24"
mkdir -p "$REPO24/sub"
printf 'export const seed = 24;\n' >"$REPO24/seed.ts"
out=$( (cd "$REPO24/sub" && bash "$WRAPPER" --print-files base) 2>/dev/null )
[ "$out" = "seed.ts" ] || { printf '%s\n' "$out"; fail "case24 expected root-level changed file from subdir invocation"; }
ok "subdirectory --print-files invocation keeps repo-root changed files"

REPO25="$ROOT/case25-subdir-relative-output"
new_repo "$REPO25"
mkdir -p "$REPO25/sub"
err=$( (cd "$REPO25/sub" && bash "$WRAPPER" base --output out.json) 2>&1 >/dev/null) || true
[ -f "$REPO25/sub/out.json" ] || { printf 'stderr:\n%s\n' "$err"; fail "case25 expected relative --output to resolve under caller cwd"; }
[ ! -f "$REPO25/out.json" ] || fail "case25 did not expect relative --output at repo root"
ok "subdirectory relative --output writes next to caller"

printf '\n%d/%d tests passed\n' "$PASS" "$PASS"
