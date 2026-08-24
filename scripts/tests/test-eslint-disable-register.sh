#!/usr/bin/env bash
# smoke-order: 100
# smoke-subjects: scripts/eslint-disable-register.sh
# smoke-subjects: scripts/data/eslint-disable-broad-allowlist.txt
# smoke-subjects: scripts/lib/changed-base.sh
# smoke-subjects: scripts/lib/changed-lintable-files.sh
# smoke-subjects: scripts/lib/verify-metadata.sh
# smoke-subjects: scripts/lib/verify-commit-queue.sh
# smoke-subjects: scripts/lib/verify-fast-commit.sh
# smoke-subjects: scripts/lib/verify-markers.sh
# smoke-subjects: scripts/lib/verify-path-policy.sh
# smoke-subjects: scripts/lib/verify-run-meta.sh
# smoke-subjects: scripts/lib/verify-state-paths.sh
# smoke-subjects: scripts/path-policy/path-policy-query.ts
# smoke-subjects: scripts/path-policy/path-policy-query-core.ts
# smoke-subjects: scripts/path-policy/segment-pattern.ts
# smoke-subjects: scripts/path-policy/path-policy.ts
# smoke-subjects: scripts/path-policy/smoke-test-files.ts
# smoke-subjects: scripts/tests/lib/test-git-env.sh
# smoke-subjects: scripts/tests/test-eslint-disable-register.sh
# Pure-shell tests for eslint-disable register diagnostics.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/test-git-env.sh
. "$SCRIPT_DIR/lib/test-git-env.sh"
musi_clear_inherited_git_hook_env
musi_exit_after_git_hook_env_assertion_if_requested
REPORT="$SCRIPT_DIR/../eslint-disable-register.sh"
ALLOWLIST="$SCRIPT_DIR/../data/eslint-disable-broad-allowlist.txt"

PASS=0
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT
RUN_OUTPUT=""
RUN_STATUS=0

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok() { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }
contains() { [[ "$1" == *"$2"* ]]; }

[[ -s "$ALLOWLIST" ]] || fail "eslint-disable broad allowlist data file is missing or empty"
if grep -q 'packages/shared/src/map/grid-utils.ts|no-magic-numbers' "$REPORT"; then
  fail "eslint-disable broad allowlist should not remain embedded in bash"
fi
ok "broad suppression waivers live in the data inventory"

run_report() {
  set +e
  RUN_OUTPUT="$(bash "$REPORT" "$1" 2>&1)"
  RUN_STATUS=$?
  set -e
}

run_report_changed() {
  set +e
  RUN_OUTPUT="$(bash "$REPORT" --changed base "$1" 2>&1)"
  RUN_STATUS=$?
  set -e
}

IDENT_FILE=""
run_report_identities() {
  IDENT_FILE="$TMP_ROOT/identities-$PASS.tsv"
  set +e
  RUN_OUTPUT="$(bash "$REPORT" --identities-out "$IDENT_FILE" "$1" 2>&1)"
  RUN_STATUS=$?
  set -e
}

run_report_changed_identities() {
  IDENT_FILE="$TMP_ROOT/identities-changed-$PASS.tsv"
  set +e
  RUN_OUTPUT="$(bash "$REPORT" --changed base --identities-out "$IDENT_FILE" "$1" 2>&1)"
  RUN_STATUS=$?
  set -e
}

new_repo() {
  local name="$1"
  local repo="$TMP_ROOT/$name"
  mkdir -p "$repo/scripts/data"
  git -C "$repo" init -q
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name Test
  printf '%s\n' '# fixture broad-disable allowlist' > "$repo/scripts/data/eslint-disable-broad-allowlist.txt"
  git -C "$repo" add scripts/data/eslint-disable-broad-allowlist.txt
  printf '%s\n' "$repo"
}

allow_broad_rule() {
  local repo="$1" entry="$2"
  printf '%s\n' "$entry" >> "$repo/scripts/data/eslint-disable-broad-allowlist.txt"
}

repo="$(new_repo clean)"
printf 'const value = 1;\n' > "$repo/app.ts"
git -C "$repo" add app.ts
run_report "$repo"
[ "$RUN_STATUS" -eq 0 ] || fail "clean repo should pass: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'PASS: eslint-disable register total=0 inline=0 broad=0' \
  || fail "clean repo count was wrong: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'all suppressions include -- reason' \
  || fail "clean repo should pass missing-reason check: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'broad suppressions are allowlisted total=0' \
  || fail "clean repo should pass broad allowlist check: $RUN_OUTPUT"
ok "reports zero suppressions"

repo="$(new_repo annotated)"
allow_broad_rule "$repo" 'packages/shared/src/rules/xp.ts|no-magic-numbers'
mkdir -p "$repo/src" "$repo/packages/shared/src/rules"
cat > "$repo/packages/shared/src/rules/xp.ts" <<'EOF'
/* eslint-disable no-magic-numbers -- reference table */
export const xp = 42;
EOF
cat > "$repo/src/app.ts" <<'EOF'
// eslint-disable-next-line no-console -- CLI command output
console.log(42);
EOF
git -C "$repo" add src/app.ts packages/shared/src/rules/xp.ts
run_report "$repo"
[ "$RUN_STATUS" -eq 0 ] || fail "annotated suppressions should pass: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'PASS: eslint-disable register total=2 inline=1 broad=1' \
  || fail "annotated counts were wrong: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'broad suppressions are allowlisted total=1' \
  || fail "annotated broad suppression should be allowlisted: $RUN_OUTPUT"
if contains "$RUN_OUTPUT" 'FAIL:'; then
  fail "annotated suppressions should not fail: $RUN_OUTPUT"
fi
ok "counts inline and broad suppressions separately"

repo="$(new_repo allowlisted-deprecated-test)"
allow_broad_rule "$repo" 'packages/server/src/utils/prisma-types.test.ts|@typescript-eslint/no-deprecated'
mkdir -p "$repo/packages/server/src/utils"
cat > "$repo/packages/server/src/utils/prisma-types.test.ts" <<'EOF'
/* eslint-disable @typescript-eslint/no-deprecated -- compile-time deprecated-never contract */
export const ok = true;
EOF
git -C "$repo" add packages/server/src/utils/prisma-types.test.ts
run_report "$repo"
[ "$RUN_STATUS" -eq 0 ] || fail "allowlisted deprecated test suppression should pass: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'PASS: eslint-disable register total=1 inline=0 broad=1' \
  || fail "allowlisted deprecated test count was wrong: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'broad suppressions are allowlisted total=1' \
  || fail "deprecated test broad suppression should be allowlisted: $RUN_OUTPUT"
ok "allows the compile-time deprecation test broad suppression"

repo="$(new_repo overlapping-live-allowlist-rows)"
allow_broad_rule "$repo" 'src/*.ts|no-console'
allow_broad_rule "$repo" 'src/app.ts|no-console'
mkdir -p "$repo/src"
cat > "$repo/src/app.ts" <<'EOF'
/* eslint-disable no-console -- CLI output module */
console.log("live");
EOF
git -C "$repo" add .
run_report "$repo"
[ "$RUN_STATUS" -eq 0 ] || fail "one directive should mark every overlapping broad allowlist row used: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'PASS: eslint-disable register unused broad allowlist entries total=0' \
  || fail "overlapping broad allowlist rows were not all marked used: $RUN_OUTPUT"
ok "marks overlapping glob and exact-path broad allowlist rows used"

repo="$(new_repo stale-allowlist-row)"
allow_broad_rule "$repo" 'src/retired.ts|no-console'
printf 'export const clean = true;\n' > "$repo/src.ts"
git -C "$repo" add .
run_report "$repo"
[ "$RUN_STATUS" -eq 1 ] || fail "full scan should reject an unmatched broad-disable allowlist row: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'FAIL: eslint-disable register unused broad allowlist entries total=1' \
  || fail "stale broad allowlist failure was missing: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'src/retired.ts|no-console' \
  || fail "stale broad allowlist entry was not listed: $RUN_OUTPUT"
ok "full scan rejects unmatched broad-disable allowlist rows"

repo="$(new_repo changed-scope-stale-allowlist-row)"
allow_broad_rule "$repo" 'src/retired.ts|no-console'
mkdir -p "$repo/src"
printf 'export const legacy = true;\n' > "$repo/src/legacy.ts"
git -C "$repo" add .
git -C "$repo" -c commit.gpgsign=false commit -q -m "seed unmatched global permission"
git -C "$repo" branch base
printf 'export const changed = true;\n' > "$repo/src/changed.ts"
git -C "$repo" add src/changed.ts
run_report_changed "$repo"
[ "$RUN_STATUS" -eq 0 ] || fail "changed scope should not infer that a global allowlist row is stale: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'PASS: eslint-disable register scope=changed' \
  || fail "changed-scope stale-row fixture did not remain narrowed: $RUN_OUTPUT"
if contains "$RUN_OUTPUT" 'unused broad allowlist entries'; then
  fail "changed scope must ignore unmatched global allowlist rows: $RUN_OUTPUT"
fi
ok "changed scope ignores unmatched global broad-disable allowlist rows"

repo="$(new_repo missing)"
mkdir -p "$repo/src" "$repo/docs" "$repo/eslint-rules" "$repo/packages/shared/src/rules"
cat > "$repo/packages/shared/src/rules/xp.ts" <<'EOF'
/* eslint-disable no-magic-numbers */
export const xp = 42;
EOF
cat > "$repo/src/app.ts" <<'EOF'
// eslint-disable-next-line no-console
console.log(42);
EOF
cat > "$repo/docs/note.md" <<'EOF'
// eslint-disable-next-line no-console
EOF
cat > "$repo/eslint-rules/readme.js" <<'EOF'
/**
 * Mention `// eslint-disable-next-line local/example` in prose.
 */
export const ok = true;
EOF
git -C "$repo" add src/app.ts docs/note.md eslint-rules/readme.js packages/shared/src/rules/xp.ts
run_report "$repo"
[ "$RUN_STATUS" -eq 1 ] || fail "missing-reason suppressions should fail: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'PASS: eslint-disable register total=2 inline=1 broad=1' \
  || fail "missing-reason counts were wrong or docs/prose were included: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'FAIL: eslint-disable register missing reasons total=2 inline=1 broad=1' \
  || fail "missing-reason failure was wrong: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'packages/shared/src/rules/xp.ts:1 [broad]' \
  || fail "missing broad entry not listed: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'src/app.ts:1 [inline]' \
  || fail "missing inline entry not listed: $RUN_OUTPUT"
ok "flags missing reasons without counting docs or prose"

repo="$(new_repo broad)"
mkdir -p "$repo/src"
cat > "$repo/src/app.ts" <<'EOF'
/* eslint-disable no-console -- module-level console shim */
console.log("broad");
EOF
git -C "$repo" add src/app.ts
run_report "$repo"
[ "$RUN_STATUS" -eq 1 ] || fail "unallowlisted broad suppression should fail: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'PASS: eslint-disable register total=1 inline=0 broad=1' \
  || fail "broad suppression count was wrong: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'FAIL: eslint-disable register broad suppressions outside allowlist total=1' \
  || fail "broad allowlist failure was wrong: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'scripts/data/eslint-disable-broad-allowlist.txt' \
  || fail "broad allowlist failure should point at the data inventory: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'src/app.ts:1 rules=no-console' \
  || fail "unallowlisted broad entry not listed: $RUN_OUTPUT"
ok "flags broad suppressions outside the allowlist"

repo="$(new_repo untracked)"
mkdir -p "$repo/src"
cat > "$repo/src/new.ts" <<'EOF'
// eslint-disable-next-line no-console
console.log("new");
EOF
run_report "$repo"
[ "$RUN_STATUS" -eq 1 ] || fail "untracked missing reason should fail: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'PASS: eslint-disable register total=1 inline=1 broad=0' \
  || fail "untracked lintable file was not counted: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'FAIL: eslint-disable register missing reasons total=1 inline=1 broad=0' \
  || fail "untracked missing reason was not flagged: $RUN_OUTPUT"
ok "counts untracked non-ignored lintable files"

repo="$(new_repo string-literal)"
mkdir -p "$repo/src"
cat > "$repo/src/app.ts" <<'EOF'
const line = "escaped \" // eslint-disable-next-line no-console";
const block = "escaped \" /* eslint-disable no-console */";
EOF
git -C "$repo" add src/app.ts
run_report "$repo"
[ "$RUN_STATUS" -eq 0 ] || fail "string-literal fixture should pass: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'PASS: eslint-disable register total=0 inline=0 broad=0' \
  || fail "string-literal fixture should not be counted: $RUN_OUTPUT"
ok "ignores string-literal eslint-disable fixtures"

repo="$(new_repo template-literal)"
mkdir -p "$repo/src"
cat > "$repo/src/app.ts" <<'EOF'
export const fixture = `
  // eslint-disable-next-line no-console
  console.log(${value});
`;
export const done = true;
EOF
git -C "$repo" add src/app.ts
run_report "$repo"
[ "$RUN_STATUS" -eq 0 ] || fail "multi-line template literal fixture should pass: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'PASS: eslint-disable register total=0 inline=0 broad=0' \
  || fail "directive inside multi-line template literal was counted: $RUN_OUTPUT"
ok "ignores directives inside multi-line template literals"

repo="$(new_repo template-unclosed-block)"
mkdir -p "$repo/src"
cat > "$repo/src/app.ts" <<'EOF'
export const fixture = `
  /* unclosed block comment inside string data
`;
// eslint-disable-next-line no-console -- CLI command output
console.log(42);
EOF
git -C "$repo" add src/app.ts
run_report "$repo"
[ "$RUN_STATUS" -eq 0 ] || fail "unclosed /* in template fixture should pass: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'PASS: eslint-disable register total=1 inline=1 broad=0' \
  || fail "real directive after template with unclosed /* was not counted: $RUN_OUTPUT"
ok "does not leak template contents into block-comment state"

# Pin the accepted line-scanner tradeoff: the scanner has no regex-literal
# handling, so a code-position backtick that is NOT a template opener (here a
# regex literal) flips the file-scoped template state, and a genuine directive
# before the next backtick escapes the register — an accepted false negative,
# preferred over treating template data as code and false-failing the gate.
# Any future change that starts counting this must be deliberate.
repo="$(new_repo regex-backtick)"
mkdir -p "$repo/src"
cat > "$repo/src/app.ts" <<'EOF'
export const re = /[`]/;
// eslint-disable-next-line no-console -- CLI command output
console.log(42);
EOF
git -C "$repo" add src/app.ts
run_report "$repo"
[ "$RUN_STATUS" -eq 0 ] || fail "regex-backtick fixture should pass: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'PASS: eslint-disable register total=0 inline=0 broad=0' \
  || fail "directive after a regex-literal backtick should stay uncounted (pinned tradeoff): $RUN_OUTPUT"
ok "pins the uncounted directive after a non-template regex-literal backtick"

repo="$(new_repo changed-scope)"
mkdir -p "$repo/src"
cat > "$repo/src/legacy.ts" <<'EOF'
// eslint-disable-next-line no-console
console.log("legacy");
EOF
git -C "$repo" add src/legacy.ts
git -C "$repo" -c commit.gpgsign=false commit -q -m "seed legacy violation"
git -C "$repo" branch base
cat > "$repo/src/changed.ts" <<'EOF'
// eslint-disable-next-line no-console -- changed CLI output
console.log("changed");
EOF
git -C "$repo" add src/changed.ts
run_report_changed "$repo"
[ "$RUN_STATUS" -eq 0 ] || fail "changed scope should ignore unchanged violations: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'PASS: eslint-disable register scope=changed total=1 inline=1 broad=0' \
  || fail "changed scope summary should be labeled and scoped: $RUN_OUTPUT"
ok "changed mode scans only staged/base changed source files"

repo="$(new_repo changed-self-trigger)"
mkdir -p "$repo/src" "$repo/scripts"
cat > "$repo/src/legacy.ts" <<'EOF'
// eslint-disable-next-line no-console
console.log("legacy");
EOF
cp "$REPORT" "$repo/scripts/eslint-disable-register.sh"
# Keep the sandbox copy set closed over the scanner's sourced dependencies
# (fixture-shell-dependencies tripwire); tracked so changed mode stays clean.
mkdir -p "$repo/scripts/lib"
cp "$SCRIPT_DIR/../lib/changed-base.sh" "$repo/scripts/lib/changed-base.sh"
cp "$SCRIPT_DIR/../lib/changed-lintable-files.sh" "$repo/scripts/lib/changed-lintable-files.sh"
cp "$SCRIPT_DIR/../lib/verify-metadata.sh" "$repo/scripts/lib/verify-metadata.sh"
cp "$SCRIPT_DIR/../lib/verify-commit-queue.sh" "$repo/scripts/lib/verify-commit-queue.sh"
cp "$SCRIPT_DIR/../lib/verify-fast-commit.sh" "$repo/scripts/lib/verify-fast-commit.sh"
cp "$SCRIPT_DIR/../lib/verify-markers.sh" "$repo/scripts/lib/verify-markers.sh"
cp "$SCRIPT_DIR/../lib/verify-path-policy.sh" "$repo/scripts/lib/verify-path-policy.sh"
cp "$SCRIPT_DIR/../lib/verify-run-meta.sh" "$repo/scripts/lib/verify-run-meta.sh"
cp "$SCRIPT_DIR/../lib/verify-state-paths.sh" "$repo/scripts/lib/verify-state-paths.sh"
git -C "$repo" add src/legacy.ts scripts/eslint-disable-register.sh scripts/lib
git -C "$repo" -c commit.gpgsign=false commit -q -m "seed scanner and violation"
git -C "$repo" branch base
printf '\n# scanner policy changed\n' >> "$repo/scripts/eslint-disable-register.sh"
git -C "$repo" add scripts/eslint-disable-register.sh
run_report_changed "$repo"
[ "$RUN_STATUS" -eq 1 ] || fail "scanner change should escalate and find unchanged violation: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'PASS: eslint-disable register scope=full total=1 inline=1 broad=0' \
  || fail "self-triggered scan should be labeled full: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'FAIL: eslint-disable register missing reasons total=1' \
  || fail "self-triggered full scan missed unchanged violation: $RUN_OUTPUT"
ok "changed mode escalates when eslint-disable scanner policy changes"

repo="$(new_repo changed-unstaged-abort)"
mkdir -p "$repo/scripts"
printf 'echo seed\n' > "$repo/scripts/tool.sh"
git -C "$repo" add scripts/tool.sh
git -C "$repo" -c commit.gpgsign=false commit -q -m "seed source-relevant script"
git -C "$repo" branch base
# An unstaged, source-relevant modification must abort --changed rather than
# false-green a partial tree. The bare gate call discarded this exit code.
printf 'echo unstaged\n' >> "$repo/scripts/tool.sh"
run_report_changed "$repo"
[ "$RUN_STATUS" -ne 0 ] || fail "unstaged source-relevant change should abort changed mode: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'source-relevant unstaged or untracked changes are present' \
  || fail "unstaged abort message missing: $RUN_OUTPUT"
ok "changed mode aborts on unstaged source-relevant changes"

# Leaf 50 step 2: this scanner is the single authority on what counts as a
# directive, so the suppression identity ledger consumes this emission instead
# of maintaining a second scanner. Emission is additive and must never move the
# register's own verdict or counts.
repo="$(new_repo identity-emission)"
mkdir -p "$repo/src"
cat > "$repo/src/app.ts" <<'EOF'
// eslint-disable-next-line no-console, eqeqeq -- debugging aid
console.log(1);
EOF
git -C "$repo" add src/app.ts
run_report_identities "$repo"
[ "$RUN_STATUS" -eq 0 ] || fail "identity emission must not change the verdict: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'PASS: eslint-disable register total=1 inline=1 broad=0' \
  || fail "identity emission changed the register counts: $RUN_OUTPUT"
[ "$(head -n 1 "$IDENT_FILE")" = "$(printf '#scope\tfull')" ] \
  || fail "identity file is missing the full-scope header: $(cat "$IDENT_FILE")"
[ "$(grep -cv '^#' "$IDENT_FILE")" -eq 1 ] \
  || fail "expected exactly one identity record: $(cat "$IDENT_FILE")"
[ "$(grep -v '^#' "$IDENT_FILE")" = "$(printf 'eslint-disable\tsrc/app.ts\t1\t// eslint-disable-next-line no-console, eqeqeq -- debugging aid')" ] \
  || fail "identity record shape was wrong: $(cat "$IDENT_FILE")"
ok "emits kind/path/line/text identity records without changing the verdict"

# Changed mode narrows the scan, so the ledger gate must be told which paths
# were actually looked at; otherwise every unscanned identity reads as removed.
repo="$(new_repo identity-emission-changed)"
mkdir -p "$repo/src"
printf 'const legacy = 1;\n' > "$repo/src/legacy.ts"
git -C "$repo" add src/legacy.ts
git -C "$repo" -c commit.gpgsign=false commit -q -m "seed unchanged file"
git -C "$repo" branch base
cat > "$repo/src/changed.ts" <<'EOF'
// eslint-disable-next-line no-console -- changed CLI output
console.log("changed");
EOF
git -C "$repo" add src/changed.ts
run_report_changed_identities "$repo"
[ "$RUN_STATUS" -eq 0 ] || fail "changed identity emission should pass: $RUN_OUTPUT"
[ "$(head -n 1 "$IDENT_FILE")" = "$(printf '#scope\tchanged')" ] \
  || fail "identity file is missing the changed-scope header: $(cat "$IDENT_FILE")"
contains "$(cat "$IDENT_FILE")" "$(printf '#path\tsrc/changed.ts')" \
  || fail "changed mode must list the scanned paths: $(cat "$IDENT_FILE")"
contains "$(cat "$IDENT_FILE")" "$(printf 'eslint-disable\tsrc/changed.ts\t1\t')" \
  || fail "changed mode dropped the identity record: $(cat "$IDENT_FILE")"
if contains "$(cat "$IDENT_FILE")" 'src/legacy.ts'; then
  fail "changed mode must not claim unscanned paths: $(cat "$IDENT_FILE")"
fi
ok "changed mode labels its scope and lists the scanned paths"

set +e
RUN_OUTPUT="$(bash "$REPORT" --identities-out 2>&1)"
RUN_STATUS=$?
set -e
[ "$RUN_STATUS" -eq 2 ] || fail "--identities-out without a path should exit 2: $RUN_OUTPUT"
contains "$RUN_OUTPUT" '--identities-out requires a path' \
  || fail "missing --identities-out path message was wrong: $RUN_OUTPUT"
ok "rejects --identities-out without a path"

not_repo="$TMP_ROOT/not-git"
mkdir -p "$not_repo"
run_report "$not_repo"
[ "$RUN_STATUS" -eq 2 ] || fail "outside git repo should fail as unchecked: $RUN_OUTPUT"
contains "$RUN_OUTPUT" "FAIL: eslint-disable register cannot check: $not_repo is not a git repository" \
  || fail "outside git repo failure was wrong: $RUN_OUTPUT"
ok "fails outside a git repo"

printf 'eslint-disable register tests passed\n'
