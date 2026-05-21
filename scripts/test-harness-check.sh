#!/usr/bin/env bash
# Smoke test for scripts/harness-check.ts.
#
# Contract:
# - validator passes against the live tree;
# - parity failures fire when a local rule is missing from the manifest, when
#   a package.json control-prefix script is undeclared, when a manifest entry
#   points at a missing source / unknown rule / unknown script, and when
#   shape rules are violated.
set -euo pipefail

cd "$(dirname "$0")/.."

TMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/harness-check-fixture-XXXXXX")

cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

copy_validator() {
  local fixture_dir=$1
  mkdir -p "$fixture_dir/scripts"
  cp scripts/harness-check.ts "$fixture_dir/scripts/harness-check.ts"
  cp scripts/lint-ratchet-config.ts "$fixture_dir/scripts/lint-ratchet-config.ts"
}

write_eslint_plugin() {
  local fixture_dir=$1
  local extra_rules=${2-}
  cat >"$fixture_dir/local-plugin.js" <<JS
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
      pairedGuide: "none",
      repairKind: "manual",
    }),$extra_rules
  },
};
JS
  cat >"$fixture_dir/eslint.config.js" <<'JS'
import local from "./local-plugin.js";

export default [{ plugins: { local } }];
JS
}

write_source_files() {
  local fixture_dir=$1
  mkdir -p "$fixture_dir/eslint-rules" "$fixture_dir/scripts" "$fixture_dir/scripts/codemods"
  : >"$fixture_dir/eslint-rules/fixture-rule.js"
  : >"$fixture_dir/scripts/sensor-fixture.ts"
  : >"$fixture_dir/scripts/codemods/fixture.ts"
}

write_package_json() {
  local fixture_dir=$1
  local extra_scripts=${2-}
  cat >"$fixture_dir/package.json" <<JSON
{
  "name": "harness-check-fixture",
  "scripts": {
    "lint": "eslint .",
    "lint:ratchet": "bun scripts/lint-ratchet.ts",
    "sensor:fixture": "bun scripts/sensor-fixture.ts",
    "codemod:fixture": "bun scripts/codemods/fixture.ts"$extra_scripts
  }
}
JSON
}

write_valid_manifest() {
  local fixture_dir=$1
  local extra_entries=${2-}
  cat >"$fixture_dir/harness.controls.json" <<JSON
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
      "id": "ratchet/core-complexity-codemods",
      "kind": "ratchet",
      "category": "maintainability",
      "principle": "Codemod complexity ratchet fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/lint-ratchet-config.ts",
      "invocation": "bun run lint:ratchet"
    },
    {
      "id": "ratchet/core-complexity-drift-ai",
      "kind": "ratchet",
      "category": "maintainability",
      "principle": "Drift-AI complexity ratchet fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/lint-ratchet-config.ts",
      "invocation": "bun run lint:ratchet"
    },
    {
      "id": "ratchet/core-complexity-eslint-rules",
      "kind": "ratchet",
      "category": "maintainability",
      "principle": "ESLint-rules complexity ratchet fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/lint-ratchet-config.ts",
      "invocation": "bun run lint:ratchet"
    },
    {
      "id": "ratchet/core-complexity-top-level-scripts",
      "kind": "ratchet",
      "category": "maintainability",
      "principle": "Top-level scripts complexity ratchet fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/lint-ratchet-config.ts",
      "invocation": "bun run lint:ratchet"
    },
    {
      "id": "ratchet/core-no-magic-numbers-eslint-rules",
      "kind": "ratchet",
      "category": "maintainability",
      "principle": "ESLint-rules magic-number ratchet fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/lint-ratchet-config.ts",
      "invocation": "bun run lint:ratchet"
    },
    {
      "id": "ratchet/core-no-magic-numbers-top-level-scripts",
      "kind": "ratchet",
      "category": "maintainability",
      "principle": "Top-level scripts magic-number ratchet fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/lint-ratchet-config.ts",
      "invocation": "bun run lint:ratchet"
    },
    {
      "id": "ratchet/core-preserve-caught-error-top-level-scripts",
      "kind": "ratchet",
      "category": "behavior",
      "principle": "Top-level scripts preserve-caught-error ratchet fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/lint-ratchet-config.ts",
      "invocation": "bun run lint:ratchet"
    },
    {
      "id": "ratchet/local-max-lines",
      "kind": "ratchet",
      "category": "maintainability",
      "principle": "Max lines ratchet fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/lint-ratchet-config.ts",
      "invocation": "bun run lint:ratchet"
    },
    {
      "id": "ratchet/local-max-lines-code-intel",
      "kind": "ratchet",
      "category": "maintainability",
      "principle": "Code-intel max lines ratchet fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/lint-ratchet-config.ts",
      "invocation": "bun run lint:ratchet"
    },
    {
      "id": "ratchet/local-max-lines-codemods",
      "kind": "ratchet",
      "category": "maintainability",
      "principle": "Codemod max lines ratchet fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/lint-ratchet-config.ts",
      "invocation": "bun run lint:ratchet"
    },
    {
      "id": "ratchet/local-max-lines-drift-ai",
      "kind": "ratchet",
      "category": "maintainability",
      "principle": "Drift-AI max lines ratchet fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/lint-ratchet-config.ts",
      "invocation": "bun run lint:ratchet"
    },
    {
      "id": "ratchet/local-max-lines-generate-harness-controls",
      "kind": "ratchet",
      "category": "maintainability",
      "principle": "Generate-harness-controls max lines ratchet fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/lint-ratchet-config.ts",
      "invocation": "bun run lint:ratchet"
    },
    {
      "id": "ratchet/local-max-lines-logs-audit",
      "kind": "ratchet",
      "category": "maintainability",
      "principle": "Logs-audit max lines ratchet fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/lint-ratchet-config.ts",
      "invocation": "bun run lint:ratchet"
    },
    {
      "id": "ratchet/local-max-lines-runtime",
      "kind": "ratchet",
      "category": "maintainability",
      "principle": "Runtime max lines ratchet fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/lint-ratchet-config.ts",
      "invocation": "bun run lint:ratchet"
    },
    {
      "id": "ratchet/local-type-assertion-boundary",
      "kind": "ratchet",
      "category": "maintainability",
      "principle": "Ratchet fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/lint-ratchet-config.ts",
      "invocation": "bun run lint:ratchet"
    },
    {
      "id": "ratchet/regexp-no-unused-capturing-group-eslint-rules",
      "kind": "ratchet",
      "category": "behavior",
      "principle": "ESLint-rules unused regex capturing-group ratchet fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/lint-ratchet-config.ts",
      "invocation": "bun run lint:ratchet"
    },
    {
      "id": "ratchet/regexp-no-useless-non-capturing-group-eslint-rules",
      "kind": "ratchet",
      "category": "behavior",
      "principle": "ESLint-rules useless regex non-capturing-group ratchet fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/lint-ratchet-config.ts",
      "invocation": "bun run lint:ratchet"
    },
    {
      "id": "ratchet/simple-import-sort-imports-top-level-scripts",
      "kind": "ratchet",
      "category": "maintainability",
      "principle": "Top-level scripts import-sort ratchet fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/lint-ratchet-config.ts",
      "invocation": "bun run lint:ratchet"
    },
    {
      "id": "ratchet/strict-boolean-expressions-shared",
      "kind": "ratchet",
      "category": "maintainability",
      "principle": "Strict boolean ratchet fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/lint-ratchet-config.ts",
      "invocation": "bun run lint:ratchet"
    },
    {
      "id": "ratchet/typescript-eslint-no-misused-promises-codemod-tests",
      "kind": "ratchet",
      "category": "maintainability",
      "principle": "TypeScript-ESLint no-misused-promises codemod test ratchet fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/lint-ratchet-config.ts",
      "invocation": "bun run lint:ratchet"
    },
    {
      "id": "ratchet/typescript-eslint-no-misused-promises-drift-ai-tests",
      "kind": "ratchet",
      "category": "maintainability",
      "principle": "TypeScript-ESLint no-misused-promises drift-ai test ratchet fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/lint-ratchet-config.ts",
      "invocation": "bun run lint:ratchet"
    },
    {
      "id": "ratchet/typescript-eslint-no-unsafe-argument-top-level-scripts",
      "kind": "ratchet",
      "category": "behavior",
      "principle": "Top-level scripts no-unsafe-argument ratchet fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/lint-ratchet-config.ts",
      "invocation": "bun run lint:ratchet"
    },
    {
      "id": "ratchet/typescript-eslint-only-throw-error-codemod-tests",
      "kind": "ratchet",
      "category": "maintainability",
      "principle": "TypeScript-ESLint only-throw-error codemod test ratchet fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/lint-ratchet-config.ts",
      "invocation": "bun run lint:ratchet"
    },
    {
      "id": "ratchet/typescript-eslint-restrict-template-expressions-top-level-scripts",
      "kind": "ratchet",
      "category": "behavior",
      "principle": "Top-level scripts restrict-template-expressions ratchet fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/lint-ratchet-config.ts",
      "invocation": "bun run lint:ratchet"
    },
    {
      "id": "ratchet/typescript-eslint-unbound-method-top-level-scripts",
      "kind": "ratchet",
      "category": "behavior",
      "principle": "Top-level scripts unbound-method ratchet fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/lint-ratchet-config.ts",
      "invocation": "bun run lint:ratchet"
    },
    {
      "id": "ratchet/typescript-eslint-only-throw-error-drift-ai-tests",
      "kind": "ratchet",
      "category": "maintainability",
      "principle": "TypeScript-ESLint only-throw-error drift-ai test ratchet fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/lint-ratchet-config.ts",
      "invocation": "bun run lint:ratchet"
    },
    {
      "id": "ratchet/vitest-expect-expect-codemod-tests",
      "kind": "ratchet",
      "category": "maintainability",
      "principle": "Vitest expect-expect codemod test ratchet fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/lint-ratchet-config.ts",
      "invocation": "bun run lint:ratchet"
    },
    {
      "id": "ratchet/vitest-expect-expect-drift-ai-tests",
      "kind": "ratchet",
      "category": "maintainability",
      "principle": "Vitest expect-expect drift-ai test ratchet fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/lint-ratchet-config.ts",
      "invocation": "bun run lint:ratchet"
    },
    {
      "id": "ratchet/vitest-no-commented-out-tests-eslint-rules-tests",
      "kind": "ratchet",
      "category": "maintainability",
      "principle": "Vitest no-commented-out-tests eslint-rules test ratchet fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/lint-ratchet-config.ts",
      "invocation": "bun run lint:ratchet"
    },
    {
      "id": "ratchet/vitest-no-conditional-expect-eslint-rules-tests",
      "kind": "ratchet",
      "category": "maintainability",
      "principle": "Vitest no-conditional-expect eslint-rules test ratchet fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/lint-ratchet-config.ts",
      "invocation": "bun run lint:ratchet"
    },
    {
      "id": "ratchet/vitest-valid-expect-codemod-tests",
      "kind": "ratchet",
      "category": "maintainability",
      "principle": "Vitest valid-expect codemod test ratchet fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/lint-ratchet-config.ts",
      "invocation": "bun run lint:ratchet"
    },
    {
      "id": "ratchet/vitest-valid-expect-drift-ai-tests",
      "kind": "ratchet",
      "category": "maintainability",
      "principle": "Vitest valid-expect drift-ai test ratchet fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/lint-ratchet-config.ts",
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
      "id": "codemod/fixture",
      "kind": "codemod",
      "category": "maintainability",
      "principle": "Codemod fixture principle.",
      "pairedGuide": "none",
      "repairKind": "codemod",
      "repairCommand": "bun run codemod:fixture",
      "source": "scripts/codemods/fixture.ts",
      "invocation": "bun run codemod:fixture"
    }$extra_entries
  ]
}
JSON
}

write_valid_fixture() {
  local fixture_dir=$1
  copy_validator "$fixture_dir"
  write_eslint_plugin "$fixture_dir"
  write_source_files "$fixture_dir"
  write_package_json "$fixture_dir"
  write_valid_manifest "$fixture_dir"
}

run_pass_case() {
  local fixture_dir="$TMP_ROOT/pass"
  write_valid_fixture "$fixture_dir"

  if ! (cd "$fixture_dir" && bun run scripts/harness-check.ts >"$TMP_ROOT/pass.out" 2>"$TMP_ROOT/pass.err"); then
    echo "FAIL: valid fixture rejected by harness:check"
    cat "$TMP_ROOT/pass.out" "$TMP_ROOT/pass.err"
    exit 1
  fi
  if ! grep -q "harness:check OK" "$TMP_ROOT/pass.out"; then
    echo "FAIL: valid fixture did not print OK summary"
    cat "$TMP_ROOT/pass.out"
    exit 1
  fi
}

# Build a fixture, mutate it via $mutator, expect non-zero exit + $keyword in
# stderr.
run_failure_case() {
  local name=$1
  local keyword=$2
  local mutator=$3
  local fixture_dir="$TMP_ROOT/failure-$name"
  local stderr_path="$TMP_ROOT/failure-$name.err"
  write_valid_fixture "$fixture_dir"
  "$mutator" "$fixture_dir"

  if (cd "$fixture_dir" && bun run scripts/harness-check.ts >"$TMP_ROOT/failure-$name.out" 2>"$stderr_path"); then
    echo "FAIL: invalid fixture $name unexpectedly passed"
    cat "$stderr_path"
    exit 1
  fi
  if ! grep -q "$keyword" "$stderr_path"; then
    echo "FAIL: invalid fixture $name stderr did not mention $keyword"
    cat "$stderr_path"
    exit 1
  fi
}

mutate_orphan_rule() {
  local fixture_dir=$1
  # Re-emit eslint config with an extra rule not in the manifest.
  write_eslint_plugin "$fixture_dir" '
    "orphan-rule": makeRule({
      description: "Orphan lint rule",
      principle: "Orphan principle.",
      category: "maintainability",
      pairedGuide: "none",
      repairKind: "manual",
    }),'
}

mutate_undeclared_script() {
  local fixture_dir=$1
  # Add a sensor:* script without a manifest entry.
  write_package_json "$fixture_dir" ',
    "sensor:undeclared": "echo undeclared"'
}

mutate_non_object_manifest_entry() {
  local fixture_dir=$1
  cat >"$fixture_dir/harness.controls.json" <<'JSON'
{
  "controls": [
    "not-an-object",
    {
      "id": "sensor/fixture",
      "kind": "sensor",
      "category": "maintainability",
      "principle": "Sensor fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/sensor-fixture.ts",
      "invocation": "bun run sensor:fixture"
    }
  ]
}
JSON
}

mutate_undeclared_db_script() {
  local fixture_dir=$1
  # Add a db:* script without a manifest entry — the widened
  # CONTROL_PREFIX_PATTERN catches db/worktree/harness/lint families too.
  write_package_json "$fixture_dir" ',
    "db:undeclared": "echo undeclared"'
}

mutate_missing_source() {
  local fixture_dir=$1
  rm "$fixture_dir/scripts/sensor-fixture.ts"
}

mutate_unknown_rule_name() {
  local fixture_dir=$1
  write_valid_manifest "$fixture_dir" ',
    {
      "id": "lint/local/ghost",
      "kind": "lint-rule",
      "ruleName": "local/ghost",
      "source": "eslint-rules/fixture-rule.js",
      "invocation": "bun run lint"
    }'
}

mutate_unknown_invocation() {
  local fixture_dir=$1
  # Manifest entry references a bun-run script that does not exist in
  # package.json.
  write_valid_manifest "$fixture_dir" ',
    {
      "id": "sensor/ghost",
      "kind": "sensor",
      "category": "maintainability",
      "principle": "Ghost sensor principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/sensor-fixture.ts",
      "invocation": "bun run sensor:ghost"
    }'
}

mutate_codemod_unknown_repair_command() {
  local fixture_dir=$1
  write_valid_manifest "$fixture_dir" ',
    {
      "id": "codemod/ghost",
      "kind": "codemod",
      "category": "maintainability",
      "principle": "Ghost codemod principle.",
      "pairedGuide": "none",
      "repairKind": "codemod",
      "repairCommand": "bun run codemod:ghost",
      "source": "scripts/codemods/fixture.ts",
      "invocation": "bun run codemod:fixture"
    }'
}

mutate_lint_restates_field() {
  local fixture_dir=$1
  # Replace the manifest's single lint-rule entry with one that restates
  # category — re-projected fields must not appear on lint-rule entries.
  cat >"$fixture_dir/harness.controls.json" <<'JSON'
{
  "controls": [
    {
      "id": "lint/local/fixture-rule",
      "kind": "lint-rule",
      "ruleName": "local/fixture-rule",
      "category": "behavior",
      "source": "eslint-rules/fixture-rule.js",
      "invocation": "bun run lint"
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
      "id": "codemod/fixture",
      "kind": "codemod",
      "category": "maintainability",
      "principle": "Codemod fixture principle.",
      "pairedGuide": "none",
      "repairKind": "codemod",
      "repairCommand": "bun run codemod:fixture",
      "source": "scripts/codemods/fixture.ts",
      "invocation": "bun run codemod:fixture"
    }
  ]
}
JSON
}

mutate_repair_command_bad_prefix() {
  local fixture_dir=$1
  # Codemod manifest entry whose repairCommand does not start with "bun run ".
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
      "id": "codemod/fixture",
      "kind": "codemod",
      "category": "maintainability",
      "principle": "Codemod fixture principle.",
      "pairedGuide": "none",
      "repairKind": "codemod",
      "repairCommand": "./scripts/codemods/fixture.ts",
      "source": "scripts/codemods/fixture.ts",
      "invocation": "bun run codemod:fixture"
    }
  ]
}
JSON
}

mutate_missing_ratchet_control() {
  local fixture_dir=$1
  # Manifest omits the ratchet entries that the
  # exported lintRatchets registry still references — reverse parity must fire.
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
      "id": "codemod/fixture",
      "kind": "codemod",
      "category": "maintainability",
      "principle": "Codemod fixture principle.",
      "pairedGuide": "none",
      "repairKind": "codemod",
      "repairCommand": "bun run codemod:fixture",
      "source": "scripts/codemods/fixture.ts",
      "invocation": "bun run codemod:fixture"
    }
  ]
}
JSON
}

mutate_paired_guide_missing() {
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
      "id": "sensor/fixture",
      "kind": "sensor",
      "category": "maintainability",
      "principle": "Sensor fixture principle.",
      "pairedGuide": "docs/guides/ghost.md",
      "repairKind": "manual",
      "source": "scripts/sensor-fixture.ts",
      "invocation": "bun run sensor:fixture"
    },
    {
      "id": "codemod/fixture",
      "kind": "codemod",
      "category": "maintainability",
      "principle": "Codemod fixture principle.",
      "pairedGuide": "none",
      "repairKind": "codemod",
      "repairCommand": "bun run codemod:fixture",
      "source": "scripts/codemods/fixture.ts",
      "invocation": "bun run codemod:fixture"
    }
  ]
}
JSON
}

run_failure_checks() {
  run_failure_case "orphan-rule" "is not declared in the manifest" mutate_orphan_rule
  run_failure_case "undeclared-script" "not declared in the manifest and not exempt" mutate_undeclared_script
  run_failure_case "undeclared-db-script" "db:undeclared" mutate_undeclared_db_script
  run_failure_case "non-object-manifest-entry" "is not an object" mutate_non_object_manifest_entry
  run_failure_case "missing-source" "source does not resolve" mutate_missing_source
  run_failure_case "unknown-rule-name" "not registered in the local ESLint plugin" mutate_unknown_rule_name
  run_failure_case "unknown-invocation" "invocation references unknown package.json script" mutate_unknown_invocation
  run_failure_case "unknown-repair-command" "repairCommand references unknown package.json script" mutate_codemod_unknown_repair_command
  run_failure_case "repair-command-bad-prefix" 'repairCommand must start with "bun run "' mutate_repair_command_bad_prefix
  run_failure_case "lint-restates-field" "must not restate category" mutate_lint_restates_field
  run_failure_case "paired-guide-missing" "pairedGuide does not resolve" mutate_paired_guide_missing
  run_failure_case "missing-ratchet-control" "is not declared in the manifest as kind" mutate_missing_ratchet_control
}

run_real_tree_check() {
  if ! bun run harness:check >"$TMP_ROOT/real.out" 2>&1; then
    echo "FAIL: real-tree harness:check rejected the current manifest"
    cat "$TMP_ROOT/real.out"
    exit 1
  fi
}

run_pass_case
run_failure_checks
run_real_tree_check

echo "PASS: harness-check smoke"
