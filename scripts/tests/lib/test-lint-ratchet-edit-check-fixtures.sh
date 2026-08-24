#!/usr/bin/env bash
# Focused edit-check fixture family for scripts/tests/test-lint-ratchet.sh.
#
# This helper is sourced by the aggregate after it defines TMP_ROOT, fail, and
# the shared lint-ratchet fixture builders. Run the aggregate smoke instead of
# executing this file directly.

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  printf 'Run this helper through bash scripts/tests/test-lint-ratchet.sh\n' >&2
  exit 2
fi

# shellcheck source=scripts/ai-hooks/edit-check-protocol.sh
. "$REPO_ROOT/scripts/ai-hooks/edit-check-protocol.sh"

run_edit_check_targets() {
  local dir=$1
  shift
  (cd "$dir" && bun run scripts/lint-ratchet.ts --edit-check-targets "$@" \
    >"$TMP_ROOT/edit-targets.txt" 2>"$TMP_ROOT/edit-targets.err") \
    || fail "edit-check-targets failed: $(cat "$TMP_ROOT/edit-targets.err")"
}

run_edit_check() {
  local dir=$1
  shift
  run_edit_check_targets "$dir" "$@"
  (cd "$dir" && bun run scripts/lint-ratchet.ts --edit-check \
    --targets-file "$TMP_ROOT/edit-targets.txt" \
    >"$TMP_ROOT/edit-regress.txt" 2>"$TMP_ROOT/edit-regress.err") \
    || fail "edit-check failed: $(cat "$TMP_ROOT/edit-regress.err")"
}

# Run --edit-check against a hand-written target-file body (bypassing discovery)
# so the smoke can exercise the decoder's arity / ruleId-registry validation.
run_edit_check_with_targets_file() {
  local dir=$1
  local content=$2
  printf '%s\n' "$content" > "$TMP_ROOT/edit-targets.txt"
  (cd "$dir" && bun run scripts/lint-ratchet.ts --edit-check \
    --targets-file "$TMP_ROOT/edit-targets.txt" \
    >"$TMP_ROOT/edit-regress.txt" 2>"$TMP_ROOT/edit-regress.err") \
    || fail "edit-check (hand-written targets) failed: $(cat "$TMP_ROOT/edit-regress.err")"
}

run_edit_ratchet_coverage() {
  local dir=$1
  shift
  (cd "$dir" && bun run scripts/lint-ratchet.ts --edit-ratchet-coverage "$@" \
    >"$TMP_ROOT/edit-coverage.txt" 2>"$TMP_ROOT/edit-coverage.err") \
    || fail "edit-ratchet-coverage failed: $(cat "$TMP_ROOT/edit-coverage.err")"
}

assert_protocol_rows() {
  local file=$1
  local expected_kind=$2
  local expected_count=$3
  local label=$4
  local row kind field_count
  while IFS= read -r row; do
    [ -n "$row" ] || continue
    kind="${row%%$'\t'*}"
    field_count=$(awk -F '\t' '{ print NF; exit }' <<< "$row")
    [ "$kind" = "$expected_kind" ] \
      || fail "$label emitted kind '$kind', expected '$expected_kind': $row"
    [ "$field_count" -eq "$expected_count" ] \
      || fail "$label emitted $field_count fields, expected $expected_count: $row"
  done < "$file"
}

assert_edit_check_result_rows() {
  local file=$1
  local row kind field_count expected_count
  while IFS= read -r row; do
    [ -n "$row" ] || continue
    kind="${row%%$'\t'*}"
    field_count=$(awk -F '\t' '{ print NF; exit }' <<< "$row")
    case "$kind" in
      "$EDIT_CHECK_CHECKED_KIND") expected_count=$EDIT_CHECK_CHECKED_FIELD_COUNT ;;
      "$EDIT_CHECK_REGRESSION_KIND") expected_count=$EDIT_CHECK_REGRESSION_FIELD_COUNT ;;
      *) fail "edit-check emitted unknown row kind '$kind': $row" ;;
    esac
    [ "$field_count" -eq "$expected_count" ] \
      || fail "edit-check $kind row emitted $field_count fields, expected $expected_count: $row"
  done < "$file"
}

run_lint_ratchet_edit_check_fixtures() {
  local EDIT_CHECK_BAD_BASELINE_DIR
  local EDIT_CHECK_DIR
  local EDIT_CHECK_DRIFT_DIR
  local EDIT_CHECK_DRIFT_IDENTITY_AFTER
  local EDIT_CHECK_DRIFT_IDENTITY_BEFORE
  local EDIT_CHECK_PROTOCOL_DIR
  local EDIT_CHECK_TA_DIR
  local protocol_path
  local protocol_rule_id
  local protocol_test_id

  # --- Fixture: edit-time check (--edit-check-targets / --edit-check) ----------
  # Discovery lists matching minimal-TS ratchets without running ESLint; the
  # two-step --edit-check then lints only the listed targets and prints fresh
  # ratchet regressions. Type-aware ratchets are excluded from discovery,
  # improvements are never reported, and baseline/hash drift soft-skips rather
  # than inventing a regression.
  EDIT_CHECK_DIR="$TMP_ROOT/edit-check"
  build_fixture "$EDIT_CHECK_DIR"
  write_type_assertion_config "$EDIT_CHECK_DIR"
  write_violation_source "$EDIT_CHECK_DIR"
  run_fixture_update "$EDIT_CHECK_DIR" || fail "edit-check fixture update failed: $(cat "$TMP_ROOT/update.err")"

  # (1) Discovery lists the matching minimal-TS ratchet; an unchanged file at its
  # committed floor produces no regression row.
  run_edit_check "$EDIT_CHECK_DIR" "packages/app/src/example.ts"
  assert_protocol_rows \
    "$TMP_ROOT/edit-targets.txt" "$EDIT_CHECK_TARGET_KIND" "$EDIT_CHECK_TARGET_FIELD_COUNT" \
    "edit-check-targets"
  assert_edit_check_result_rows "$TMP_ROOT/edit-regress.txt"
  grep -qF $'target\tpackages/app/src/example.ts\tratchet/local-type-assertion-boundary\tlocal/type-assertion-boundary' \
    "$TMP_ROOT/edit-targets.txt" \
    || fail "edit-check discovery missing target row: $(cat "$TMP_ROOT/edit-targets.txt")"
  if grep -q '^regression' "$TMP_ROOT/edit-regress.txt"; then
    fail "edit-check should emit no regression for an unchanged file at its floor: $(cat "$TMP_ROOT/edit-regress.txt")"
  fi
  # A clean lint still emits a positive `checked` row, distinguishing a real
  # no-regression result from a soft skip that never ran ESLint.
  grep -qF $'checked\tpackages/app/src/example.ts' "$TMP_ROOT/edit-regress.txt" \
    || fail "edit-check should emit a checked row for a clean unchanged file: $(cat "$TMP_ROOT/edit-regress.txt")"

  # The coverage emitter is the fourth protocol producer and must satisfy the
  # same generated kind/count contract as the edit-check exchange.
  run_edit_ratchet_coverage "$EDIT_CHECK_DIR" "packages/app/src/example.ts"
  [ -s "$TMP_ROOT/edit-coverage.txt" ] \
    || fail "edit-ratchet-coverage should emit a row for a ratcheted path"
  assert_protocol_rows \
    "$TMP_ROOT/edit-coverage.txt" "$EDIT_CHECK_RATCHET_COVERED_KIND" \
    "$EDIT_CHECK_RATCHET_COVERED_FIELD_COUNT" "edit-ratchet-coverage"

  # (2) No discovery output when no minimal-TS ratchet matches the edited path.
  (cd "$EDIT_CHECK_DIR" && bun run scripts/lint-ratchet.ts --edit-check-targets "README.md" \
    >"$TMP_ROOT/edit-nomatch.txt" 2>"$TMP_ROOT/edit-nomatch.err") \
    || fail "edit-check-targets non-matching run failed: $(cat "$TMP_ROOT/edit-nomatch.err")"
  [ ! -s "$TMP_ROOT/edit-nomatch.txt" ] \
    || fail "edit-check discovery should be empty for a non-matching path: $(cat "$TMP_ROOT/edit-nomatch.txt")"

  # (3) Fresh new-path regression on a drained baseline path.
  cat > "$EDIT_CHECK_DIR/packages/app/src/fresh.ts" <<'TS'
const rawFresh = {};
export const freshValue = rawFresh as { value: number };
TS
  run_edit_check "$EDIT_CHECK_DIR" "packages/app/src/fresh.ts"
  assert_edit_check_result_rows "$TMP_ROOT/edit-regress.txt"
  grep -qF $'regression\tpackages/app/src/fresh.ts\tratchet/local-type-assertion-boundary\tlocal/type-assertion-boundary\tnew-path' \
    "$TMP_ROOT/edit-regress.txt" \
    || fail "edit-check missing fresh new-path regression: $(cat "$TMP_ROOT/edit-regress.txt")"
  rm -f "$EDIT_CHECK_DIR/packages/app/src/fresh.ts"

  # (4) Worsening output for a file that already carries a committed baseline item.
  cat > "$EDIT_CHECK_DIR/packages/app/src/example.ts" <<'TS'
const rawA = {};
export const valueA = rawA as { value: number };
const rawB = {};
export const valueB = rawB as { value: number };
TS
  run_edit_check "$EDIT_CHECK_DIR" "packages/app/src/example.ts"
  grep -qF $'regression\tpackages/app/src/example.ts\tratchet/local-type-assertion-boundary\tlocal/type-assertion-boundary\tincreased-count' \
    "$TMP_ROOT/edit-regress.txt" \
    || fail "edit-check missing increased-count regression: $(cat "$TMP_ROOT/edit-regress.txt")"

  # (5) Improvements are intentionally omitted at edit time.
  printf 'export const cleaned = 1;\n' > "$EDIT_CHECK_DIR/packages/app/src/example.ts"
  run_edit_check "$EDIT_CHECK_DIR" "packages/app/src/example.ts"
  if grep -q '^regression' "$TMP_ROOT/edit-regress.txt"; then
    fail "edit-check should omit improvements: $(cat "$TMP_ROOT/edit-regress.txt")"
  fi

  # (6) Type-aware ratchets are skipped from edit-time discovery entirely.
  EDIT_CHECK_TA_DIR="$TMP_ROOT/edit-check-type-aware"
  build_fixture "$EDIT_CHECK_TA_DIR"
  use_fixture_node_modules_with_fake_plugin "$EDIT_CHECK_TA_DIR"
  write_fixture_tsconfig "$EDIT_CHECK_TA_DIR"
  write_clean_source "$EDIT_CHECK_TA_DIR"
  write_third_party_config "$EDIT_CHECK_TA_DIR" "no-fixture-marker" "type-aware-ts"
  run_fixture_update "$EDIT_CHECK_TA_DIR" \
    || fail "edit-check type-aware update failed: $(cat "$TMP_ROOT/update.err")"
  run_edit_check_targets "$EDIT_CHECK_TA_DIR" "packages/app/src/example.ts"
  [ ! -s "$TMP_ROOT/edit-targets.txt" ] \
    || fail "edit-check discovery must skip type-aware ratchets: $(cat "$TMP_ROOT/edit-targets.txt")"

  # (7) Baseline/rule-source hash drift soft-skips instead of reporting a false
  # regression: the file gains a second violation (which would normally worsen the
  # count) while the local rule source drifts from the committed baseline hash.
  EDIT_CHECK_DRIFT_DIR="$TMP_ROOT/edit-check-drift"
  build_fixture "$EDIT_CHECK_DRIFT_DIR"
  write_type_assertion_config "$EDIT_CHECK_DRIFT_DIR"
  write_violation_source "$EDIT_CHECK_DRIFT_DIR"
  run_fixture_update "$EDIT_CHECK_DRIFT_DIR" \
    || fail "edit-check drift update failed: $(cat "$TMP_ROOT/update.err")"
  run_edit_check_targets "$EDIT_CHECK_DRIFT_DIR" "packages/app/src/example.ts"
  EDIT_CHECK_DRIFT_IDENTITY_BEFORE=$(cat "$TMP_ROOT/edit-targets.txt")
  cat > "$EDIT_CHECK_DRIFT_DIR/packages/app/src/example.ts" <<'TS'
const rawA = {};
export const valueA = rawA as { value: number };
const rawB = {};
export const valueB = rawB as { value: number };
TS
  printf '\n// edit-check drift marker\n' >> "$EDIT_CHECK_DRIFT_DIR/eslint-rules/type-assertion-boundary.js"
  run_edit_check "$EDIT_CHECK_DRIFT_DIR" "packages/app/src/example.ts"
  grep -qF $'target\tpackages/app/src/example.ts\tratchet/local-type-assertion-boundary' \
    "$TMP_ROOT/edit-targets.txt" \
    || fail "edit-check drift discovery should still list the target: $(cat "$TMP_ROOT/edit-targets.txt")"
  EDIT_CHECK_DRIFT_IDENTITY_AFTER=$(cat "$TMP_ROOT/edit-targets.txt")
  [ "$(awk -F '\t' '{ print NF; exit }' "$TMP_ROOT/edit-targets.txt")" -eq 5 ] \
    || fail "edit-check discovery should include a cache identity column: $(cat "$TMP_ROOT/edit-targets.txt")"
  [ "$EDIT_CHECK_DRIFT_IDENTITY_BEFORE" != "$EDIT_CHECK_DRIFT_IDENTITY_AFTER" ] \
    || fail "edit-check cache identity should change when rule-source hash drifts"
  if grep -q '^regression' "$TMP_ROOT/edit-regress.txt"; then
    fail "edit-check should soft-skip on hash drift, not report a regression: $(cat "$TMP_ROOT/edit-regress.txt")"
  fi
  # A soft skip never lints the drifted ratchet, so there is no `checked` row
  # either - distinguishing it from a genuine clean lint.
  if grep -q '^checked' "$TMP_ROOT/edit-regress.txt"; then
    fail "edit-check hash drift should not lint (no checked row): $(cat "$TMP_ROOT/edit-regress.txt")"
  fi

  # (8) A structurally valid but metric-invalid baseline test also soft-skips.
  # Discovery is still registry/glob based, but edit-check must not trust an
  # effective-line-count item after its metric payload has been corrupted.
  EDIT_CHECK_BAD_BASELINE_DIR="$TMP_ROOT/edit-check-bad-baseline"
  build_fixture "$EDIT_CHECK_BAD_BASELINE_DIR"
  write_max_lines_config "$EDIT_CHECK_BAD_BASELINE_DIR"
  write_max_lines_source "$EDIT_CHECK_BAD_BASELINE_DIR" 4
  run_fixture_update "$EDIT_CHECK_BAD_BASELINE_DIR" \
    || fail "edit-check bad-baseline update failed: $(cat "$TMP_ROOT/update.err")"
  BASELINE_FILE="$EDIT_CHECK_BAD_BASELINE_DIR/lint-ratchet.baseline.json" bun -e '
    const fs = require("fs");
    const assertionFailed = (message) => { console.error(message); process.exit(1); };
    const path = process.env.BASELINE_FILE;
    const parsed = JSON.parse(fs.readFileSync(path, "utf8"));
    const item = parsed.tests["ratchet/fixture-max-lines"].items["packages/app/src/example.ts"];
    if (item === undefined) assertionFailed("missing max-lines baseline item");
    delete item.lines;
    fs.writeFileSync(path, `${JSON.stringify(parsed, null, 2)}\n`);
  ' || fail "edit-check bad-baseline corruption failed"
  run_edit_check "$EDIT_CHECK_BAD_BASELINE_DIR" "packages/app/src/example.ts"
  grep -qF $'target\tpackages/app/src/example.ts\tratchet/fixture-max-lines\tlocal/max-lines' \
    "$TMP_ROOT/edit-targets.txt" \
    || fail "edit-check bad-baseline discovery should still list the target: $(cat "$TMP_ROOT/edit-targets.txt")"
  if grep -q '^regression' "$TMP_ROOT/edit-regress.txt"; then
    fail "edit-check bad-baseline should not report a regression: $(cat "$TMP_ROOT/edit-regress.txt")"
  fi
  if grep -q '^checked' "$TMP_ROOT/edit-regress.txt"; then
    fail "edit-check bad-baseline should not lint (no checked row): $(cat "$TMP_ROOT/edit-regress.txt")"
  fi

  # (9) Hand-written target files exercise the --edit-check wire decoder directly.
  # A row with the wrong arity, or a valid testId paired with a ruleId that does
  # not match the registry ratchet, is soft-skipped: it never runs ESLint and
  # never emits a `checked` row. An otherwise-valid row with an empty
  # cache-identity column still lints, proving the skips above are the validation
  # at work rather than a broken fixture.
  EDIT_CHECK_PROTOCOL_DIR="$TMP_ROOT/edit-check-protocol"
  build_fixture "$EDIT_CHECK_PROTOCOL_DIR"
  write_type_assertion_config "$EDIT_CHECK_PROTOCOL_DIR"
  write_violation_source "$EDIT_CHECK_PROTOCOL_DIR"
  run_fixture_update "$EDIT_CHECK_PROTOCOL_DIR" \
    || fail "edit-check protocol update failed: $(cat "$TMP_ROOT/update.err")"
  protocol_path="packages/app/src/example.ts"
  protocol_test_id="ratchet/local-type-assertion-boundary"
  protocol_rule_id="local/type-assertion-boundary"

  # (9a) Wrong arity (missing cache-identity column) -> soft-skip, never linted.
  run_edit_check_with_targets_file "$EDIT_CHECK_PROTOCOL_DIR" \
    "$(printf 'target\t%s\t%s\t%s' "$protocol_path" "$protocol_test_id" "$protocol_rule_id")"
  if grep -qE '^(checked|regression)' "$TMP_ROOT/edit-regress.txt"; then
    fail "edit-check should soft-skip a wrong-arity target row: $(cat "$TMP_ROOT/edit-regress.txt")"
  fi

  # (9b) Valid arity but a ruleId that does not match the registry ratchet for the
  # testId -> soft-skip, never linted.
  run_edit_check_with_targets_file "$EDIT_CHECK_PROTOCOL_DIR" \
    "$(printf 'target\t%s\t%s\t%s\t%s' "$protocol_path" "$protocol_test_id" "local/not-the-real-rule" "sha256:x")"
  if grep -qE '^(checked|regression)' "$TMP_ROOT/edit-regress.txt"; then
    fail "edit-check should soft-skip a mismatched-ruleId target row: $(cat "$TMP_ROOT/edit-regress.txt")"
  fi

  # (9c) Control: a well-formed row with an empty cache-identity column still
  # lints the file and emits a positive `checked` row with no regression at floor.
  run_edit_check_with_targets_file "$EDIT_CHECK_PROTOCOL_DIR" \
    "$(printf 'target\t%s\t%s\t%s\t' "$protocol_path" "$protocol_test_id" "$protocol_rule_id")"
  grep -qF $'checked\tpackages/app/src/example.ts' "$TMP_ROOT/edit-regress.txt" \
    || fail "edit-check should lint a valid hand-written target row: $(cat "$TMP_ROOT/edit-regress.txt")"
  if grep -q '^regression' "$TMP_ROOT/edit-regress.txt"; then
    fail "edit-check control row should not report a regression: $(cat "$TMP_ROOT/edit-regress.txt")"
  fi
}
