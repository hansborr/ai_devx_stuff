#!/usr/bin/env bash
# Pure-shell tests for eslint-disable register diagnostics.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPORT="$SCRIPT_DIR/eslint-disable-register.sh"

PASS=0
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok() { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }

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
output="$(bash "$REPORT" "$repo" 2>&1)"
grep -qF 'PASS: eslint-disable register total=0 inline=0 broad=0' <<< "$output" \
  || fail "clean repo count was wrong: $output"
grep -qF 'all suppressions include -- reason' <<< "$output" \
  || fail "clean repo should pass missing-reason check: $output"
ok "reports zero suppressions"

repo="$(new_repo annotated)"
mkdir -p "$repo/src"
cat > "$repo/src/app.ts" <<'EOF'
/* eslint-disable no-magic-numbers -- reference table */
// eslint-disable-next-line no-console -- CLI command output
console.log(42);
EOF
git -C "$repo" add src/app.ts
output="$(bash "$REPORT" "$repo" 2>&1)"
grep -qF 'PASS: eslint-disable register total=2 inline=1 broad=1' <<< "$output" \
  || fail "annotated counts were wrong: $output"
if grep -qF 'WARN:' <<< "$output"; then
  fail "annotated suppressions should not warn: $output"
fi
ok "counts inline and broad suppressions separately"

repo="$(new_repo missing)"
mkdir -p "$repo/src" "$repo/docs" "$repo/eslint-rules"
cat > "$repo/src/app.ts" <<'EOF'
/* eslint-disable no-magic-numbers */
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
git -C "$repo" add src/app.ts docs/note.md eslint-rules/readme.js
output="$(bash "$REPORT" "$repo" 2>&1)"
grep -qF 'PASS: eslint-disable register total=2 inline=1 broad=1' <<< "$output" \
  || fail "missing-reason counts were wrong or docs/prose were included: $output"
grep -qF 'WARN: eslint-disable register missing reasons total=2 inline=1 broad=1' <<< "$output" \
  || fail "missing-reason warning was wrong: $output"
grep -qF 'src/app.ts:1 [broad]' <<< "$output" \
  || fail "missing broad entry not listed: $output"
grep -qF 'src/app.ts:2 [inline]' <<< "$output" \
  || fail "missing inline entry not listed: $output"
ok "flags missing reasons without counting docs or prose"

repo="$(new_repo untracked)"
mkdir -p "$repo/src"
cat > "$repo/src/new.ts" <<'EOF'
// eslint-disable-next-line no-console
console.log("new");
EOF
output="$(bash "$REPORT" "$repo" 2>&1)"
grep -qF 'PASS: eslint-disable register total=1 inline=1 broad=0' <<< "$output" \
  || fail "untracked lintable file was not counted: $output"
grep -qF 'WARN: eslint-disable register missing reasons total=1 inline=1 broad=0' <<< "$output" \
  || fail "untracked missing reason was not flagged: $output"
ok "counts untracked non-ignored lintable files"

printf 'eslint-disable register tests passed\n'
