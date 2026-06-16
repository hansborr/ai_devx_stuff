#!/usr/bin/env bash
# Smoke test for scripts/generate-lint-guidance.ts.
#
# Contract:
# - fixture rendering matches the checked-in golden;
# - invalid rule metadata fails before emission with field-specific diagnostics;
# - the real-tree freshness check rejects generated-doc drift.
set -euo pipefail

cd "$(dirname "$0")/../.."

TMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/leaf25-fixture-XXXXXX")
GENERATED=docs/generated/local-lint-rules.md
GOLDEN=scripts/fixtures/generate-lint-guidance/expected.md
ORIGINAL_GENERATED=

cleanup() {
  if [[ -n "$ORIGINAL_GENERATED" && -f "$ORIGINAL_GENERATED" ]]; then
    mv "$ORIGINAL_GENERATED" "$GENERATED"
  fi
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

copy_generator() {
  local fixture_dir=$1
  mkdir -p "$fixture_dir/scripts" "$fixture_dir/scripts/lib"
  cp scripts/generate-lint-guidance.ts "$fixture_dir/scripts/generate-lint-guidance.ts"
  cp scripts/lib/lint-rule-docs.ts "$fixture_dir/scripts/lib/lint-rule-docs.ts"
  cp scripts/lib/doc-generator.ts "$fixture_dir/scripts/lib/doc-generator.ts"
}

write_valid_fixture() {
  local fixture_dir=$1
  mkdir -p "$fixture_dir/docs/guides"
  printf '# Local ESLint Rules Fixture\n' >"$fixture_dir/docs/guides/local-eslint-rules.md"
  copy_generator "$fixture_dir"
  cat >"$fixture_dir/local-plugin.js" <<'JS'
const makeRule = (docs) => ({
  meta: {
    type: "problem",
    docs,
    messages: { default: "fixture diagnostic" },
    schema: [],
  },
  create() {
    return {};
  },
});

export default {
  rules: {
    "category-maintainability": makeRule({
      description: "Category maintainability fixture rule",
      principle: "Maintainability fixture principle.",
      category: "maintainability",
      pairedGuide: "none",
      repairKind: "manual",
    }),
    "category-architecture-fitness": makeRule({
      description: "Category architecture fixture rule",
      principle: "Architecture fixture principle.",
      category: "architecture-fitness",
      pairedGuide: "docs/guides/local-eslint-rules.md",
      repairKind: "manual",
    }),
    "category-behavior": makeRule({
      description: "Category behavior fixture rule",
      principle: "Behavior fixture principle.",
      category: "behavior",
      pairedGuide: "docs/guides/local-eslint-rules.md",
      repairKind: "manual",
    }),
    "repair-autofix": makeRule({
      description: "Autofix repair fixture rule",
      principle: "Autofix fixture principle.",
      category: "maintainability",
      pairedGuide: "docs/guides/local-eslint-rules.md",
      repairKind: "autofix",
    }),
    "repair-suggestion": makeRule({
      description: "Suggestion repair fixture rule",
      principle: "Suggestion fixture principle.",
      category: "architecture-fitness",
      pairedGuide: "docs/guides/local-eslint-rules.md",
      repairKind: "suggestion",
    }),
    "repair-codemod": makeRule({
      description: "Codemod repair fixture rule",
      principle: "Codemod fixture principle.",
      category: "behavior",
      pairedGuide: "docs/guides/local-eslint-rules.md",
      repairKind: "codemod",
      repairCommand: "bun run codemod:fixture",
    }),
    "repair-manual": makeRule({
      description: "Manual repair fixture rule",
      principle: "Manual fixture principle.",
      category: "behavior",
      pairedGuide: "none",
      repairKind: "manual",
    }),
  },
};
JS
  cat >"$fixture_dir/eslint.config.js" <<'JS'
import local from "./local-plugin.js";

export default [{ plugins: { local } }];
JS
}

write_failure_fixture() {
  local fixture_dir=$1
  local docs_body=$2
  mkdir -p "$fixture_dir/docs/guides"
  printf '# Local ESLint Rules Fixture\n' >"$fixture_dir/docs/guides/local-eslint-rules.md"
  copy_generator "$fixture_dir"
  cat >"$fixture_dir/local-plugin.js" <<JS
const rule = {
  meta: {
    type: "problem",
    docs: {
$docs_body
    },
    messages: { default: "fixture diagnostic" },
    schema: [],
  },
  create() {
    return {};
  },
};

export default { rules: { invalid: rule } };
JS
  cat >"$fixture_dir/eslint.config.js" <<'JS'
import local from "./local-plugin.js";

export default [{ plugins: { local } }];
JS
}

run_fixture_render_check() {
  local fixture_dir="$TMP_ROOT/render"
  write_valid_fixture "$fixture_dir"

  (cd "$fixture_dir" && bun run scripts/generate-lint-guidance.ts >"$TMP_ROOT/render.out" 2>"$TMP_ROOT/render.err")
  local actual="$fixture_dir/docs/generated/local-lint-rules.md"

  if [[ ! -f "$GOLDEN" ]]; then
    mkdir -p "$(dirname "$GOLDEN")"
    cp "$actual" "$GOLDEN"
    echo "Wrote missing golden $GOLDEN. Commit it and rerun this smoke."
    exit 1
  fi

  if ! diff -u "$GOLDEN" "$actual"; then
    echo "FAIL: fixture markdown differs from $GOLDEN"
    exit 1
  fi
}

run_failure_case() {
  local name=$1
  local keyword=$2
  local docs_body=$3
  local fixture_dir="$TMP_ROOT/failure-$name"
  local stderr_path="$TMP_ROOT/failure-$name.err"

  write_failure_fixture "$fixture_dir" "$docs_body"

  if (cd "$fixture_dir" && bun run scripts/generate-lint-guidance.ts >"$TMP_ROOT/failure-$name.out" 2>"$stderr_path"); then
    echo "FAIL: invalid fixture $name unexpectedly passed"
    exit 1
  fi

  if ! grep -q "$keyword" "$stderr_path"; then
    echo "FAIL: invalid fixture $name stderr did not mention $keyword"
    cat "$stderr_path"
    exit 1
  fi
}

run_failure_checks() {
  run_failure_case "missing-description" "description" '      principle: "Fixture principle.",
      category: "maintainability",
      pairedGuide: "none",
      repairKind: "manual",'
  run_failure_case "missing-principle" "principle" '      description: "Fixture description.",
      category: "maintainability",
      pairedGuide: "none",
      repairKind: "manual",'
  run_failure_case "invalid-category" "category" '      description: "Fixture description.",
      principle: "Fixture principle.",
      category: "quality",
      pairedGuide: "none",
      repairKind: "manual",'
  run_failure_case "missing-paired-guide" "pairedGuide" '      description: "Fixture description.",
      principle: "Fixture principle.",
      category: "maintainability",
      repairKind: "manual",'
  run_failure_case "nonexistent-paired-guide" "pairedGuide" '      description: "Fixture description.",
      principle: "Fixture principle.",
      category: "maintainability",
      pairedGuide: "docs/guides/missing.md",
      repairKind: "manual",'
  run_failure_case "invalid-repair-kind" "repairKind" '      description: "Fixture description.",
      principle: "Fixture principle.",
      category: "maintainability",
      pairedGuide: "none",
      repairKind: "automatic",'
  run_failure_case "codemod-without-command" "repairCommand" '      description: "Fixture description.",
      principle: "Fixture principle.",
      category: "maintainability",
      pairedGuide: "none",
      repairKind: "codemod",'
  run_failure_case "manual-with-command" "repairCommand" '      description: "Fixture description.",
      principle: "Fixture principle.",
      category: "maintainability",
      pairedGuide: "none",
      repairKind: "manual",
      repairCommand: "bun run codemod:fixture",'
}

run_real_tree_drift_check() {
  # Regenerate to a clean baseline so the test is deterministic.
  bun run docs:lint-guidance >"$TMP_ROOT/real-gen.out" 2>&1
  test -s "$GENERATED"

  # In-sync state: --check passes and reports up-to-date.
  bun run docs:lint-guidance:check >"$TMP_ROOT/real-check-clean.out" 2>&1
  grep -q "up to date" "$TMP_ROOT/real-check-clean.out"

  # Drift state: append a stray line and assert --check exits non-zero.
  ORIGINAL_GENERATED="$TMP_ROOT/original-local-lint-rules.md"
  cp "$GENERATED" "$ORIGINAL_GENERATED"
  printf '\nstale\n' >>"$GENERATED"

  if bun run docs:lint-guidance:check >"$TMP_ROOT/real-check-drift.out" 2>&1; then
    echo "FAIL: --check accepted mutated $GENERATED"
    cat "$TMP_ROOT/real-check-drift.out"
    exit 1
  fi

  mv "$ORIGINAL_GENERATED" "$GENERATED"
  ORIGINAL_GENERATED=
}

run_fixture_render_check
run_failure_checks
run_real_tree_drift_check

echo "PASS: generate-lint-guidance smoke"
