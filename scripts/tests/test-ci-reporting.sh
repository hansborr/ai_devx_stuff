#!/usr/bin/env bash
# smoke-order: 375
# smoke-subjects: scripts/ci/lint-ratchet-summary.sh
# smoke-subjects: scripts/ci/sticky-pr-comment.sh
# smoke-subjects: scripts/ci/slow-drift-summary.sh
# smoke-subjects: scripts/tests/test-ci-reporting.sh
# smoke-subjects: .github/workflows/ci.yml
# smoke-subjects: .github/workflows/slow-drift.yml
set -euo pipefail

cd "$(dirname "$0")/../.."
REPO_ROOT=$PWD
TMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/ci-reporting-smoke-XXXXXX")
cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

fail() {
  echo "ci-reporting smoke failed: $*" >&2
  exit 1
}

assert_file_equals() {
  local expected="$1"
  local actual="$2"
  local label="$3"

  if ! diff -u "$expected" "$actual"; then
    fail "$label"
  fi
}

assert_contains() {
  local file="$1"
  local expected="$2"
  local label="$3"

  grep -F -- "$expected" "$file" >/dev/null || fail "$label"
}

assert_contains ".github/workflows/ci.yml" \
  "run: bash scripts/ci/lint-ratchet-summary.sh" \
  "CI workflow should invoke the extracted lint summary script"
assert_contains ".github/workflows/ci.yml" \
  "if ! bash scripts/ci/sticky-pr-comment.sh; then" \
  "CI workflow should invoke the extracted sticky-comment script"
assert_contains ".github/workflows/slow-drift.yml" \
  "run: bash scripts/ci/slow-drift-summary.sh" \
  "slow-drift workflow should invoke the extracted summary script"

mkdir -p "$TMP_ROOT/bin"
cat > "$TMP_ROOT/bin/bun" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' 'formatter stdout with ``` inside'
printf '%s\n' 'formatter stderr' >&2
exit 9
EOF
chmod +x "$TMP_ROOT/bin/bun"

missing_dir="$TMP_ROOT/lint-missing"
mkdir -p "$missing_dir"
(
  cd "$missing_dir"
  GITHUB_STEP_SUMMARY="$missing_dir/step-summary.md" \
    LINT_RATCHET_ARTIFACT_URL="https://example.test/run/130#artifacts" \
    bash "$REPO_ROOT/scripts/ci/lint-ratchet-summary.sh"
)
cat > "$missing_dir/expected.md" <<'EOF'
<!-- lint-ratchet-summary -->
### Lint ratchet

Lint ratchet diagnostics envelope was not produced; the runner may have failed before emitting it.

Artifact: https://example.test/run/130#artifacts
Recovery: see the failed run/artifact above; runner/formatter failure, not a baseline movement.
EOF
assert_file_equals "$missing_dir/expected.md" "$missing_dir/lint-ratchet-report.md" \
  "missing diagnostics should create the fallback report"
assert_file_equals "$missing_dir/expected.md" "$missing_dir/step-summary.md" \
  "missing diagnostics should append the fallback to the step summary"

empty_dir="$TMP_ROOT/lint-empty"
mkdir -p "$empty_dir/.musi-ci-verify-logs"
touch "$empty_dir/.musi-ci-verify-logs/ratchet-diagnostics.json"
(
  cd "$empty_dir"
  GITHUB_STEP_SUMMARY="$empty_dir/step-summary.md" \
    LINT_RATCHET_ARTIFACT_URL="https://example.test/run/130#artifacts" \
    bash "$REPO_ROOT/scripts/ci/lint-ratchet-summary.sh"
)
assert_file_equals "$missing_dir/expected.md" "$empty_dir/lint-ratchet-report.md" \
  "empty diagnostics should create the fallback report"
assert_file_equals "$missing_dir/expected.md" "$empty_dir/step-summary.md" \
  "empty diagnostics should append the fallback to the step summary"

formatter_dir="$TMP_ROOT/lint-formatter-failure"
mkdir -p "$formatter_dir/.musi-ci-verify-logs"
printf '%s\n' '{"diagnostics":true}' > "$formatter_dir/.musi-ci-verify-logs/ratchet-diagnostics.json"
(
  cd "$formatter_dir"
  PATH="$TMP_ROOT/bin:$PATH" \
    GITHUB_STEP_SUMMARY="$formatter_dir/step-summary.md" \
    LINT_RATCHET_ARTIFACT_URL="https://example.test/run/130#artifacts" \
    bash "$REPO_ROOT/scripts/ci/lint-ratchet-summary.sh"
)
cat > "$formatter_dir/expected.md" <<'EOF'
<!-- lint-ratchet-summary -->
### Lint ratchet

Lint ratchet diagnostics envelope was produced, but the report formatter failed.

Formatter output:

    formatter stdout with ``` inside
    formatter stderr

Artifact: https://example.test/run/130#artifacts
Recovery: see the failed run/artifact above; runner/formatter failure, not a baseline movement.
EOF
assert_file_equals "$formatter_dir/expected.md" "$formatter_dir/lint-ratchet-report.md" \
  "formatter failure output should be indented so triple-backticks cannot escape"
assert_file_equals "$formatter_dir/expected.md" "$formatter_dir/step-summary.md" \
  "formatter failure fallback should be appended to the step summary"

cat > "$TMP_ROOT/bin/gh" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "api" ] && [ "$2" = "--paginate" ]; then
  if [ "$#" -ne 5 ] || \
    [ "$3" != "repos/example/musi/issues/130/comments" ] || \
    [ "$4" != "--jq" ] || \
    [ "$5" != '.[] | select(.body | contains("<!-- lint-ratchet-summary -->")) | .id' ]; then
    printf '%s\n' "unexpected paginated comment lookup: $*" >&2
    exit 64
  fi
  printf '%b' "${GH_FAKE_MATCHING_IDS:-}"
  exit "${GH_FAKE_LIST_STATUS:-0}"
fi
printf '%s\n' "$*" >> "$GH_CALL_LOG"
exit "${GH_FAKE_WRITE_STATUS:-0}"
EOF
chmod +x "$TMP_ROOT/bin/gh"

sticky_dir="$TMP_ROOT/sticky"
mkdir -p "$sticky_dir"
printf '%s\n' 'report body' > "$sticky_dir/lint-ratchet-report.md"
(
  cd "$sticky_dir"
  PATH="$TMP_ROOT/bin:$PATH" \
    GH_CALL_LOG="$sticky_dir/patch.log" \
    GH_FAKE_MATCHING_IDS=$'\n\n4242\n5353\n' \
    GH_TOKEN=test-token \
    PR_NUMBER=130 \
    GITHUB_REPOSITORY=example/musi \
    LINT_RATCHET_COMMENT_MARKER='<!-- lint-ratchet-summary -->' \
    bash "$REPO_ROOT/scripts/ci/sticky-pr-comment.sh"
)
cat > "$sticky_dir/expected-patch.log" <<'EOF'
api repos/example/musi/issues/comments/4242 --method PATCH --field body=@lint-ratchet-report.md
EOF
assert_file_equals "$sticky_dir/expected-patch.log" "$sticky_dir/patch.log" \
  "paginated blank lines and multiple matches should PATCH the first real comment id"

(
  cd "$sticky_dir"
  PATH="$TMP_ROOT/bin:$PATH" \
    GH_CALL_LOG="$sticky_dir/create.log" \
    GH_FAKE_MATCHING_IDS='' \
    GH_TOKEN=test-token \
    PR_NUMBER=130 \
    GITHUB_REPOSITORY=example/musi \
    LINT_RATCHET_COMMENT_MARKER='<!-- lint-ratchet-summary -->' \
    bash "$REPO_ROOT/scripts/ci/sticky-pr-comment.sh"
)
cat > "$sticky_dir/expected-create.log" <<'EOF'
pr comment 130 --body-file lint-ratchet-report.md
EOF
assert_file_equals "$sticky_dir/expected-create.log" "$sticky_dir/create.log" \
  "a missing marker comment should create a PR comment"

if sticky_error=$(
  cd "$sticky_dir"
  PATH="$TMP_ROOT/bin:$PATH" \
    GH_CALL_LOG="$sticky_dir/missing-input.log" \
    GH_TOKEN=test-token \
    GITHUB_REPOSITORY=example/musi \
    LINT_RATCHET_COMMENT_MARKER='<!-- lint-ratchet-summary -->' \
    bash "$REPO_ROOT/scripts/ci/sticky-pr-comment.sh" 2>&1
); then
  fail "sticky comment should reject a missing PR_NUMBER"
fi
printf '%s\n' "$sticky_error" > "$sticky_dir/missing-input.stderr"
assert_contains "$sticky_dir/missing-input.stderr" "PR_NUMBER" \
  "required-input failure should name PR_NUMBER"

slow_absent_dir="$TMP_ROOT/slow-absent"
mkdir -p "$slow_absent_dir"
(
  cd "$slow_absent_dir"
  GITHUB_STEP_SUMMARY="$slow_absent_dir/step-summary.md" \
    bash "$REPO_ROOT/scripts/ci/slow-drift-summary.sh"
)
cat > "$slow_absent_dir/expected.md" <<'EOF'
### Slow drift audit

No fused report was produced. Check the producer-output artifact for tool or setup errors.
EOF
assert_file_equals "$slow_absent_dir/expected.md" "$slow_absent_dir/step-summary.md" \
  "absent slow-drift files should emit only the report fallback"

slow_mixed_dir="$TMP_ROOT/slow-mixed"
mkdir -p "$slow_mixed_dir/reports/slow-drift/fused"
printf '%s\n' 'timing: typecheck 34' > "$slow_mixed_dir/reports/slow-drift/fused/timings.txt"
printf '%s\n' 'survivor mixed' > "$slow_mixed_dir/reports/slow-drift/fused/mutation-survivors.txt"
(
  cd "$slow_mixed_dir"
  GITHUB_STEP_SUMMARY="$slow_mixed_dir/step-summary.md" \
    bash "$REPO_ROOT/scripts/ci/slow-drift-summary.sh"
)
cat > "$slow_mixed_dir/expected.md" <<'EOF'
### Slow drift audit

No fused report was produced. Check the producer-output artifact for tool or setup errors.

#### Step timings (trend evidence, report-only)

```
timing: typecheck 34
```

#### Mutation survivors (trend evidence, report-only)

```
survivor mixed
```
EOF
assert_file_equals "$slow_mixed_dir/expected.md" "$slow_mixed_dir/step-summary.md" \
  "slow-drift timings and survivors should be included independently of the report"

slow_present_dir="$TMP_ROOT/slow-present"
mkdir -p "$slow_present_dir/reports/slow-drift/fused"
printf '%s\n' 'fused report body' > "$slow_present_dir/reports/slow-drift/fused/harness-audit.txt"
printf '%s\n' 'ignored' 'timing: lint 12' > "$slow_present_dir/reports/slow-drift/fused/timings.txt"
printf '%s\n' 'survivor one' > "$slow_present_dir/reports/slow-drift/fused/mutation-survivors.txt"
(
  cd "$slow_present_dir"
  GITHUB_STEP_SUMMARY="$slow_present_dir/step-summary.md" \
    bash "$REPO_ROOT/scripts/ci/slow-drift-summary.sh"
)
cat > "$slow_present_dir/expected.md" <<'EOF'
### Slow drift audit

fused report body

#### Step timings (trend evidence, report-only)

```
timing: lint 12
```

#### Mutation survivors (trend evidence, report-only)

```
survivor one
```
EOF
assert_file_equals "$slow_present_dir/expected.md" "$slow_present_dir/step-summary.md" \
  "present slow-drift files should assemble all three sections"

echo "ci-reporting smoke OK"
