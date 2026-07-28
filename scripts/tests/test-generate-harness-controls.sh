#!/usr/bin/env bash
# smoke-order: 310
# smoke-subjects: scripts/harness/control-field-validation.ts
# smoke-subjects: scripts/harness/generate-harness-controls.ts
# smoke-subjects: scripts/harness/generate-harness-controls-validation.ts
# smoke-subjects: scripts/harness/harness-manifest.ts
# smoke-subjects: scripts/harness/harness-manifest-schema.ts
# smoke-subjects: scripts/harness/harness-paths.ts
# smoke-subjects: scripts/harness/hook-wiring-schema.ts
# smoke-subjects: scripts/harness/verify-step-schema.ts
# smoke-subjects: scripts/lib/codepoint-compare.ts
# smoke-subjects: scripts/lib/lint-rule-docs.ts
# smoke-subjects: scripts/lib/records.ts
# smoke-subjects: tools/lint-ratchet/src/kernel/codepoint-compare.ts
# smoke-subjects: scripts/tests/test-generate-harness-controls.sh
# smoke-subjects: scripts/fixtures/generate-harness-controls/
# smoke-subjects: harness.controls.json
# smoke-subjects: docs/generated/harness-controls.md
# smoke-subjects: eslint.config.js
# smoke-subjects: eslint-config/
# smoke-subjects: eslint-rules/
# smoke-subjects: package.json
# smoke-subjects: tsconfig.scripts.json
# smoke-subjects: scripts/lib/doc-generator.ts
# Smoke test for scripts/harness/generate-harness-controls.ts.
#
# Contract:
# - fixture rendering (one control per kind) matches the checked-in golden;
# - invalid manifest entries fail before emission with field-specific diagnostics;
# - the real-tree freshness check rejects generated-doc drift.
set -euo pipefail

cd "$(dirname "$0")/../.."

TMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/harness-controls-fixture-XXXXXX")
GENERATED=docs/generated/harness-controls.md
GOLDEN=scripts/fixtures/generate-harness-controls/expected.md
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
  mkdir -p "$fixture_dir/scripts/harness" "$fixture_dir/scripts/lib" "$fixture_dir/scripts/lint-ratchet"
  cp scripts/harness/control-field-validation.ts "$fixture_dir/scripts/harness/control-field-validation.ts"
  cp scripts/harness/generate-harness-controls.ts "$fixture_dir/scripts/harness/generate-harness-controls.ts"
  cp scripts/harness/generate-harness-controls-validation.ts "$fixture_dir/scripts/harness/generate-harness-controls-validation.ts"
  cp scripts/harness/harness-paths.ts "$fixture_dir/scripts/harness/harness-paths.ts"
  cp scripts/harness/harness-manifest.ts "$fixture_dir/scripts/harness/harness-manifest.ts"
  cp scripts/harness/harness-manifest-schema.ts "$fixture_dir/scripts/harness/harness-manifest-schema.ts"
  cp scripts/harness/hook-wiring-schema.ts "$fixture_dir/scripts/harness/hook-wiring-schema.ts"
  cp scripts/lib/lint-rule-docs.ts "$fixture_dir/scripts/lib/lint-rule-docs.ts"
  cp scripts/lib/doc-generator.ts "$fixture_dir/scripts/lib/doc-generator.ts"
  # The generator, the manifest reader, and both schemas narrow untyped JSON
  # through the shared record guards in scripts/lib/records.ts, so the sandbox
  # closure needs that leaf too.
  cp scripts/lib/records.ts "$fixture_dir/scripts/lib/records.ts"
  cp scripts/harness/verify-step-schema.ts "$fixture_dir/scripts/harness/verify-step-schema.ts"
  # The generator and verify-step-schema sort via compareByCodepoint from the
  # scripts/lib/codepoint-compare shim, which re-exports the
  # @musi/lint-ratchet kernel comparator; the fixture copies the shim and the
  # scoped node_modules symlink below resolves the package side.
  cp scripts/lib/codepoint-compare.ts "$fixture_dir/scripts/lib/codepoint-compare.ts"
  # @musi/lint-ratchet engine moved to the package (leaf 02 S3); the copied
  # adapter/generators import it, so resolve it via a scoped node_modules
  # symlink instead of copying the moved leaf file.
  mkdir -p "$fixture_dir/node_modules/@musi"
  [ -e "$fixture_dir/node_modules/@musi/lint-ratchet" ] || ln -s "$PWD/tools/lint-ratchet" "$fixture_dir/node_modules/@musi/lint-ratchet"
  # harness-manifest-schema.ts (copied above) imports zod at runtime; resolve
  # it via the same node_modules symlink pattern rather than vendoring it.
  [ -e "$fixture_dir/node_modules/zod" ] || ln -s "$PWD/node_modules/zod" "$fixture_dir/node_modules/zod"
  # Minimal ratchet registry stub: the generator re-projects ratchet principles
  # from lintRatchets (id -> principle), so the fixture supplies its own backing
  # entry for ratchet/fixture instead of copying the real registry chain.
  cat >"$fixture_dir/scripts/lint-ratchet/lint-ratchet-config.ts" <<'TS'
export const lintRatchets = [
  { id: "ratchet/fixture", principle: "Ratchet fixture principle." },
] as const;
TS
}

# Writes a minimal eslint.config.js + local-plugin.js with one rule whose
# meta.docs satisfies the lint-rule re-projection contract.
write_eslint_plugin() {
  local fixture_dir=$1
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
    "fixture-rule": makeRule({
      description: "Fixture lint rule",
      principle: "Lint rule fixture principle.",
      category: "maintainability",
      pairedGuide: "docs/guides/local-eslint-rules.md",
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

write_paired_guide() {
  local fixture_dir=$1
  mkdir -p "$fixture_dir/docs/guides"
  printf '# Local ESLint Rules Fixture\n' >"$fixture_dir/docs/guides/local-eslint-rules.md"
}

# Creates empty source files for every control entry's "source" path so the
# generator's existsSync check passes.
write_source_files() {
  local fixture_dir=$1
  local paths=(
    "eslint-rules/fixture-rule.js"
    "scripts/ratchet-fixture.ts"
    "scripts/sensor-fixture.ts"
    "scripts/fixture-verify.sh"
    "scripts/doctor-fixture.sh"
    "scripts/drift-fixture.ts"
    "scripts/generate-fixture.ts"
    "scripts/check-fixture.ts"
    "scripts/logs-fixture.ts"
    "scripts/codemods/fixture.ts"
    ".husky/fixture"
  )
  for path in "${paths[@]}"; do
    mkdir -p "$fixture_dir/$(dirname "$path")"
    : >"$fixture_dir/$path"
  done
}

write_valid_manifest() {
  local fixture_dir=$1
  cat >"$fixture_dir/harness.controls.json" <<'JSON'
{
  "controls": [
    {
      "id": "lint/local/fixture-rule",
      "kind": "lint-rule",
      "ruleName": "local/fixture-rule",
      "source": "eslint-rules/fixture-rule.js",
      "invocation": "bun run lint"
    },
    {
      "id": "ratchet/fixture",
      "kind": "ratchet",
      "category": "maintainability",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/ratchet-fixture.ts",
      "invocation": "bun run lint:ratchet"
    },
    {
      "id": "sensor/fixture",
      "kind": "sensor",
      "category": "maintainability",
      "principle": "Sensor fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/sensor-fixture.ts",
      "invocation": "bun run sensor:fixture"
    },
    {
      "id": "wrapper/fixture-verify",
      "kind": "verify-wrapper",
      "category": "maintainability",
      "principle": "Verify wrapper fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/fixture-verify.sh",
      "invocation": "bun run verify:fixture"
    },
    {
      "id": "doctor/fixture-check",
      "kind": "doctor-check",
      "category": "maintainability",
      "principle": "Doctor check fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/doctor-fixture.sh",
      "invocation": "bun run doctor"
    },
    {
      "id": "drift/fixture-scope",
      "kind": "drift-scope",
      "category": "architecture-fitness",
      "principle": "Drift scope fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/drift-fixture.ts",
      "invocation": "bun run drift:fixture"
    },
    {
      "id": "doc-generator/fixture",
      "kind": "doc-generator",
      "category": "maintainability",
      "principle": "Doc generator fixture principle.",
      "pairedGuide": "docs/guides/local-eslint-rules.md",
      "repairKind": "manual",
      "source": "scripts/generate-fixture.ts",
      "invocation": "bun run docs:fixture"
    },
    {
      "id": "check/fixture",
      "kind": "check",
      "category": "maintainability",
      "principle": "Check fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/check-fixture.ts",
      "invocation": "bun run docs:fixture:check"
    },
    {
      "id": "logs-audit/fixture",
      "kind": "logs-audit",
      "category": "behavior",
      "principle": "Logs audit fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/logs-fixture.ts",
      "invocation": "bun run logs:fixture"
    },
    {
      "id": "codemod/fixture",
      "kind": "codemod",
      "category": "maintainability",
      "principle": "Codemod fixture principle.",
      "pairedGuide": "docs/guides/local-eslint-rules.md",
      "repairKind": "codemod",
      "repairCommand": "bun run codemod:fixture",
      "source": "scripts/codemods/fixture.ts",
      "invocation": "bun run codemod:fixture"
    },
    {
      "id": "hook/fixture",
      "kind": "hook",
      "category": "maintainability",
      "principle": "Hook fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": ".husky/fixture",
      "invocation": ".husky/fixture"
    }
  ]
}
JSON
}

write_valid_fixture() {
  local fixture_dir=$1
  copy_generator "$fixture_dir"
  write_paired_guide "$fixture_dir"
  write_eslint_plugin "$fixture_dir"
  write_source_files "$fixture_dir"
  write_valid_manifest "$fixture_dir"
}

# Writes a fixture with a single manifest entry replaced by $manifest_entry
# (the rest of the valid fixture is preserved). Useful for failure cases that
# only mutate one control.
write_single_entry_failure_fixture() {
  local fixture_dir=$1
  local manifest_entry=$2
  copy_generator "$fixture_dir"
  write_paired_guide "$fixture_dir"
  write_eslint_plugin "$fixture_dir"
  write_source_files "$fixture_dir"
  cat >"$fixture_dir/harness.controls.json" <<JSON
{
  "controls": [
$manifest_entry
  ]
}
JSON
}

run_fixture_render_check() {
  local fixture_dir="$TMP_ROOT/render"
  write_valid_fixture "$fixture_dir"

  (cd "$fixture_dir" && bun run scripts/harness/generate-harness-controls.ts >"$TMP_ROOT/render.out" 2>"$TMP_ROOT/render.err")
  local actual="$fixture_dir/docs/generated/harness-controls.md"

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
  local manifest_entry=$3
  local fixture_dir="$TMP_ROOT/failure-$name"
  local stderr_path="$TMP_ROOT/failure-$name.err"

  write_single_entry_failure_fixture "$fixture_dir" "$manifest_entry"

  if (cd "$fixture_dir" && bun run scripts/harness/generate-harness-controls.ts >"$TMP_ROOT/failure-$name.out" 2>"$stderr_path"); then
    echo "FAIL: invalid fixture $name unexpectedly passed"
    exit 1
  fi

  if ! grep -q "$keyword" "$stderr_path"; then
    echo "FAIL: invalid fixture $name stderr did not mention $keyword"
    cat "$stderr_path"
    exit 1
  fi
}

run_duplicate_id_case() {
  local fixture_dir="$TMP_ROOT/failure-duplicate-id"
  local stderr_path="$TMP_ROOT/failure-duplicate-id.err"
  copy_generator "$fixture_dir"
  write_paired_guide "$fixture_dir"
  write_eslint_plugin "$fixture_dir"
  write_source_files "$fixture_dir"
  cat >"$fixture_dir/harness.controls.json" <<'JSON'
{
  "controls": [
    {
      "id": "sensor/fixture",
      "kind": "sensor",
      "category": "maintainability",
      "principle": "Sensor fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/sensor-fixture.ts",
      "invocation": "bun run sensor:fixture"
    },
    {
      "id": "sensor/fixture",
      "kind": "sensor",
      "category": "maintainability",
      "principle": "Sensor fixture duplicate.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/sensor-fixture.ts",
      "invocation": "bun run sensor:fixture"
    }
  ]
}
JSON

  if (cd "$fixture_dir" && bun run scripts/harness/generate-harness-controls.ts >"$TMP_ROOT/failure-duplicate-id.out" 2>"$stderr_path"); then
    echo "FAIL: duplicate-id fixture unexpectedly passed"
    exit 1
  fi

  if ! grep -q "duplicate control id" "$stderr_path"; then
    echo "FAIL: duplicate-id fixture stderr did not mention the duplicate"
    cat "$stderr_path"
    exit 1
  fi
}

run_failure_checks() {
  # lint-rule entry restates a re-projected field — rejected.
  run_failure_case "lint-restates-category" "must not restate category" '    {
      "id": "lint/local/fixture-rule",
      "kind": "lint-rule",
      "ruleName": "local/fixture-rule",
      "category": "behavior",
      "source": "eslint-rules/fixture-rule.js",
      "invocation": "bun run lint"
    }'

  # lint-rule entry referencing a rule that does not exist.
  run_failure_case "lint-unknown-rule" "no parseable meta.docs" '    {
      "id": "lint/local/missing",
      "kind": "lint-rule",
      "ruleName": "local/missing",
      "source": "eslint-rules/fixture-rule.js",
      "invocation": "bun run lint"
    }'

  # lint-rule entry with non-existent source.
  run_failure_case "lint-missing-source" "source does not resolve" '    {
      "id": "lint/local/fixture-rule",
      "kind": "lint-rule",
      "ruleName": "local/fixture-rule",
      "source": "eslint-rules/missing.js",
      "invocation": "bun run lint"
    }'

  # Non-lint entry missing principle.
  run_failure_case "missing-principle" "principle" '    {
      "id": "sensor/fixture",
      "kind": "sensor",
      "category": "maintainability",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/sensor-fixture.ts",
      "invocation": "bun run sensor:fixture"
    }'

  # Invalid category.
  run_failure_case "invalid-category" "category" '    {
      "id": "sensor/fixture",
      "kind": "sensor",
      "category": "quality",
      "principle": "Sensor fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/sensor-fixture.ts",
      "invocation": "bun run sensor:fixture"
    }'

  # Invalid kind.
  run_failure_case "invalid-kind" "kind" '    {
      "id": "weird/thing",
      "kind": "future-tense",
      "category": "maintainability",
      "principle": "Future-tense principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/sensor-fixture.ts",
      "invocation": "bun run weird:thing"
    }'

  # Codemod missing repairCommand.
  run_failure_case "codemod-without-command" "repairCommand" '    {
      "id": "codemod/fixture",
      "kind": "codemod",
      "category": "maintainability",
      "principle": "Codemod fixture principle.",
      "pairedGuide": "none",
      "repairKind": "codemod",
      "source": "scripts/codemods/fixture.ts",
      "invocation": "bun run codemod:fixture"
    }'

  # Manual repair with repairCommand.
  run_failure_case "manual-with-command" "repairCommand" '    {
      "id": "sensor/fixture",
      "kind": "sensor",
      "category": "maintainability",
      "principle": "Sensor fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "repairCommand": "bun run codemod:fixture",
      "source": "scripts/sensor-fixture.ts",
      "invocation": "bun run sensor:fixture"
    }'

  # PairedGuide that does not exist.
  run_failure_case "missing-paired-guide" "pairedGuide does not resolve" '    {
      "id": "sensor/fixture",
      "kind": "sensor",
      "category": "maintainability",
      "principle": "Sensor fixture principle.",
      "pairedGuide": "docs/guides/missing.md",
      "repairKind": "manual",
      "source": "scripts/sensor-fixture.ts",
      "invocation": "bun run sensor:fixture"
    }'

  # Non-lint entry with stray ruleName.
  run_failure_case "non-lint-rule-name" "ruleName is only allowed" '    {
      "id": "sensor/fixture",
      "kind": "sensor",
      "ruleName": "local/fixture-rule",
      "category": "maintainability",
      "principle": "Sensor fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/sensor-fixture.ts",
      "invocation": "bun run sensor:fixture"
    }'

  run_duplicate_id_case
  run_unknown_arg_case
  run_manifest_shape_cases
}

run_unknown_arg_case() {
  local fixture_dir="$TMP_ROOT/failure-unknown-arg"
  local stderr_path="$TMP_ROOT/failure-unknown-arg.err"
  write_valid_fixture "$fixture_dir"

  if (cd "$fixture_dir" && bun run scripts/harness/generate-harness-controls.ts --bogus >"$TMP_ROOT/failure-unknown-arg.out" 2>"$stderr_path"); then
    echo "FAIL: unknown-arg fixture unexpectedly passed"
    exit 1
  fi

  if ! grep -q "Unknown argument" "$stderr_path"; then
    echo "FAIL: unknown-arg fixture stderr did not flag the bogus flag"
    cat "$stderr_path"
    exit 1
  fi
}

run_manifest_shape_case() {
  local name=$1
  local keyword=$2
  local manifest_body=$3
  local fixture_dir="$TMP_ROOT/failure-manifest-shape-$name"
  local stderr_path="$TMP_ROOT/failure-manifest-shape-$name.err"
  copy_generator "$fixture_dir"
  write_paired_guide "$fixture_dir"
  write_eslint_plugin "$fixture_dir"
  write_source_files "$fixture_dir"
  printf '%s\n' "$manifest_body" >"$fixture_dir/harness.controls.json"

  if (cd "$fixture_dir" && bun run scripts/harness/generate-harness-controls.ts >"$TMP_ROOT/failure-manifest-shape-$name.out" 2>"$stderr_path"); then
    echo "FAIL: manifest-shape fixture $name unexpectedly passed"
    exit 1
  fi

  if ! grep -q "$keyword" "$stderr_path"; then
    echo "FAIL: manifest-shape fixture $name stderr did not mention $keyword"
    cat "$stderr_path"
    exit 1
  fi
}

run_manifest_shape_cases() {
  # Manifest root is not an object.
  run_manifest_shape_case "root-array" "must be an object" "[]"
  # Manifest root is an object but missing the controls array.
  run_manifest_shape_case "no-controls-array" "controls array" '{"controls":"not an array"}'
}

run_real_tree_drift_check() {
  bun run docs:harness-controls >"$TMP_ROOT/real-gen.out" 2>&1
  test -s "$GENERATED"

  bun run docs:harness-controls:check >"$TMP_ROOT/real-check-clean.out" 2>&1
  grep -q "up to date" "$TMP_ROOT/real-check-clean.out"

  ORIGINAL_GENERATED="$TMP_ROOT/original-harness-controls.md"
  cp "$GENERATED" "$ORIGINAL_GENERATED"
  printf '\nstale\n' >>"$GENERATED"

  if bun run docs:harness-controls:check >"$TMP_ROOT/real-check-drift.out" 2>&1; then
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

echo "PASS: generate-harness-controls smoke"
