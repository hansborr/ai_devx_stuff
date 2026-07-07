#!/usr/bin/env bash
# smoke-order: 100
# smoke-subjects: scripts/eslint-disable-register.sh
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

PASS=0
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT
RUN_OUTPUT=""
RUN_STATUS=0

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok() { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }
contains() { [[ "$1" == *"$2"* ]]; }

run_report() {
  set +e
  RUN_OUTPUT="$(bash "$REPORT" "$1" 2>&1)"
  RUN_STATUS=$?
  set -e
}

new_repo() {
  local name="$1"
  local repo="$TMP_ROOT/$name"
  mkdir -p "$repo"
  git -C "$repo" init -q
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name Test
  printf '%s\n' "$repo"
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

not_repo="$TMP_ROOT/not-git"
mkdir -p "$not_repo"
run_report "$not_repo"
[ "$RUN_STATUS" -eq 2 ] || fail "outside git repo should fail as unchecked: $RUN_OUTPUT"
contains "$RUN_OUTPUT" "FAIL: eslint-disable register cannot check: $not_repo is not a git repository" \
  || fail "outside git repo failure was wrong: $RUN_OUTPUT"
ok "fails outside a git repo"

printf 'eslint-disable register tests passed\n'
