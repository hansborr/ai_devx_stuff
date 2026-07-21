#!/usr/bin/env bash
# smoke-order: 320
# smoke-subjects: scripts/harness-check.ts
# smoke-subjects: scripts/lint-agent-guidance.ts
# smoke-subjects: scripts/lint-coverage-map-gen.ts
# smoke-subjects: scripts/lint-coverage-map-gen-core.ts
# smoke-subjects: scripts/harness/control-field-validation.ts
# smoke-subjects: scripts/harness/harness-check-validation.ts
# smoke-subjects: scripts/harness/harness-gate-parity.ts
# smoke-subjects: scripts/doctor.sh
# smoke-subjects: scripts/harness/generated-surfaces.ts
# smoke-subjects: scripts/harness/hook-timeout-constants.ts
# smoke-subjects: scripts/harness/generate-hook-timeout-constants.ts
# smoke-subjects: scripts/harness/harness-manifest.ts
# smoke-subjects: scripts/harness/harness-paths.ts
# smoke-subjects: scripts/harness/porting-knob-parity.ts
# smoke-subjects: scripts/harness/porting-knob-parity.test.ts
# smoke-subjects: scripts/harness/pre-push-scope-pin.ts
# smoke-subjects: scripts/drift-ai/scope.ts
# smoke-subjects: drift-ai.config.json
# smoke-subjects: .husky/pre-push
# smoke-subjects: scripts/harness/generate-hook-wiring.ts
# smoke-subjects: scripts/harness/hook-shims.ts
# smoke-subjects: scripts/harness/hook-shim-files.ts
# smoke-subjects: scripts/lib/atomic-write.ts
# smoke-subjects: scripts/harness/generate-verify-steps.ts
# smoke-subjects: scripts/harness/generate-config-surfaces.ts
# smoke-subjects: scripts/generate-baseline-conflict-recipes.ts
# smoke-subjects: scripts/git/baseline-merge-driver.sh
# smoke-subjects: docs/guides/lint-ratchet-merges.md
# smoke-subjects: scripts/harness/hook-wiring-schema.ts
# smoke-subjects: scripts/harness/check-skill-inventory.ts
# smoke-subjects: scripts/harness/skill-inventory-schema.ts
# smoke-subjects: scripts/harness/skill-tree-comparison.ts
# smoke-subjects: scripts/path-policy/generate-smoke-subjects.ts
# smoke-subjects: scripts/path-policy/smoke-subject-headers.ts
# smoke-subjects: scripts/path-policy/fixture-shell-dependencies.ts
# smoke-subjects: scripts/path-policy/fixture-shell-scope.ts
# smoke-subjects: scripts/ai-hooks/check-wiring.sh
# smoke-subjects: scripts/ai-hooks/bun-run-quiet.sh
# smoke-subjects: scripts/ai-hooks/git-commit-quiet.sh
# smoke-subjects: scripts/ai-hooks/hook-timeouts.generated.sh
# smoke-subjects: scripts/ai-hooks/README.md
# smoke-subjects: scripts/ai-hooks/common.sh
# smoke-subjects: scripts/verify/steps.generated.sh
# smoke-subjects: scripts/verify/steps-lib.sh
# smoke-subjects: scripts/verify/memory-budget.sh
# smoke-subjects: scripts/lib/codepoint-compare.ts
# smoke-subjects: scripts/lib/test-worker-count.sh
# smoke-subjects: scripts/harness/verify-step-schema.ts
# smoke-subjects: scripts/harness/fixture-closure-check.ts
# smoke-subjects: scripts/worktree-seed-import-closure.ts
# smoke-subjects: scripts/worktree-seed-runtime-loaders.ts
# smoke-subjects: scripts/worktree-seed-runtime-loader-validation.ts
# smoke-subjects: scripts/worktree-seed-runtime-loader-exports.ts
# smoke-subjects: scripts/worktree-seed-runtime-loader-identifiers.ts
# smoke-subjects: scripts/tests/harness-check-fixture-manifest.generated.txt
# smoke-subjects: scripts/lint-ratchet/ratchet-manifest-message.ts
# smoke-subjects: tools/lint-ratchet/src/kernel/codepoint-compare.ts
# smoke-subjects: scripts/tests/test-harness-check.sh
# smoke-subjects: tsconfig.configs.json
# smoke-subjects: .claude/settings.json
# smoke-subjects: .codex/hooks.json
# smoke-subjects: .github/hooks/copilot.json
# smoke-subjects: .github/workflows/ci.yml
# smoke-subjects: harness.controls.json
# smoke-subjects: eslint.config.js
# smoke-subjects: eslint-config/
# smoke-subjects: eslint-rules/
# smoke-subjects: package.json
# smoke-subjects: tsconfig.scripts.json
# Smoke test for scripts/harness-check.ts.
#
# Contract:
# - validator passes against the live tree;
# - parity failures fire when a local rule is missing from the manifest, when
#   a package.json control-prefix script is undeclared, when a manifest entry
#   points at a missing source / unknown rule / unknown script, and when
#   shape rules are violated; :check twins of generated surfaces are covered
#   by their generatedSurface checkScript alias (no exemption entry), so
#   dropping the facet orphans the script and a redundant exemption fails;
# - the Porting This checklist and greppable source markers stay in parity;
# - the pre-push source-extension pin fails when the fixture hook's boundary
#   trigger alternation drifts from the scanner extensions or is missing;
# - generated smoke-subjects, verify step, hook-wiring, local lint guidance,
#   harness-controls doc, and restricted disable rule-list freshness fail when
#   their checked-in outputs are stale.
set -euo pipefail

cd "$(dirname "$0")/../.."

# The synthesized fixture manifest deliberately declares no
# generatedSurface.fixturePaths, and the fixture tree cannot resolve the
# `typescript` walker, so every copied harness-check run below uses the
# explicit closure-walk opt-out. Everywhere else the validator fails closed on
# zero declarations (see scripts/harness/fixture-closure-check.ts).
export MUSI_HARNESS_CHECK_ALLOW_NO_FIXTURE_PATHS=1

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
  local manifest_path="scripts/tests/harness-check-fixture-manifest.generated.txt"
  local copy_path
  # Plain-copy closure: rendered into the generated manifest from the
  # harness.controls.json generatedSurface fixturePaths facets
  # (`bun run verify:steps` regenerates); harness:check's closure-walk
  # validator keeps the declarations honest against the real import graph.
  # Blank and `#` lines are manifest headers, not copy entries.
  while IFS= read -r copy_path; do
    case "$copy_path" in '' | '#'*) continue ;; esac
    mkdir -p "$fixture_dir/$(dirname "$copy_path")"
    cp "$copy_path" "$fixture_dir/$copy_path"
  done <"$manifest_path"
  # Fixture-synthesized stub (FIXTURE_SYNTHESIZED_PATHS in generated-surfaces.ts):
  # the real overlay table drags ESLint-oriented imports into harness-check that
  # the fixture never needs, so it gets an empty overlay map instead of a copy.
  cat >"$fixture_dir/scripts/lint-agent-guidance.ts" <<'TS'
export const LINT_AGENT_GUIDANCE_OVERLAYS = new Map();
TS
  # @musi/lint-ratchet engine moved to the package (leaf 02 S3); the copied
  # adapter/generators import it, so resolve it via a scoped node_modules
  # symlink instead of copying the moved leaf file.
  mkdir -p "$fixture_dir/node_modules/@musi"
  [ -e "$fixture_dir/node_modules/@musi/lint-ratchet" ] || ln -s "$PWD/tools/lint-ratchet" "$fixture_dir/node_modules/@musi/lint-ratchet"
  # generated-surfaces.ts (facet loader) imports zod; resolve it from the real
  # repo's node_modules via the same symlink pattern as @musi/lint-ratchet.
  [ -e "$fixture_dir/node_modules/zod" ] || ln -s "$PWD/node_modules/zod" "$fixture_dir/node_modules/zod"
  # The lint coverage-map generator calls ESLint.calculateConfigForFile(); the
  # fixture supplies a minimal flat config but resolves the real ESLint module.
  [ -e "$fixture_dir/node_modules/eslint" ] || ln -s "$PWD/node_modules/eslint" "$fixture_dir/node_modules/eslint"
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

export default [
  {
    files: ["scripts/**/*.ts"],
    plugins: { local },
    rules: { "local/fixture-rule": "error" },
  },
];
JS
}

write_source_files() {
  local fixture_dir=$1
  mkdir -p \
    "$fixture_dir/eslint-rules" \
    "$fixture_dir/scripts" \
    "$fixture_dir/scripts/codemods" \
    "$fixture_dir/scripts/drift-ai" \
    "$fixture_dir/scripts/tests" \
    "$fixture_dir/.claude/skills/fixture" \
    "$fixture_dir/.codex/skills/fixture"
  : >"$fixture_dir/eslint-rules/fixture-rule.js"
  : >"$fixture_dir/scripts/sensor-fixture.ts"
  : >"$fixture_dir/scripts/doctor.sh"
  : >"$fixture_dir/scripts/lint-coverage-map-check.ts"
  : >"$fixture_dir/scripts/lint-ratchet/zero-baseline.ts"
  : >"$fixture_dir/scripts/codemods/fixture.ts"
  : >"$fixture_dir/scripts/drift-ai/fixture.ts"
  printf 'same\n' >"$fixture_dir/.claude/skills/fixture/SKILL.md"
  printf 'same\n' >"$fixture_dir/.codex/skills/fixture/SKILL.md"
  cat >"$fixture_dir/scripts/ai-hooks/README.md" <<'MD'
## Porting This

- `fixture-knob` — Retarget the fixture value.
- `bun-command-runner` — Retarget the fixture command runner.
- `repo-root-fallback` — Retarget the fixture shim repo-root fallback.
- `generated-surface-freshness` — Retarget the fixture generated-surface registry.
- `fixture-copy-manifest` — Retarget the fixture copy manifest.
- `verify-consumers` — Retarget the fixture verify consumers.
- `wrapped-bun-scripts` — Retarget the fixture wrapped-script classifier slices.
MD
  cat >"$fixture_dir/scripts/ai-hooks/common.sh" <<'SH'
# porting-knob: fixture-knob -- fixture source marker
SH
  printf '%s\n' \
    '!.claude/skills/fixture/' \
    '!.codex/skills/fixture/' \
    >"$fixture_dir/.gitignore"
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
    "lint:restricted-disable-rules": "bun run scripts/harness/generate-restricted-disable-rules.ts",
    "lint:restricted-disable-rules:check": "bun run scripts/harness/generate-restricted-disable-rules.ts -- --check",
    "lint:ratchet": "bun scripts/lint-ratchet.ts",
    "lint:ratchet:zero-baseline": "bun scripts/lint-ratchet.ts --zero-baseline",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:changed": "vitest related",
    "test:scripts": "bash scripts/test-scripts.sh",
    "test:scripts:changed": "bash scripts/test-scripts.sh --changed",
    "test:scripts:subjects": "bun run scripts/path-policy/generate-smoke-subjects.ts",
    "test:scripts:subjects:check": "bun run scripts/path-policy/generate-smoke-subjects.ts -- --check",
    "docs:lint-coverage-map:check": "bun scripts/lint-coverage-map-check.ts -- --check-eslint-reach",
    "docs:lint-coverage-map:generate": "bun run scripts/lint-coverage-map-gen.ts",
    "docs:lint-coverage-map:generate:check": "bun run scripts/lint-coverage-map-gen.ts -- --check",
    "docs:lint-guidance": "bun run scripts/generate-lint-guidance.ts",
    "docs:lint-guidance:check": "bun run scripts/generate-lint-guidance.ts -- --check",
    "docs:harness-controls": "bun run scripts/harness/generate-harness-controls.ts",
    "docs:harness-controls:check": "bun run scripts/harness/generate-harness-controls.ts -- --check",
    "docs:baseline-conflict-recipes": "bun run scripts/generate-baseline-conflict-recipes.ts",
    "docs:baseline-conflict-recipes:check": "bun run scripts/generate-baseline-conflict-recipes.ts -- --check",
    "harness:config-surfaces": "bun run scripts/harness/generate-config-surfaces.ts",
    "harness:config-surfaces:check": "bun run scripts/harness/generate-config-surfaces.ts -- --check",
    "harness:hook-timeouts": "bun run scripts/harness/generate-hook-timeout-constants.ts",
    "harness:hook-timeouts:check": "bun run scripts/harness/generate-hook-timeout-constants.ts -- --check",
    "harness:wiring": "bun run scripts/harness/generate-hook-wiring.ts",
    "harness:wiring:check": "bun run scripts/harness/generate-hook-wiring.ts -- --check",
    "format:check": "prettier --check .",
    "format:changed:check": "bash scripts/format-changed.sh --check",
    "verify": "bash scripts/verify.sh",
    "verify:changed": "bash scripts/verify.sh --changed",
    "verify:parallel": "bash scripts/verify.sh --parallel",
    "verify:steps": "bun run scripts/harness/generate-verify-steps.ts",
    "verify:steps:check": "bun run scripts/harness/generate-verify-steps.ts -- --check",
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
  # Representative near-duplicates boundary trigger: the pre-push scope pin
  # (scripts/harness/pre-push-scope-pin.ts) reads this alternation and compares
  # it against the copied scanner's BUILT_IN_SOURCE_EXTENSIONS (the fixture has
  # no drift-ai.config.json, so no additional extensions apply).
  cat >"$fixture_dir/.husky/pre-push" <<'SH'
#!/usr/bin/env bash
changed="fixture.ts"
if grep -qE '(^|/)(sensor-near-duplicates\.baseline|drift-ai\.config)\.json$|\.(ts|tsx|js|jsx|mjs|cjs)$' <<< "$changed"; then
  echo boundary-scan
fi
SH
  mkdir -p "$fixture_dir/.github/workflows"
  cat >"$fixture_dir/.github/workflows/ci.yml" <<'YAML'
jobs:
  validate:
    steps:
      # harness-ci-gate: verify-wrapper/verify
      - name: Verify
        run: bun run verify
YAML
}

write_generated_hook_files() {
  local fixture_dir=$1
  mkdir -p "$fixture_dir/.claude" "$fixture_dir/.codex" "$fixture_dir/.github/hooks"
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
  cat >"$fixture_dir/.github/hooks/copilot.json" <<'JSON'
{
  "version": 1,
  "hooks": {}
}
JSON
}

write_valid_manifest() {
  local fixture_dir=$1
  local extra_entries=${2-}
  cat >"$fixture_dir/harness.controls.json" <<JSON
{
  "scriptParityExemptions": ["lint:changed"],
  "ciGateControlIds": ["verify-wrapper/verify"],
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
      "source": "scripts/lint-ratchet/zero-baseline.ts",
      "invocation": "bun run lint:ratchet:zero-baseline"
    },
    {
      "id": "check/restricted-disable-rules-generator",
      "kind": "check",
      "category": "maintainability",
      "principle": "Restricted-disable generator fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/harness/generate-restricted-disable-rules.ts",
      "invocation": "bun run lint:restricted-disable-rules",
      "generatedSurface": {
        "triggerPaths": [
          "scripts/harness/generate-restricted-disable-rules.ts",
          "scripts/lint-ratchet/lint-ratchet-config.ts"
        ],
        "outputPaths": ["eslint-config/ratchet-restricted-disable-rules.generated.js"],
        "checkScript": "lint:restricted-disable-rules:check",
        "warnLabel": "restricted-disable rule metadata",
        "bunHook": { "refresh": "wrapped", "check": "wrapped" }
      }
    },
    {
      "id": "check/config-surface-generator",
      "kind": "check",
      "category": "maintainability",
      "principle": "Config surface generator fixture principle.",
      "pairedGuide": "none",
      "repairKind": "autofix",
      "source": "scripts/harness/generate-config-surfaces.ts",
      "invocation": "bun run harness:config-surfaces",
      "generatedSurface": {
        "triggerPaths": [
          "eslint-config/shared-policy.js",
          "scripts/harness/generate-config-surfaces.ts"
        ],
        "outputPaths": ["tsconfig.configs.json"],
        "checkScript": "harness:config-surfaces:check",
        "warnLabel": "config surface tsconfig",
        "bunHook": { "refresh": "wrapped", "check": "wrapped" }
      }
    },
    {
      "id": "check/hook-timeout-constants-generator",
      "kind": "check",
      "category": "maintainability",
      "principle": "Hook timeout constants generator fixture principle.",
      "pairedGuide": "none",
      "repairKind": "autofix",
      "source": "scripts/harness/generate-hook-timeout-constants.ts",
      "invocation": "bun run harness:hook-timeouts",
      "generatedSurface": {
        "triggerPaths": [
          "harness.controls.json",
          "scripts/harness/generate-hook-timeout-constants.ts",
          "scripts/harness/hook-timeout-constants.ts"
        ],
        "outputPaths": ["scripts/ai-hooks/hook-timeouts.generated.sh"],
        "checkScript": "harness:hook-timeouts:check",
        "warnLabel": "hook timeout constants",
        "bunHook": { "refresh": "bypass", "check": "wrapped" }
      }
    },
    {
      "id": "check/verify-steps-generator",
      "kind": "check",
      "category": "maintainability",
      "principle": "Verify steps generator fixture principle.",
      "pairedGuide": "none",
      "repairKind": "autofix",
      "source": "scripts/harness/generate-verify-steps.ts",
      "invocation": "bun run verify:steps",
      "generatedSurface": {
        "triggerPaths": [
          "harness.controls.json",
          "scripts/harness/generate-verify-steps.ts",
          "scripts/harness/generated-surfaces.ts",
          "scripts/harness/verify-step-schema.ts",
          "scripts/harness/verify-step-bridge-divergences.ts"
        ],
        "outputPaths": [
          "scripts/verify/steps.generated.sh",
          "scripts/harness/generated-surface-freshness.generated.sh",
          "scripts/ai-hooks/classified-bun-scripts.generated.sh"
        ],
        "checkScript": "verify:steps:check",
        "warnLabel": "verify step and generated-surface metadata",
        "bunHook": { "refresh": "bypass", "check": "wrapped" }
      }
    },
    {
      "id": "check/harness-hook-wiring-generator",
      "kind": "check",
      "category": "maintainability",
      "principle": "Hook wiring generator fixture principle.",
      "pairedGuide": "none",
      "repairKind": "autofix",
      "source": "scripts/harness/generate-hook-wiring.ts",
      "invocation": "bun run harness:wiring",
      "generatedSurface": {
        "triggerPaths": [
          "harness.controls.json",
          "scripts/harness/generate-hook-wiring.ts",
          "scripts/harness/hook-wiring-schema.ts"
        ],
        "outputPaths": [".claude/settings.json", ".codex/hooks.json", ".github/hooks/copilot.json"],
        "checkScript": "harness:wiring:check",
        "warnLabel": "AI hook wiring",
        "bunHook": { "refresh": "bypass", "check": "wrapped" }
      }
    },
    {
      "id": "check/smoke-subjects-generator",
      "kind": "check",
      "category": "maintainability",
      "principle": "Smoke subjects generator fixture principle.",
      "pairedGuide": "none",
      "repairKind": "autofix",
      "source": "scripts/path-policy/generate-smoke-subjects.ts",
      "invocation": "bun run test:scripts:subjects",
      "generatedSurface": {
        "triggerPaths": [
          "scripts/path-policy/generate-smoke-subjects.ts",
          "scripts/path-policy/smoke-subject-headers.ts",
          "scripts/path-policy/fixture-shell-dependencies.ts",
          "scripts/path-policy/fixture-shell-scope.ts",
          "scripts/tests/"
        ],
        "outputPaths": [
          "scripts/path-policy/path-policy-smoke-subjects-data.ts",
          "scripts/fixtures/test-scripts/all-smoke-tests.txt"
        ],
        "checkScript": "test:scripts:subjects:check",
        "warnLabel": "script smoke-subject metadata",
        "bunHook": { "refresh": "wrapped", "check": "wrapped" }
      }
    },
    {
      "id": "doc-generator/lint-coverage-map",
      "kind": "doc-generator",
      "category": "maintainability",
      "principle": "Lint coverage-map generated-block fixture principle.",
      "pairedGuide": "none",
      "repairKind": "autofix",
      "source": "scripts/lint-coverage-map-gen.ts",
      "invocation": "bun run docs:lint-coverage-map:generate",
      "generatedSurface": {
        "triggerPaths": [
          "eslint.config.js",
          "scripts/drift-ai/",
          "scripts/lint-coverage-map-gen-core.ts",
          "scripts/lint-coverage-map-gen.ts"
        ],
        "outputPaths": ["docs/generated/lint-coverage-map.md"],
        "checkScript": "docs:lint-coverage-map:generate:check",
        "warnLabel": "lint coverage-map generated block",
        "bunHook": { "refresh": "bypass", "check": "wrapped" }
      }
    },
    {
      "id": "doc-generator/lint-guidance",
      "kind": "doc-generator",
      "category": "maintainability",
      "principle": "Lint guidance doc generator fixture principle.",
      "pairedGuide": "none",
      "repairKind": "autofix",
      "source": "scripts/generate-lint-guidance.ts",
      "invocation": "bun run docs:lint-guidance",
      "generatedSurface": {
        "triggerPaths": [
          "eslint-rules/",
          "eslint-config/local-plugin.js",
          "scripts/generate-lint-guidance.ts",
          "scripts/lib/lint-rule-docs.ts"
        ],
        "outputPaths": ["docs/generated/local-lint-rules.md"],
        "checkScript": "docs:lint-guidance:check",
        "warnLabel": "lint guidance",
        "bunHook": { "refresh": "bypass", "check": "wrapped" }
      }
    },
    {
      "id": "doc-generator/harness-controls",
      "kind": "doc-generator",
      "category": "maintainability",
      "principle": "Harness controls doc generator fixture principle.",
      "pairedGuide": "none",
      "repairKind": "autofix",
      "source": "scripts/harness/generate-harness-controls.ts",
      "invocation": "bun run docs:harness-controls",
      "generatedSurface": {
        "triggerPaths": [
          "harness.controls.json",
          "scripts/harness/generate-harness-controls.ts",
          "scripts/harness/generate-harness-controls-validation.ts",
          "scripts/harness/control-field-validation.ts"
        ],
        "outputPaths": ["docs/generated/harness-controls.md"],
        "checkScript": "docs:harness-controls:check",
        "warnLabel": "harness controls docs",
        "bunHook": { "refresh": "bypass", "check": "wrapped" }
      }
    },
    {
      "id": "doc-generator/baseline-conflict-recipes",
      "kind": "doc-generator",
      "category": "maintainability",
      "principle": "Baseline conflict recipes doc generator fixture principle.",
      "pairedGuide": "none",
      "repairKind": "autofix",
      "source": "scripts/generate-baseline-conflict-recipes.ts",
      "invocation": "bun run docs:baseline-conflict-recipes",
      "generatedSurface": {
        "triggerPaths": [
          "scripts/git/baseline-merge-driver.sh",
          "scripts/generate-baseline-conflict-recipes.ts"
        ],
        "outputPaths": ["docs/guides/lint-ratchet-merges.md"],
        "checkScript": "docs:baseline-conflict-recipes:check",
        "warnLabel": "baseline conflict recovery recipes",
        "bunHook": { "refresh": "bypass", "check": "wrapped" }
      }
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
      "id": "skill/fixture",
      "kind": "skill",
      "category": "maintainability",
      "principle": "Skill mirror fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": ".claude/skills/fixture/SKILL.md",
      "invocation": "bun run test",
      "skillWiring": {
        "canonical": ".claude/skills/fixture",
        "targets": [
          {
            "harness": "claude",
            "path": ".claude/skills/fixture",
            "overlays": []
          },
          {
            "harness": "codex",
            "path": ".codex/skills/fixture",
            "overlays": []
          }
        ],
        "gitignoreOptIns": [
          "!.claude/skills/fixture/",
          "!.codex/skills/fixture/"
        ],
        "smokeSubjects": []
      }
    },
    {
      "id": "hook/ai-git-commit-quiet",
      "kind": "hook",
      "category": "maintainability",
      "principle": "Git commit quiet fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/ai-hooks/git-commit-quiet.sh",
      "invocation": "Claude PreToolUse Bash hook",
      "hookWiring": {
        "event": "PreToolUse",
        "body": "scripts/ai-hooks/git-commit-quiet.sh",
        "order": 20,
        "harnesses": {
          "claude": {
            "matcher": "Bash",
            "command": "bash \$CLAUDE_PROJECT_DIR/.claude/hooks/git-commit-quiet.sh",
            "timeout": 1260
          }
        },
        "notes": {
          "codex": "Fixture only.",
          "copilot": "Fixture only."
        }
      }
    },
    {
      "id": "hook/ai-bun-run-quiet",
      "kind": "hook",
      "category": "maintainability",
      "principle": "Bun run quiet fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/ai-hooks/bun-run-quiet.sh",
      "invocation": "Claude PreToolUse Bash hook",
      "hookWiring": {
        "event": "PreToolUse",
        "body": "scripts/ai-hooks/bun-run-quiet.sh",
        "order": 30,
        "harnesses": {
          "claude": {
            "matcher": "Bash",
            "command": "bash \$CLAUDE_PROJECT_DIR/.claude/hooks/bun-run-quiet.sh",
            "timeout": 1260
          }
        },
        "notes": {
          "codex": "Fixture only.",
          "copilot": "Fixture only."
        }
      }
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
  git -C "$fixture_dir" init -q
  git -C "$fixture_dir" add .
  (cd "$fixture_dir" && bun run docs:lint-coverage-map:generate >/dev/null)
  (cd "$fixture_dir" && bun run scripts/path-policy/generate-smoke-subjects.ts >/dev/null)
  (cd "$fixture_dir" && bun run scripts/harness/generate-verify-steps.ts >/dev/null)
  (cd "$fixture_dir" && bun run scripts/harness/generate-hook-timeout-constants.ts >/dev/null)
  (cd "$fixture_dir" && bun run scripts/harness/generate-config-surfaces.ts >/dev/null)
  (cd "$fixture_dir" && bun run scripts/harness/generate-hook-wiring.ts >/dev/null)
  (cd "$fixture_dir" && bun run scripts/generate-lint-guidance.ts >/dev/null)
  (cd "$fixture_dir" && bun run scripts/harness/generate-harness-controls.ts >/dev/null)
  (cd "$fixture_dir" && bun run scripts/harness/generate-restricted-disable-rules.ts >/dev/null)
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

mutate_pre_push_pin_drift() {
  local fixture_dir=$1
  # Drop .cjs from the boundary trigger alternation so the scope pin reports
  # the hook as out of sync with the scanner's source extensions.
  sed -i 's/|mjs|cjs)/|mjs)/' "$fixture_dir/.husky/pre-push"
}

mutate_pre_push_pin_missing_hook() {
  local fixture_dir=$1
  rm "$fixture_dir/.husky/pre-push"
}

mutate_stale_lint_coverage_map_block() {
  local fixture_dir=$1
  sed -i '/scripts\/drift-ai\/\*\.ts/s/| [0-9][0-9]* \.ts |/| 99 .ts |/' \
    "$fixture_dir/docs/generated/lint-coverage-map.md"
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

mutate_missing_ci_gate() {
  local fixture_dir=$1
  sed -i '/harness-ci-gate:/d' "$fixture_dir/.github/workflows/ci.yml"
}

mutate_extra_ci_gate() {
  local fixture_dir=$1
  cat >>"$fixture_dir/.github/workflows/ci.yml" <<'YAML'
      # harness-ci-gate: verify-wrapper/extra
      - name: Extra gate
        run: bun run verify:changed
YAML
}

mutate_renamed_ci_gate_script() {
  local fixture_dir=$1
  sed -i 's/run: bun run verify$/run: bun run verify:changed/' \
    "$fixture_dir/.github/workflows/ci.yml"
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

mutate_lint_invocation_rule_disabled() {
  local fixture_dir=$1
  cat >"$fixture_dir/eslint.config.js" <<'JS'
import local from "./local-plugin.js";

export default [{ plugins: { local } }];
JS
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

mutate_stale_dynamic_resolver_dispatch() {
  local fixture_dir=$1
  local generated_steps="$fixture_dir/scripts/verify/steps.generated.sh"

  grep -v "MUSI_VERIFY_DYNAMIC_RESOLVER_FUNC\\['staged-script-classifier'\\]" \
    "$generated_steps" > "$generated_steps.tmp"
  mv "$generated_steps.tmp" "$generated_steps"
}

mutate_stale_config_surfaces() {
  local fixture_dir=$1
  printf '\n' >> "$fixture_dir/tsconfig.configs.json"
}

mutate_stale_hook_wiring() {
  local fixture_dir=$1
  printf '\n' >> "$fixture_dir/.codex/hooks.json"
}

mutate_stale_copilot_hook_wiring() {
  local fixture_dir=$1
  printf '\n' >> "$fixture_dir/.github/hooks/copilot.json"
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
        "body": "scripts/ai-hooks/missing-body.sh",
        "order": 10,
        "harnesses": {
          "codex": {
            "matcher": "apply_patch",
            "command": "bash \"$(git rev-parse --show-toplevel)/.codex/hooks/missing-body.sh\"",
            "statusMessage": "Fixture hook"
          }
        },
        "notes": {
          "claude": "Fixture only.",
          "copilot": "Fixture only."
        }
      }
    }'
  (cd "$fixture_dir" && bun run scripts/harness/generate-hook-wiring.ts >/dev/null)
  (cd "$fixture_dir" && bun run scripts/harness/generate-harness-controls.ts >/dev/null)
}

mutate_bun_quiet_timeout_drift() {
  local fixture_dir=$1
  local script="$fixture_dir/scripts/ai-hooks/hook-timeouts.generated.sh"

  sed 's/^BUN_RUN_QUIET_HOOK_TIMEOUT=1260$/BUN_RUN_QUIET_HOOK_TIMEOUT=1300/' "$script" > "$script.tmp"
  mv "$script.tmp" "$script"
}

mutate_git_commit_quiet_timeout_drift() {
  local fixture_dir=$1
  local script="$fixture_dir/scripts/ai-hooks/hook-timeouts.generated.sh"

  sed 's/^GIT_COMMIT_QUIET_HOOK_TIMEOUT=1260$/GIT_COMMIT_QUIET_HOOK_TIMEOUT=1300/' "$script" > "$script.tmp"
  mv "$script.tmp" "$script"
}

mutate_stale_harness_docs() {
  local fixture_dir=$1
  printf 'stale\n' >> "$fixture_dir/docs/generated/harness-controls.md"
}

mutate_stale_lint_guidance() {
  local fixture_dir=$1
  printf 'stale\n' >> "$fixture_dir/docs/generated/local-lint-rules.md"
}

mutate_stale_restricted_disable_rules() {
  local fixture_dir=$1
  printf '// stale\n' >> "$fixture_dir/eslint-config/ratchet-restricted-disable-rules.generated.js"
}

mutate_alias_orphan_check_script() {
  local fixture_dir=$1
  # Drop the generatedSurface facet whose checkScript aliases
  # docs:baseline-conflict-recipes:check. The package.json script survives,
  # so script parity must flag it as undeclared — the failure mode that
  # protects the alias rule. Regenerate the facet-derived outputs and docs so
  # only the parity failure fires.
  jq 'del(.controls[] | select(.id == "doc-generator/baseline-conflict-recipes") | .generatedSurface)' \
    "$fixture_dir/harness.controls.json" >"$fixture_dir/harness.controls.json.tmp"
  mv "$fixture_dir/harness.controls.json.tmp" "$fixture_dir/harness.controls.json"
  (cd "$fixture_dir" && bun run scripts/harness/generate-verify-steps.ts >/dev/null)
  (cd "$fixture_dir" && bun run scripts/harness/generate-harness-controls.ts >/dev/null)
}

mutate_redundant_alias_exemption() {
  local fixture_dir=$1
  # Re-add an alias-covered :check twin to scriptParityExemptions — the
  # redundant-exemption guard must fail so the list cannot silently re-grow.
  jq '.scriptParityExemptions += ["verify:steps:check"]' \
    "$fixture_dir/harness.controls.json" >"$fixture_dir/harness.controls.json.tmp"
  mv "$fixture_dir/harness.controls.json.tmp" "$fixture_dir/harness.controls.json"
}

mutate_undocumented_porting_knob() {
  local fixture_dir=$1
  printf '%s\n' '# porting-knob: source-only -- undocumented fixture knob' \
    >>"$fixture_dir/scripts/ai-hooks/common.sh"
}

run_failure_checks() {
  run_failure_case "orphan-rule" "is not declared in the manifest" mutate_orphan_rule
  run_failure_case "undeclared-script" "not declared in harness.controls.json and not exempt" mutate_undeclared_script
  run_failure_case "undeclared-db-script" "db:undeclared" mutate_undeclared_db_script
  run_failure_case "missing-ci-gate" "CI has no harness-ci-gate marker" mutate_missing_ci_gate
  run_failure_case "extra-ci-gate" "ciGateControlIds does not declare it" mutate_extra_ci_gate
  run_failure_case "renamed-ci-gate" "expected manifest invocation" mutate_renamed_ci_gate_script
  run_failure_case "non-object-manifest-entry" "is not an object" mutate_non_object_manifest_entry
  run_failure_case "missing-source" "source does not resolve" mutate_missing_source
  run_failure_case "unknown-rule-name" "not registered in the local ESLint plugin" mutate_unknown_rule_name
  run_failure_case "unknown-invocation" "invocation references unknown package.json script" mutate_unknown_invocation
  run_failure_case "lint-invocation-rule-disabled" "claims normal ESLint coverage" mutate_lint_invocation_rule_disabled
  run_failure_case "unknown-repair-command" "repairCommand references unknown package.json script" mutate_codemod_unknown_repair_command
  run_failure_case "repair-command-bad-prefix" 'repairCommand must start with "bun run "' mutate_repair_command_bad_prefix
  run_failure_case "lint-restates-field" "must not restate category" mutate_lint_restates_field
  run_failure_case "paired-guide-missing" "pairedGuide does not resolve" mutate_paired_guide_missing
  run_failure_case "missing-ratchet-control" "Next steps:" mutate_missing_ratchet_control
  run_failure_case "stale-verify-steps" "steps.generated.sh is out of date" mutate_stale_verify_steps
  run_failure_case "stale-dynamic-resolver-dispatch" "steps.generated.sh is out of date" mutate_stale_dynamic_resolver_dispatch
  run_failure_case "stale-config-surfaces" "tsconfig.configs.json is out of date" mutate_stale_config_surfaces
  run_failure_case "stale-hook-wiring" "hooks.json" mutate_stale_hook_wiring
  run_failure_case "stale-copilot-hook-wiring" "copilot.json" mutate_stale_copilot_hook_wiring
  run_failure_case "missing-hook-body" "execs a missing body" mutate_missing_hook_body
  run_failure_case "bun-quiet-timeout-drift" "hook-timeouts.generated.sh is out of date" mutate_bun_quiet_timeout_drift
  run_failure_case "git-commit-quiet-timeout-drift" "hook-timeouts.generated.sh is out of date" mutate_git_commit_quiet_timeout_drift
  run_failure_case "stale-lint-guidance" "local-lint-rules.md is out of date" mutate_stale_lint_guidance
  run_failure_case "stale-harness-docs" "harness-controls.md is out of date" mutate_stale_harness_docs
  run_failure_case "stale-restricted-disable-rules" "ratchet-restricted-disable-rules.generated.js is out of date" mutate_stale_restricted_disable_rules
  run_failure_case "stale-lint-coverage-map-block" "lint-coverage-map.md is out of date" mutate_stale_lint_coverage_map_block
  run_failure_case "alias-orphan-check-script" \
    '"docs:baseline-conflict-recipes:check" matches the control-prefix convention' \
    mutate_alias_orphan_check_script
  run_failure_case "redundant-alias-exemption" \
    "already covered as a generatedSurface checkScript alias" \
    mutate_redundant_alias_exemption
  run_failure_case "undocumented-porting-knob" "source-only" mutate_undocumented_porting_knob
  run_failure_case "pre-push-pin-drift" \
    "near-duplicates boundary trigger is out of sync" mutate_pre_push_pin_drift
  run_failure_case "pre-push-pin-missing-hook" ".husky/pre-push could not be read" \
    mutate_pre_push_pin_missing_hook
}

run_conflict_marker_presentation_check() {
  local fixture_dir="$TMP_ROOT/conflict-marker"
  local stderr_path="$TMP_ROOT/conflict-marker.err"
  # Backticks are literal CLI guidance.
  # shellcheck disable=SC2016
  local expected='harness:check: eslint-config/max-lines-exceptions.baseline.json is generated; Git conflict markers mean its semantic merge driver was not installed. Run `bun run lint:max-lines-exceptions:install-merge-driver`, restore a parseable side with `bun run baseline:restore-stage -- --ours eslint-config/max-lines-exceptions.baseline.json` (always use stage 2/`--ours`; during rebase stage 2 is the upstream base, not the branch being rebased; if the markers were already committed, restore that side from a parent commit first), then reconcile entries from both sides and normalize with `bun run lint:max-lines-exceptions:update`; never hand-merge conflict markers in this file. Inspect the resulting baseline against both sides before staging; preserve any lower floor from the other side or explicitly accept the regression.'
  write_valid_fixture "$fixture_dir"
  printf '%s\n' \
    '<<<<<<< ours' \
    '{"version":2}' \
    '=======' \
    '{"version":2}' \
    '>>>>>>> theirs' \
    >"$fixture_dir/eslint-config/max-lines-exceptions.baseline.json"

  if (cd "$fixture_dir" && bun run scripts/harness-check.ts >"$TMP_ROOT/conflict-marker.out" 2>"$stderr_path"); then
    echo "FAIL: conflict-marker baseline unexpectedly passed harness:check"
    exit 1
  fi
  if [ "$(cat "$stderr_path")" != "$expected" ]; then
    echo "FAIL: conflict-marker baseline did not produce one clean harness error"
    cat "$stderr_path"
    exit 1
  fi
}

run_real_tree_check() {
  if ! bun run harness:check >"$TMP_ROOT/real.out" 2>&1; then
    echo "FAIL: real-tree harness:check rejected the current manifest"
    cat "$TMP_ROOT/real.out"
    exit 1
  fi
}

write_public_archive_listing() {
  git archive --worktree-attributes HEAD | tar -t >"$TMP_ROOT/public-archive.lst"
}

assert_archive_includes() {
  local path=$1
  if [ ! -e "$path" ]; then
    echo "FAIL: archive visibility path does not exist: $path"
    exit 1
  fi
  if ! grep -Fxq "$path" "$TMP_ROOT/public-archive.lst"; then
    echo "FAIL: public archive should include $path, but it is absent"
    exit 1
  fi
}

assert_archive_excludes() {
  local path=$1
  if [ ! -e "$path" ]; then
    echo "FAIL: archive privacy path does not exist: $path"
    exit 1
  fi
  if grep -Fxq "$path" "$TMP_ROOT/public-archive.lst"; then
    echo "FAIL: public archive should exclude $path, but it is present"
    exit 1
  fi
}

run_public_archive_boundary_check() {
  write_public_archive_listing
  assert_archive_includes ".claude/hooks/no-direct-db.sh"
  assert_archive_includes ".claude/settings.json"
  assert_archive_includes ".claude/output-styles/cadence.md"
  assert_archive_includes ".claude/skills/playwright-cli/SKILL.md"
  assert_archive_includes ".codex/hooks/pre-tool-use.sh"
  assert_archive_includes ".codex/hooks.json"
  assert_archive_includes ".codex/config.toml"
  assert_archive_includes ".codex/skills/ts-graph/SKILL.md"
  assert_archive_includes "docs/generated/lint-coverage-map.md"
  assert_archive_includes "docs/generated/observed_flaky_tests.md"
  assert_archive_excludes "docs/agent_notes/LOG.md"
}

run_pass_case
run_failure_checks
run_conflict_marker_presentation_check
run_real_tree_check
run_public_archive_boundary_check

echo "PASS: harness-check smoke"
