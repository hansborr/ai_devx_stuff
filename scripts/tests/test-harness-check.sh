#!/usr/bin/env bash
# smoke-order: 320
# smoke-subjects: scripts/harness-check.ts
# smoke-subjects: scripts/harness-registration-check.ts
# smoke-subjects: scripts/harness/registration-explain.ts
# smoke-subjects: scripts/harness/registration-explain-cli.ts
# smoke-subjects: scripts/harness/registration-explain-describe.ts
# smoke-subjects: scripts/harness/registration-explain-matchers.ts
# smoke-subjects: scripts/harness/registration-explain-model.ts
# smoke-subjects: scripts/harness/registration-explain-render.ts
# smoke-subjects: scripts/lint-agent-guidance.ts
# smoke-subjects: scripts/lint-coverage-map-gen.ts
# smoke-subjects: scripts/lint-coverage-map-gen-core.ts
# smoke-subjects: scripts/harness/control-field-validation.ts
# smoke-subjects: scripts/harness/harness-check-validation.ts
# smoke-subjects: scripts/harness/harness-gate-parity.ts
# smoke-subjects: scripts/doctor.sh
# smoke-subjects: scripts/harness/generated-surfaces.ts
# smoke-subjects: scripts/harness/generated-surface-dependencies.ts
# smoke-subjects: scripts/harness/hook-timeout-constants.ts
# smoke-subjects: scripts/harness/generate-hook-timeout-constants.ts
# smoke-subjects: scripts/harness/harness-manifest.ts
# smoke-subjects: scripts/harness/harness-manifest-schema.ts
# smoke-subjects: scripts/harness/harness-manifest-loader.ts
# smoke-subjects: scripts/harness/harness-paths.ts
# smoke-subjects: scripts/harness/porting-knob-parity.ts
# smoke-subjects: scripts/harness/porting-knob-parity.test.ts
# `.husky/pre-push` is still a harness:check input after the scope pin's removal:
# porting-knob-parity scans `.husky` for source markers and the hook/pre-push
# control declares it as its source, so edits there can still fail this smoke.
# smoke-subjects: .husky/pre-push
# smoke-subjects: scripts/harness/pre-push-scope-trigger.ts
# smoke-subjects: scripts/harness/generate-pre-push-scope-trigger.ts
# smoke-subjects: scripts/harness/pre-push-scope-trigger.generated.sh
# smoke-subjects: scripts/drift-ai/scope.ts
# smoke-subjects: scripts/lib/path-taxonomy.ts
# smoke-subjects: drift-ai.config.json
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
# smoke-subjects: scripts/path-policy/generate-smoke-subjects.ts
# smoke-subjects: scripts/path-policy/smoke-test-files.ts
# smoke-subjects: scripts/path-policy/smoke-subject-headers.ts
# smoke-subjects: scripts/path-policy/fixture-copy-expressions.ts
# smoke-subjects: scripts/path-policy/segment-pattern.ts
# smoke-subjects: scripts/path-policy/fixture-import-closure.ts
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
# smoke-subjects: scripts/verify/memory-wait-timeout.sh
# smoke-subjects: scripts/lib/codepoint-compare.ts
# smoke-subjects: scripts/lib/test-worker-count.sh
# smoke-subjects: scripts/lib/records.ts
# smoke-subjects: scripts/harness/verify-step-schema.ts
# smoke-subjects: scripts/harness/verify-step-programs.ts
# smoke-subjects: scripts/harness/verify-step-artifacts.ts
# smoke-subjects: scripts/harness/fixture-closure-check.ts
# smoke-subjects: scripts/import-closure/closure-walk.ts
# smoke-subjects: scripts/import-closure/runtime-imports.ts
# smoke-subjects: scripts/import-closure/runtime-resolution.ts
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
# - the generated pre-push boundary trigger fails freshness when the fixture's
#   checked-in fragment drifts from the scanner's source extensions;
# - generated smoke-subjects, verify step, hook-wiring, local lint guidance,
#   harness-controls doc, and restricted disable rule-list freshness fail when
#   their checked-in outputs are stale.
set -euo pipefail

cd "$(dirname "$0")/../.."

# The synthesized fixture manifest deliberately declares no
# generatedSurface.fixtureExtras and consumes the real tree's checked-in copy
# projection, so every copied generator and harness-check run below uses the
# explicit closure-walk permission. Declared fixtures still validate when the
# walker is available, and the later real-tree check explicitly removes this
# inherited variable. Everywhere else the validator fails closed on zero
# declarations (see scripts/harness/fixture-closure-check.ts).
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
  # static import graph plus reasoned generatedSurface fixtureExtras
  # (`bun run verify:steps` regenerates); harness:check's residue validator
  # keeps mechanical import echo out of the authored manifest.
  # Blank and `#` lines are manifest headers, not copy entries.
  while IFS= read -r copy_path; do
    case "$copy_path" in '' | '#'*) continue ;; esac
    mkdir -p "$fixture_dir/$(dirname "$copy_path")"
    # fixture-closure: unmodelled-copy - the copy set is the generated manifest
    # read line by line, so the fixture-copy-set checker cannot enumerate it
    # statically; scripts/harness/fixture-closure-check.ts walks the same
    # derived fixture projection over the real import graph instead.
    cp "$copy_path" "$fixture_dir/$copy_path"
  done <"$manifest_path"
  # This fixture's synthetic root config deliberately imports the focused
  # max-lines loader so the real-tree conflict-marker presentation contract is
  # still exercised after the shared policy split. These are fixture-only
  # dependencies, not dependencies of a generated surface.
  cp eslint-config/max-lines-exceptions-codec.js \
    "$fixture_dir/eslint-config/max-lines-exceptions-codec.js"
  cp eslint-config/max-lines-exceptions.baseline.json \
    "$fixture_dir/eslint-config/max-lines-exceptions.baseline.json"
  cp eslint-config/max-lines-policy.js "$fixture_dir/eslint-config/max-lines-policy.js"
  # Fixture-synthesized stub (FIXTURE_SYNTHESIZED_PATHS in
  # generated-surface-dependencies.ts):
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
  # scripts/import-closure/closure-walk.ts (the shared static-import-graph
  # walker, copied above) imports the TypeScript compiler at module load. The
  # smoke-subjects generator still walks its own fixture copy set, so the
  # fixture resolves the real package for that separate generator.
  [ -e "$fixture_dir/node_modules/typescript" ] || ln -s "$PWD/node_modules/typescript" "$fixture_dir/node_modules/typescript"
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
import "./eslint-config/max-lines-policy.js";
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
  # The smoke-subject generator runs against this fixture root, and an empty
  # scripts/tests tree is now a discovery failure rather than an empty
  # projection, so the fixture seeds one minimal smoke. This also keeps the
  # fixture an honest model of a real repo root. The header lines are printed
  # rather than heredoc'd so that no line of this file starts with a
  # smoke-subjects header the real repo's parser would attribute to this smoke.
  printf '%s\n' \
    '#!/usr/bin/env bash' \
    '# smoke-order: 010' \
    '# smoke-subjects: scripts/tests/test-fixture.sh' \
    'exit 0' \
    >"$fixture_dir/scripts/tests/test-fixture.sh"
  cat >"$fixture_dir/scripts/ai-hooks/README.md" <<'MD'
## Porting This

- `fixture-knob` — Retarget the fixture value.
- `bun-command-runner` — Retarget the fixture command runner.
- `repo-root-fallback` — Retarget the fixture shim repo-root fallback.
- `canonical-adapter-matcher` — Retarget the fixture adapter matcher syntax.
- `canonical-adapter-shim-dir` — Retarget the fixture adapter shim directories.
- `generated-surface-freshness` — Retarget the fixture generated-surface registry.
- `fixture-copy-manifest` — Retarget the fixture copy manifest.
- `verify-consumers` — Retarget the fixture verify consumers.
- `wrapped-bun-scripts` — Retarget the fixture wrapped-script classifier slices.
- `command-policy` — Retarget the fixture hard-deny rule set.
- `pre-push-scope-trigger` — Retarget the fixture near-duplicates boundary trigger.
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
    "harness:pre-push-trigger": "bun run scripts/harness/generate-pre-push-scope-trigger.ts",
    "harness:pre-push-trigger:check": "bun run scripts/harness/generate-pre-push-scope-trigger.ts -- --check",
    "harness:wiring": "bun run scripts/harness/generate-hook-wiring.ts",
    "harness:wiring:check": "bun run scripts/harness/generate-hook-wiring.ts -- --check",
    "harness:registration:check": "bun run scripts/harness-registration-check.ts",
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
musi_changed_gate_fail_if_unstaged "$REPO_ROOT" "pre-commit" || exit 1
musi_staged_has_source_relevant_change
MUSI_PRECOMMIT_REGISTRATION_TIMEOUT="${MUSI_PRECOMMIT_REGISTRATION_TIMEOUT:-$MUSI_GATE_PRECOMMIT_REGISTRATION_TIMEOUT_DEFAULT}"
case "$MUSI_PRECOMMIT_REGISTRATION_TIMEOUT" in
  '' | *[!0-9]* | 0*)
    printf 'pre-commit: invalid MUSI_PRECOMMIT_REGISTRATION_TIMEOUT=%s; expected positive whole seconds without a suffix or leading zero (for example, 30)\n' \
      "$MUSI_PRECOMMIT_REGISTRATION_TIMEOUT" >&2
    exit 2
    ;;
esac
musi_precommit_registration_admission() {
  timeout --foreground --signal=TERM --kill-after=1s \
    "${MUSI_PRECOMMIT_REGISTRATION_TIMEOUT}s" \
    bun run harness:registration:check
}
musi_precommit_snapshot_fast_mode() {
  local snapshot_rc
  if [ -f "$(musi_precommit_fast_marker)" ]; then
    MUSI_FAST_COMMIT_ENABLED_SNAPSHOT=1
    FAST_COMMIT_RECORD_PENDING=1
    snapshot_rc=0
  else
    MUSI_FAST_COMMIT_ENABLED_SNAPSHOT=0
    FAST_COMMIT_RECORD_PENDING=0
    snapshot_rc=1
  fi
  musi_warn_generated_surfaces_stale || true
  return "$snapshot_rc"
}
if [ "$MUSI_PRECOMMIT_ADMISSION_REACHABLE" -eq 1 ] \
   && [ "${MUSI_FAST_COMMIT_ENABLED_SNAPSHOT:-0}" -eq 1 ]; then
  echo suppress-overlapping-advisory
fi
REGISTRATION_ADMISSION_HOOK='musi_precommit_registration_admission'
declare -A PRECOMMIT_GATE_POLICY=(
  [pre_cache_admission_condition]='musi_precommit_snapshot_fast_mode'
  [pre_cache_admission_hook]="$REGISTRATION_ADMISSION_HOOK"
)
musi_verify_run_gate PRECOMMIT_GATE_POLICY
SH
  mkdir -p "$fixture_dir/.github/workflows"
  cat >"$fixture_dir/.github/workflows/ci.yml" <<'YAML'
jobs:
  validate:
    steps:
      - name: Install
        run: bun install
      - name: Verify
        env:
          HARNESS_CI_GATE: verify-wrapper/verify
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

# The generated lint-rule control include. The real tree owns `kind: lint-rule`
# controls here and nowhere else, and scripts/harness/harness-manifest.ts is the
# only seam that joins the two files — so this fixture carries an include too,
# and every validator and generator run below reads the ASSEMBLED manifest.
write_lint_rule_include() {
  local fixture_dir=$1
  local extra_entries=${2-}
  cat >"$fixture_dir/harness.controls.lint-rules.generated.json" <<JSON
{
  "\$comment": "Fixture stand-in for the generated lint-rule control include.",
  "controls": [
    {
      "id": "lint/local/fixture-rule",
      "kind": "lint-rule",
      "ruleName": "local/fixture-rule",
      "source": "eslint-rules/fixture-rule.js",
      "invocation": "bun run lint"
    }$extra_entries
  ]
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
  "verifySlotCatalog": [
    {
      "name": "lint",
      "full": { "script": "lint" },
      "changed": {
        "kind": "replace",
        "reason": "Changed mode lints changed files.",
        "slot": { "script": "lint:changed" }
      }
    },
    {
      "name": "ratchet",
      "full": { "script": "lint:ratchet" },
      "changed": { "kind": "inherit" }
    },
    {
      "name": "zero-baseline",
      "full": { "script": "lint:ratchet:zero-baseline" },
      "changed": { "kind": "inherit" }
    },
    {
      "name": "coverage-map",
      "full": { "script": "docs:lint-coverage-map:check" },
      "changed": { "kind": "inherit" }
    },
    {
      "name": "format-check",
      "full": { "script": "format:check" },
      "changed": {
        "kind": "replace",
        "reason": "Changed mode format-checks changed files.",
        "slot": { "script": "format:changed:check" }
      }
    },
    {
      "name": "typecheck",
      "full": { "script": "typecheck" },
      "changed": { "kind": "inherit" }
    },
    {
      "name": "test",
      "full": { "script": "test" },
      "changed": {
        "kind": "replace",
        "reason": "Changed mode selects tests from changed inputs.",
        "slot": { "script": "test:changed" }
      }
    },
    {
      "name": "scripts",
      "full": { "script": "test:scripts" },
      "changed": {
        "kind": "replace",
        "reason": "Changed mode classifies script-smoke inputs.",
        "slot": { "script": "test:scripts:changed" }
      }
    }
  ],
  "controls": [
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
          "eslint-config/path-glob-policy.js",
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
      "id": "check/pre-push-scope-trigger-generator",
      "kind": "check",
      "category": "maintainability",
      "principle": "Pre-push scope trigger generator fixture principle.",
      "pairedGuide": "none",
      "repairKind": "autofix",
      "source": "scripts/harness/generate-pre-push-scope-trigger.ts",
      "invocation": "bun run harness:pre-push-trigger",
      "generatedSurface": {
        "triggerPaths": [
          "drift-ai.config.json",
          "scripts/drift-ai/scope.ts",
          "scripts/harness/generate-pre-push-scope-trigger.ts",
          "scripts/harness/pre-push-scope-trigger.ts"
        ],
        "outputPaths": ["scripts/harness/pre-push-scope-trigger.generated.sh"],
        "checkScript": "harness:pre-push-trigger:check",
        "warnLabel": "pre-push near-duplicates scope trigger",
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
          "scripts/harness/verify-step-programs.ts",
          "scripts/harness/verify-step-schema.ts",
          "scripts/harness/verify-step-artifacts.ts"
        ],
        "outputPaths": [
          "scripts/verify/steps.generated.sh",
          "scripts/harness/generated-surface-freshness.generated.sh",
          "scripts/ai-hooks/classified-bun-scripts.generated.sh",
          "scripts/tests/harness-check-fixture-manifest.generated.txt"
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
      "id": "check/harness-registration-preflight",
      "kind": "check",
      "category": "maintainability",
      "principle": "Registration admission fixture principle.",
      "pairedGuide": "none",
      "repairKind": "manual",
      "source": "scripts/harness-registration-check.ts",
      "invocation": "bun run harness:registration:check"
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
          "local-plugin.js",
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
      "slotProfile": { "mode": "full" }
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
      "slotProfile": { "mode": "changed" }
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
      "slotProfile": { "mode": "full" }
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
        ]
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
        "surface": "bash",
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
        "surface": "bash",
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
      "slotProfile": {
        "mode": "changed",
        "overrides": [
          {
            "name": "scripts",
            "reason": "Pre-commit documents staged script-smoke inputs.",
            "slot": {
              "script": "test:scripts:changed",
              "condition": "when staged hook/script/harness inputs require script smoke"
            }
          }
        ]
      }
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
  write_lint_rule_include "$fixture_dir"
  git -C "$fixture_dir" init -q
  git -C "$fixture_dir" add .
  (cd "$fixture_dir" && bun run docs:lint-coverage-map:generate >/dev/null)
  (cd "$fixture_dir" && bun run scripts/path-policy/generate-smoke-subjects.ts >/dev/null)
  # verify-steps must consume the copied fixture projection, not derive it in
  # this reduced tree. Hide the walker dependency while the generator runs so
  # a future accidental derivation fails this smoke at the boundary.
  mv "$fixture_dir/node_modules/typescript" "$fixture_dir/node_modules/typescript.smoke-disabled"
  (cd "$fixture_dir" && bun run scripts/harness/generate-verify-steps.ts >/dev/null)
  mv "$fixture_dir/node_modules/typescript.smoke-disabled" "$fixture_dir/node_modules/typescript"
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
  # The lint-rule control reached both the validator and the doc generator
  # through the include seam, not the root manifest: it is authored in
  # harness.controls.lint-rules.generated.json only.
  if grep -q '"kind": "lint-rule"' "$fixture_dir/harness.controls.json"; then
    echo "FAIL: fixture root manifest still owns a lint-rule control"
    exit 1
  fi
  if ! grep -q "lint/local/fixture-rule" "$fixture_dir/docs/generated/harness-controls.md"; then
    echo "FAIL: generated harness controls doc lost the included lint-rule control"
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

mutate_pre_push_scope_trigger_drift() {
  local fixture_dir=$1
  # Drop .cjs from the generated boundary trigger so freshness reports the
  # checked-in fragment as stale against the scanner's source extensions.
  sed -i 's/|mjs|cjs)/|mjs)/' \
    "$fixture_dir/scripts/harness/pre-push-scope-trigger.generated.sh"
}

mutate_missing_registration_admission() {
  local fixture_dir=$1
  sed -i '/\[pre_cache_admission_hook\]/d' "$fixture_dir/.husky/pre-commit"
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
  sed -i '/HARNESS_CI_GATE:/d' "$fixture_dir/.github/workflows/ci.yml"
}

mutate_extra_ci_gate() {
  local fixture_dir=$1
  cat >>"$fixture_dir/.github/workflows/ci.yml" <<'YAML'
      - name: Extra gate
        env:
          HARNESS_CI_GATE: verify-wrapper/extra
        run: bun run verify:changed
YAML
}

mutate_unparseable_ci_workflow() {
  local fixture_dir=$1
  printf '    steps: [\n' >> "$fixture_dir/.github/workflows/ci.yml"
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
  write_lint_rule_include "$fixture_dir" ',
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
  # Replace the include's single lint-rule entry with one that restates
  # category — re-projected fields must not appear on lint-rule entries, and
  # the check must reach entries that arrive through the include seam.
  cat >"$fixture_dir/harness.controls.lint-rules.generated.json" <<'JSON'
{
  "controls": [
    {
      "id": "lint/local/fixture-rule",
      "kind": "lint-rule",
      "ruleName": "local/fixture-rule",
      "category": "behavior",
      "source": "eslint-rules/fixture-rule.js",
      "invocation": "bun run lint"
    }
  ]
}
JSON
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

mutate_dropped_lint_rule_include() {
  local fixture_dir=$1
  # The include is the only owner of lint-rule controls, so losing it must
  # surface as ordinary rule parity rather than as a silently smaller manifest.
  rm "$fixture_dir/harness.controls.lint-rules.generated.json"
}

mutate_malformed_lint_rule_include() {
  local fixture_dir=$1
  # An include that exists but carries no controls array is a hard error: a
  # tolerated one would drop every lint-rule control without a word.
  #
  # Deliberately kept alongside harness-manifest.test.ts's unit case for the
  # same branch: that case calls readHarnessManifest directly, while this one
  # is the only coverage that the parse-layer error reaches an operator through
  # `bun run harness:check` still naming the include, rather than surfacing
  # against harness.controls.json — the exact misdirection this branch had to
  # repair twice elsewhere (harness-check-validation.ts, doctor.sh, and the two
  # schema diagnostics in registration-manifest-checks.ts).
  printf '{"controls": {}}\n' >"$fixture_dir/harness.controls.lint-rules.generated.json"
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
        "surface": "edit",
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
  run_failure_case "missing-ci-gate" "no CI step carries HARNESS_CI_GATE" mutate_missing_ci_gate
  run_failure_case "unparseable-ci-workflow" "could not be parsed as YAML" \
    mutate_unparseable_ci_workflow
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
  run_failure_case "dropped-lint-rule-include" "local rule local/fixture-rule" \
    mutate_dropped_lint_rule_include
  run_failure_case "malformed-lint-rule-include" \
    "harness.controls.lint-rules.generated.json must declare a controls array" \
    mutate_malformed_lint_rule_include
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
  run_failure_case "pre-push-scope-trigger-drift" \
    "pre-push-scope-trigger.generated.sh is out of date" mutate_pre_push_scope_trigger_drift
  run_failure_case "missing-registration-admission" \
    "Restore the direct registration admission wiring" mutate_missing_registration_admission
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
  if ! env -u MUSI_HARNESS_CHECK_ALLOW_NO_FIXTURE_PATHS \
    bun run harness:check >"$TMP_ROOT/real.out" 2>&1; then
    echo "FAIL: real-tree harness:check rejected the current manifest"
    cat "$TMP_ROOT/real.out"
    exit 1
  fi
}

run_walkerless_declared_projection_check() {
  local fixture_dir="$TMP_ROOT/walkerless-declared"
  local projection="scripts/tests/harness-check-fixture-manifest.generated.txt"
  write_valid_fixture "$fixture_dir"
  jq '(.controls[] | select(.id == "check/verify-steps-generator") | .generatedSurface.fixtureExtras) = [
        {
          "path": "scripts/verify.sh",
          "reason": "Fully declared runtime file for the walker-less fixture."
        }
      ]' "$fixture_dir/harness.controls.json" >"$fixture_dir/harness.controls.next.json"
  mv "$fixture_dir/harness.controls.next.json" "$fixture_dir/harness.controls.json"
  printf '# stale projection\n' >"$fixture_dir/$projection"

  mv "$fixture_dir/node_modules/typescript" \
    "$fixture_dir/node_modules/typescript.smoke-disabled"
  if ! (cd "$fixture_dir" && bun run scripts/harness/generate-verify-steps.ts >/dev/null); then
    echo "FAIL: walker-less declared fixture projection did not generate"
    exit 1
  fi
  mv "$fixture_dir/node_modules/typescript.smoke-disabled" \
    "$fixture_dir/node_modules/typescript"

  if ! grep -Fxq "scripts/verify.sh" "$fixture_dir/$projection" || \
    grep -Fq "stale projection" "$fixture_dir/$projection"; then
    echo "FAIL: walker-less declarations did not produce the effective fixture projection"
    cat "$fixture_dir/$projection"
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
  assert_archive_includes ".codex/skills/playwright-cli/SKILL.md"
  assert_archive_includes "docs/generated/lint-coverage-map.md"
  assert_archive_includes "docs/generated/observed_flaky_tests.md"
  assert_archive_excludes "docs/agent_notes/LOG.md"
}

# Non-vacuity proof for the --explain provenance view: register a unique
# control, source path, package script, verify slot, and generated output that
# exist only in this fixture, then require every query direction to discover
# them from the live parsed registration state. The probe names appear in no
# production source or allowlist, so a discovery path that consulted one would
# fail each assertion here. After the probe is registered, the verify
# projections are regenerated inside the fixture: --explain refuses to report
# over a failing registration state, and the stale checked-in fragments would
# otherwise (correctly) trip that refusal — which the final direction proves.
assert_explain_reports() {
  local fixture_dir=$1
  local label=$2
  shift 2
  local needles=()
  while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do
    needles+=("$1")
    shift
  done
  [ "${1-}" = "--" ] && shift
  local out_path="$TMP_ROOT/explain-$label.out"
  if ! (cd "$fixture_dir" && bun run scripts/harness-registration-check.ts -- "$@" \
      >"$out_path" 2>"$TMP_ROOT/explain-$label.err"); then
    echo "FAIL: explain query $label exited non-zero"
    cat "$out_path" "$TMP_ROOT/explain-$label.err"
    exit 1
  fi
  local needle
  for needle in "${needles[@]}"; do
    if ! grep -Fq "$needle" "$out_path"; then
      echo "FAIL: explain query $label did not report: $needle"
      cat "$out_path"
      exit 1
    fi
  done
}

assert_explain_rejects() {
  local fixture_dir=$1
  local label=$2
  local needle=$3
  shift 3
  local err_path="$TMP_ROOT/explain-$label.err"
  if (cd "$fixture_dir" && bun run scripts/harness-registration-check.ts -- "$@" \
      >"$TMP_ROOT/explain-$label.out" 2>"$err_path"); then
    echo "FAIL: explain query $label exited zero over a failing registration state"
    cat "$TMP_ROOT/explain-$label.out" "$err_path"
    exit 1
  fi
  if ! grep -Fq "$needle" "$err_path"; then
    echo "FAIL: explain refusal $label did not name: $needle"
    cat "$err_path"
    exit 1
  fi
}

run_explain_provenance_check() {
  local fixture_dir="$TMP_ROOT/explain"
  write_valid_fixture "$fixture_dir"
  # The probe source imports a dependency that appears nowhere in the manifest,
  # so only the walked import closure can discover it; the .txt residue file is
  # declared via fixtureExtras like production reasoned residue.
  printf 'import "./explain-probe-dep.js";\n' >"$fixture_dir/scripts/explain-probe-source.ts"
  : >"$fixture_dir/scripts/explain-probe-dep.ts"
  printf 'probe residue\n' >"$fixture_dir/scripts/explain-probe-fixture.txt"
  mkdir -p "$fixture_dir/docs/generated"
  printf 'probe\n' >"$fixture_dir/docs/generated/explain-probe.generated.md"
  jq '.scripts["explain-probe:refresh"] = "bun run scripts/explain-probe-source.ts"
      | .scripts["explain-probe:check"] = "bun run scripts/explain-probe-source.ts -- --check"
      | .scripts["explain-probe:slot"] = "bash scripts/explain-probe-slot.sh"' \
    "$fixture_dir/package.json" >"$fixture_dir/package.json.tmp"
  mv "$fixture_dir/package.json.tmp" "$fixture_dir/package.json"
  jq '.verifySlotCatalog += [{
        "name": "explain-probe",
        "full": { "script": "explain-probe:slot" },
        "changed": { "kind": "inherit" }
      }]
      | .controls += [{
        "id": "check/explain-probe",
        "kind": "check",
        "category": "maintainability",
        "principle": "Explain probe fixture principle.",
        "pairedGuide": "none",
        "repairKind": "autofix",
        "source": "scripts/explain-probe-source.ts",
        "invocation": "bun run explain-probe:refresh",
        "generatedSurface": {
          "triggerPaths": ["scripts/explain-probe-source.ts"],
          "outputPaths": ["docs/generated/explain-probe.generated.md"],
          "checkScript": "explain-probe:check",
          "warnLabel": "explain probe metadata",
          "bunHook": { "refresh": "bypass", "check": "wrapped" },
          "fixtureExtras": [
            { "path": "scripts/explain-probe-fixture.txt", "reason": "Explain probe residue." }
          ]
        }
      }]' "$fixture_dir/harness.controls.json" >"$fixture_dir/harness.controls.json.tmp"
  mv "$fixture_dir/harness.controls.json.tmp" "$fixture_dir/harness.controls.json"
  # The probe control and slot stale the checked-in verify projections;
  # regenerate them so the positive queries run over a clean registration state.
  (cd "$fixture_dir" && bun run scripts/harness/generate-verify-steps.ts >/dev/null)

  # One process call per selector direction; unit tests own the per-relation
  # permutations. Control direction: the probe control resolves with its
  # generated surface, and the joined summary carries every unique fixture
  # artifact — the walked import dependency, the declared residue, and the
  # generated output — proving the real closure walker fed the report.
  assert_explain_reports "$fixture_dir" "control" \
    "control-id: check/explain-probe" \
    "generated check script: explain-probe:check" \
    "scripts/explain-probe-dep.ts" \
    "scripts/explain-probe-fixture.txt" \
    "docs/generated/explain-probe.generated.md" \
    -- --explain --control check/explain-probe
  # Path direction: the probe source is discovered as source and trigger.
  assert_explain_reports "$fixture_dir" "path-source" \
    "control-source: scripts/explain-probe-source.ts" \
    "generated-trigger: scripts/explain-probe-source.ts" \
    -- --explain --path scripts/explain-probe-source.ts
  # Script direction, through the JSON renderer so the executable's format
  # selection is exercised end to end: the fixture-only probe slot resolves
  # to its declared consumer.
  assert_explain_reports "$fixture_dir" "script-slot-json" \
    '"reason": "verify-slot"' \
    '"consumer": "verify-wrapper/verify"' \
    '"script": "explain-probe:slot"' \
    -- --explain --script explain-probe:slot --json
  # Smoke direction: the fixture-declared subject selects the fixture smoke.
  assert_explain_reports "$fixture_dir" "smoke-subject" \
    "smoke test: test-fixture (subject scripts/tests/test-fixture.sh)" \
    -- --explain --path scripts/tests/test-fixture.sh

  # Refusal direction: a registration failure fails --explain loudly, naming
  # the failure, instead of reporting authoritative-looking omissions.
  jq '(.controls[] | select(.id == "check/explain-probe")
        | .generatedSurface.checkScript) = "explain-probe:unregistered"' \
    "$fixture_dir/harness.controls.json" >"$fixture_dir/harness.controls.json.tmp"
  mv "$fixture_dir/harness.controls.json.tmp" "$fixture_dir/harness.controls.json"
  assert_explain_rejects "$fixture_dir" "refusal" "explain-probe:unregistered" \
    --explain --control check/explain-probe
}

run_pass_case
run_failure_checks
run_explain_provenance_check
run_conflict_marker_presentation_check
run_walkerless_declared_projection_check
run_real_tree_check
run_public_archive_boundary_check

echo "PASS: harness-check smoke"
