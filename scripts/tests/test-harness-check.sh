#!/usr/bin/env bash
# Smoke test for scripts/harness-check.ts.
#
# Contract:
# - validator passes against the live tree;
# - parity failures fire when a local rule is missing from the manifest, when
#   a package.json control-prefix script is undeclared, when a manifest entry
#   points at a missing source / unknown rule / unknown script, and when
#   shape rules are violated;
# - generated verify step, hook-wiring, and harness-controls doc freshness
#   fail when their checked-in outputs are stale.
set -euo pipefail

cd "$(dirname "$0")/../.."

# Derive ratchet manifest entries from the live harness.controls.json so the
# fixture stays in sync automatically when ratchets are added or removed.
FIXTURE_RATCHET_ENTRIES=$(
  jq -r '[.controls[] | select(.kind == "ratchet") | .pairedGuide = "none"]
         | map("    " + tojson)
         | join(",\n")' harness.controls.json
)

TMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/harness-check-fixture-XXXXXX")

cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

copy_validator() {
  local fixture_dir=$1
  mkdir -p \
    "$fixture_dir/eslint-config" \
    "$fixture_dir/scripts/ai-hooks" \
    "$fixture_dir/scripts/harness" \
    "$fixture_dir/scripts/lib" \
    "$fixture_dir/scripts/lint-ratchet" \
    "$fixture_dir/scripts/verify"
  cp eslint-config/shared-policy.js "$fixture_dir/eslint-config/shared-policy.js"
  cp scripts/harness-check.ts "$fixture_dir/scripts/harness-check.ts"
  cp scripts/ai-hooks/check-wiring.sh "$fixture_dir/scripts/ai-hooks/check-wiring.sh"
  cp scripts/harness/harness-check-validation.ts "$fixture_dir/scripts/harness/harness-check-validation.ts"
  cp scripts/harness/control-field-validation.ts "$fixture_dir/scripts/harness/control-field-validation.ts"
  cp scripts/harness/generate-harness-controls.ts "$fixture_dir/scripts/harness/generate-harness-controls.ts"
  cp scripts/harness/generate-harness-controls-validation.ts \
    "$fixture_dir/scripts/harness/generate-harness-controls-validation.ts"
  cp scripts/harness/generate-hook-wiring.ts "$fixture_dir/scripts/harness/generate-hook-wiring.ts"
  cp scripts/harness/generate-verify-steps.ts "$fixture_dir/scripts/harness/generate-verify-steps.ts"
  cp scripts/lib/lint-rule-docs.ts "$fixture_dir/scripts/lib/lint-rule-docs.ts"
  cp scripts/lib/doc-generator.ts "$fixture_dir/scripts/lib/doc-generator.ts"
  cp scripts/harness/hook-wiring-schema.ts "$fixture_dir/scripts/harness/hook-wiring-schema.ts"
  cp scripts/harness/verify-step-schema.ts "$fixture_dir/scripts/harness/verify-step-schema.ts"
  cp scripts/lint-ratchet/lint-ratchet-config.ts "$fixture_dir/scripts/lint-ratchet/lint-ratchet-config.ts"
  cp scripts/lint-ratchet/max-lines-policy.ts "$fixture_dir/scripts/lint-ratchet/max-lines-policy.ts"
  cp scripts/lint-ratchet/lint-ratchet-registry-builders.ts \
    "$fixture_dir/scripts/lint-ratchet/lint-ratchet-registry-builders.ts"
  cp scripts/lint-ratchet/ratchet-manifest-message.ts "$fixture_dir/scripts/lint-ratchet/ratchet-manifest-message.ts"
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
  : >"$fixture_dir/scripts/lint-coverage-map-check.ts"
  : >"$fixture_dir/scripts/lint-ratchet/lint-ratchet-zero-baseline.ts"
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
    "lint:changed": "eslint . --changed",
    "lint:ratchet": "bun scripts/lint-ratchet.ts",
    "lint:ratchet:zero-baseline": "bun scripts/lint-ratchet.ts --zero-baseline",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:changed": "vitest related",
    "test:scripts": "bash scripts/test-scripts.sh",
    "test:scripts:changed": "bash scripts/test-scripts.sh --changed",
    "docs:lint-coverage-map:check": "bun scripts/lint-coverage-map-check.ts -- --check-eslint-reach",
    "format:check": "prettier --check .",
    "format:changed:check": "bash scripts/format-changed.sh --check",
    "verify": "bash scripts/verify.sh",
    "verify:changed": "bash scripts/verify.sh --changed",
    "verify:parallel": "bash scripts/verify.sh --parallel",
    "sensor:fixture": "bun scripts/sensor-fixture.ts",
    "codemod:fixture": "bun scripts/codemods/fixture.ts"$extra_scripts
  }
}
JSON
}

write_wrapper_shells() {
  local fixture_dir=$1
  cat >"$fixture_dir/scripts/verify.sh" <<'SH'
#!/usr/bin/env bash
echo verify
SH
  mkdir -p "$fixture_dir/.husky"
  cat >"$fixture_dir/.husky/pre-commit" <<'SH'
#!/usr/bin/env bash
echo pre-commit
SH
}

write_generated_hook_files() {
  local fixture_dir=$1
  mkdir -p "$fixture_dir/.claude" "$fixture_dir/.codex"
  cat >"$fixture_dir/.claude/settings.json" <<'JSON'
{
  "env": {
    "KEEP": "yes"
  },
  "hooks": {
    "PreToolUse": []
  }
}
JSON
  cat >"$fixture_dir/.codex/hooks.json" <<'JSON'
{
  "hooks": {}
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
$FIXTURE_RATCHET_ENTRIES,
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
    },
    {
      "id": "check/lint-coverage-map",
      "kind": "check",
      "category": "maintainability",
      "principle": "Coverage-map fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/lint-coverage-map-check.ts",
      "invocation": "bun run docs:lint-coverage-map:check"
    },
    {
      "id": "check/lint-ratchet-zero-baseline",
      "kind": "check",
      "category": "maintainability",
      "principle": "Zero-baseline fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/lint-ratchet/lint-ratchet-zero-baseline.ts",
      "invocation": "bun run lint:ratchet:zero-baseline"
    },
    {
      "id": "verify-wrapper/verify",
      "kind": "verify-wrapper",
      "category": "maintainability",
      "principle": "Verify fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/verify.sh",
      "invocation": "bun run verify",
      "slots": [
        { "name": "lint", "script": "lint" },
        { "name": "ratchet", "script": "lint:ratchet" },
        { "name": "zero-baseline", "script": "lint:ratchet:zero-baseline" },
        { "name": "coverage-map", "script": "docs:lint-coverage-map:check" },
        { "name": "format-check", "script": "format:check" },
        { "name": "typecheck", "script": "typecheck" },
        { "name": "test", "script": "test" },
        { "name": "scripts", "script": "test:scripts" }
      ]
    },
    {
      "id": "verify-wrapper/verify-changed",
      "kind": "verify-wrapper",
      "category": "maintainability",
      "principle": "Verify changed fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/verify.sh",
      "invocation": "bun run verify:changed",
      "slots": [
        { "name": "lint", "script": "lint:changed" },
        { "name": "ratchet", "script": "lint:ratchet" },
        { "name": "zero-baseline", "script": "lint:ratchet:zero-baseline" },
        { "name": "coverage-map", "script": "docs:lint-coverage-map:check" },
        { "name": "format-check", "script": "format:changed:check" },
        { "name": "typecheck", "script": "typecheck" },
        { "name": "test", "script": "test:changed" },
        { "name": "scripts", "script": "test:scripts:changed" }
      ]
    },
    {
      "id": "verify-wrapper/verify-parallel",
      "kind": "verify-wrapper",
      "category": "maintainability",
      "principle": "Verify parallel fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/verify.sh",
      "invocation": "bun run verify:parallel",
      "slots": [
        { "name": "lint", "script": "lint" },
        { "name": "ratchet", "script": "lint:ratchet" },
        { "name": "zero-baseline", "script": "lint:ratchet:zero-baseline" },
        { "name": "coverage-map", "script": "docs:lint-coverage-map:check" },
        { "name": "format-check", "script": "format:check" },
        { "name": "typecheck", "script": "typecheck" },
        { "name": "test", "script": "test" },
        { "name": "scripts", "script": "test:scripts" }
      ]
    },
    {
      "id": "hook/pre-commit",
      "kind": "hook",
      "category": "maintainability",
      "principle": "Pre-commit fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": ".husky/pre-commit",
      "invocation": "git commit",
      "slots": [
        { "name": "lint", "script": "lint:changed" },
        { "name": "ratchet", "script": "lint:ratchet" },
        { "name": "zero-baseline", "script": "lint:ratchet:zero-baseline" },
        { "name": "coverage-map", "script": "docs:lint-coverage-map:check" },
        { "name": "format-check", "script": "format:changed:check" },
        { "name": "typecheck", "script": "typecheck" },
        { "name": "test", "script": "test:changed" },
        {
          "name": "scripts",
          "script": "test:scripts:changed",
          "condition": "when staged hook/script/harness inputs require script smoke"
        }
      ]
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
  write_wrapper_shells "$fixture_dir"
  write_generated_hook_files "$fixture_dir"
  write_package_json "$fixture_dir"
  write_valid_manifest "$fixture_dir"
  (cd "$fixture_dir" && bun run scripts/harness/generate-verify-steps.ts >/dev/null)
  (cd "$fixture_dir" && bun run scripts/harness/generate-hook-wiring.ts >/dev/null)
  (cd "$fixture_dir" && bun run scripts/harness/generate-harness-controls.ts >/dev/null)
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

mutate_stale_verify_steps() {
  local fixture_dir=$1
  printf '# stale\n' >> "$fixture_dir/scripts/verify/steps.generated.sh"
}

mutate_stale_hook_wiring() {
  local fixture_dir=$1
  printf '\n' >> "$fixture_dir/.codex/hooks.json"
}

mutate_missing_hook_body() {
  local fixture_dir=$1
  mkdir -p "$fixture_dir/.codex/hooks"
  cat >"$fixture_dir/.codex/hooks/missing-body.sh" <<'SH'
#!/usr/bin/env bash
exec bash "$REPO_ROOT/scripts/ai-hooks/missing-body.sh"
SH
  chmod +x "$fixture_dir/.codex/hooks/missing-body.sh"
  write_valid_manifest "$fixture_dir" ',
    {
      "id": "hook/missing-body-fixture",
      "kind": "hook",
      "category": "maintainability",
      "principle": "Missing hook body fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": ".codex/hooks/missing-body.sh",
      "invocation": "agent hook",
      "hookWiring": {
        "event": "PostToolUse",
        "order": 10,
        "harnesses": {
          "codex": {
            "matcher": "apply_patch",
            "command": "bash \"$(git rev-parse --show-toplevel)/.codex/hooks/missing-body.sh\"",
            "statusMessage": "Fixture hook"
          }
        },
        "notes": {
          "claude": "Fixture only."
        }
      }
    }'
  (cd "$fixture_dir" && bun run scripts/harness/generate-hook-wiring.ts >/dev/null)
  (cd "$fixture_dir" && bun run scripts/harness/generate-harness-controls.ts >/dev/null)
}

mutate_stale_harness_docs() {
  local fixture_dir=$1
  printf 'stale\n' >> "$fixture_dir/docs/generated/harness-controls.md"
}

run_failure_checks() {
  run_failure_case "orphan-rule" "is not declared in the manifest" mutate_orphan_rule
  run_failure_case "undeclared-script" "not declared in harness.controls.json and not exempt" mutate_undeclared_script
  run_failure_case "undeclared-db-script" "db:undeclared" mutate_undeclared_db_script
  run_failure_case "non-object-manifest-entry" "is not an object" mutate_non_object_manifest_entry
  run_failure_case "missing-source" "source does not resolve" mutate_missing_source
  run_failure_case "unknown-rule-name" "not registered in the local ESLint plugin" mutate_unknown_rule_name
  run_failure_case "unknown-invocation" "invocation references unknown package.json script" mutate_unknown_invocation
  run_failure_case "unknown-repair-command" "repairCommand references unknown package.json script" mutate_codemod_unknown_repair_command
  run_failure_case "repair-command-bad-prefix" 'repairCommand must start with "bun run "' mutate_repair_command_bad_prefix
  run_failure_case "lint-restates-field" "must not restate category" mutate_lint_restates_field
  run_failure_case "paired-guide-missing" "pairedGuide does not resolve" mutate_paired_guide_missing
  run_failure_case "missing-ratchet-control" "Next steps:" mutate_missing_ratchet_control
  run_failure_case "stale-verify-steps" "steps.generated.sh is out of date" mutate_stale_verify_steps
  run_failure_case "stale-hook-wiring" "hooks.json" mutate_stale_hook_wiring
  run_failure_case "missing-hook-body" "execs a missing body" mutate_missing_hook_body
  run_failure_case "stale-harness-docs" "harness-controls.md is out of date" mutate_stale_harness_docs
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
