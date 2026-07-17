#!/usr/bin/env bash
# smoke-order: 330
# smoke-subjects: scripts/lint-agent.ts
# smoke-subjects: scripts/lint-agent-envelope.ts
# smoke-subjects: scripts/lint-agent-guidance.ts
# smoke-subjects: scripts/lib/lint-rule-docs.ts
# smoke-subjects: scripts/lib/eslint-main-cache.sh
# smoke-subjects: scripts/tests/test-lint-agent.sh
# smoke-subjects: packages/shared/src/schemas/harness-diagnostics.ts
# smoke-subjects: eslint.config.js
# smoke-subjects: eslint-config/
# smoke-subjects: eslint-rules/
# smoke-subjects: package.json
# smoke-subjects: tsconfig.scripts.json
# Smoke test for scripts/lint-agent.ts.
#
# Contract:
# - happy path emits a schema-valid envelope on a clean tree (zero findings, exit 0);
# - a known local-rule violation produces a finding with the expected control,
#   severity, repair kind, and how-to-fix, and the run exits 1;
# - overlaid core findings carry structured guidance;
# - non-overlaid findings are surfaced as info disclosures and counted in the
#   stderr summary.
set -euo pipefail

cd "$(dirname "$0")/../.."

REPO_ROOT="$(pwd)"
TMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/lint-agent-smoke-XXXXXX")
cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

build_fixture() {
  local fixture_dir=$1
  mkdir -p "$fixture_dir/scripts"
  mkdir -p "$fixture_dir/scripts/lib"
  mkdir -p "$fixture_dir/scripts/lint-ratchet"
  mkdir -p "$fixture_dir/packages/shared/src/schemas"
  cp scripts/lint-agent.ts "$fixture_dir/scripts/lint-agent.ts"
  cp scripts/lint-agent-envelope.ts "$fixture_dir/scripts/lint-agent-envelope.ts"
  cp scripts/lint-agent-fix-text.ts "$fixture_dir/scripts/lint-agent-fix-text.ts"
  cp scripts/lint-agent-guidance.ts "$fixture_dir/scripts/lint-agent-guidance.ts"
  cp scripts/lib/eslint-json.ts "$fixture_dir/scripts/lib/eslint-json.ts"
  cp scripts/lib/lint-rule-docs.ts "$fixture_dir/scripts/lib/lint-rule-docs.ts"
  cp scripts/lib/eslint-main-cache.sh "$fixture_dir/scripts/lib/eslint-main-cache.sh"
  cp scripts/lint-ratchet/local-rule-fix-text.ts \
    "$fixture_dir/scripts/lint-ratchet/local-rule-fix-text.ts"
  cp packages/shared/src/schemas/harness-diagnostics.ts \
    "$fixture_dir/packages/shared/src/schemas/harness-diagnostics.ts"
  ln -s "$REPO_ROOT/node_modules" "$fixture_dir/node_modules"
  ln -s "$REPO_ROOT/packages/shared/node_modules" "$fixture_dir/packages/shared/node_modules"

  cat >"$fixture_dir/local-plugin.js" <<'JS'
const violatingRule = ({ docs, message = "fixture diagnostic", suggest }) => ({
  meta: {
    type: "problem",
    docs,
    messages: { default: message },
    schema: [],
    ...(suggest === undefined ? {} : { hasSuggestions: true }),
  },
  create(context) {
    return {
      Program(node) {
        context.report({
          node,
          messageId: "default",
          ...(suggest === "concrete"
            ? {
                suggest: [
                  {
                    desc: "Use fixture replacement",
                    fix(fixer) {
                      return fixer.replaceText(node, "const replacement = 1;");
                    },
                  },
                ],
              }
            : {}),
        });
      },
    };
  },
});

export default {
  rules: {
    "always-flag-manual": violatingRule({
      docs: {
        description: "Manual repair fixture rule",
        principle: "Fixture principle for manual repair.",
        category: "behavior",
        pairedGuide: "docs/guides/local-eslint-rules.md",
        repairKind: "manual",
      },
    }),
    "always-flag-manual-how": violatingRule({
      message: "Why: fixture manual why. How to fix: Extract the fixture behavior into a helper.",
      docs: {
        description: "Manual repair fixture rule with rendered guidance",
        principle: "Fixture principle for manual guidance repair.",
        category: "behavior",
        pairedGuide: "docs/guides/local-eslint-rules.md",
        repairKind: "manual",
      },
    }),
    "always-flag-codemod": violatingRule({
      message:
        "Why: fixture codemod why. How to fix: Run `bun run codemod:fixture -- src/buggy.js`, then review the generated edit before committing.",
      docs: {
        description: "Codemod repair fixture rule",
        principle: "Fixture principle for codemod repair.",
        category: "maintainability",
        pairedGuide: "docs/guides/local-eslint-rules.md",
        repairKind: "codemod",
        repairCommand: "bun run codemod:fixture",
      },
    }),
    "always-flag-autofix": violatingRule({
      message:
        "Why: fixture autofix why. How to fix: Confirm the autofix preserved the behavior.",
      docs: {
        description: "Autofix repair fixture rule",
        principle: "Fixture principle for autofix repair.",
        category: "maintainability",
        pairedGuide: "docs/guides/local-eslint-rules.md",
        repairKind: "autofix",
      },
    }),
    "always-flag-suggestion": violatingRule({
      message: "Why: fixture suggestion why. How to fix: Use the visible suggestion.",
      suggest: "concrete",
      docs: {
        description: "Suggestion repair fixture rule",
        principle: "Fixture principle for suggestion repair.",
        category: "maintainability",
        pairedGuide: "docs/guides/local-eslint-rules.md",
        repairKind: "suggestion",
      },
    }),
    "always-flag-suggestion-fallback": violatingRule({
      message: "suggestion fallback diagnostic",
      docs: {
        description: "Suggestion repair fixture rule without a concrete visible suggestion",
        principle: "Fixture principle for suggestion fallback repair.",
        category: "maintainability",
        pairedGuide: "docs/guides/local-eslint-rules.md",
        repairKind: "suggestion",
      },
    }),
  },
};
JS

  cat >"$fixture_dir/eslint.config.js" <<'JS'
import local from "./local-plugin.js";

export default [
  {
    plugins: { local },
    rules: {
      "local/always-flag-manual": "error",
      "local/always-flag-manual-how": "error",
      "local/always-flag-codemod": "warn",
      "local/always-flag-autofix": "error",
      "local/always-flag-suggestion": "error",
      "local/always-flag-suggestion-fallback": "error",
      "complexity": ["error", { max: 1 }],
      "no-var": "error",
    },
  },
  {
    files: ["ratchet-only/**"],
    rules: {
      "local/always-flag-manual": "off",
      "local/always-flag-manual-how": "off",
      "local/always-flag-codemod": "off",
      "local/always-flag-autofix": "off",
      "local/always-flag-suggestion": "off",
      "local/always-flag-suggestion-fallback": "off",
      "complexity": "off",
      "no-var": "off",
      "max-lines-per-function": [
        "error",
        { max: 200, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  ...(process.env.MUSI_LINT_AGENT_STRUCTURAL_OVERLAY === "1"
    ? [
        {
          files: ["ratchet-only/**"],
          rules: {
            "max-depth": ["warn", { max: 3 }],
            "max-lines-per-function": [
              "warn",
              { max: 100, skipBlankLines: true, skipComments: true },
            ],
          },
        },
      ]
    : []),
];
JS

  mkdir -p "$fixture_dir/docs/guides"
  printf '# Local ESLint Rules Fixture\n' >"$fixture_dir/docs/guides/local-eslint-rules.md"
}

# --- Run 1: happy path on a clean target file ---------------------------------
CLEAN_DIR="$TMP_ROOT/clean"
build_fixture "$CLEAN_DIR"
# Empty TS file: no Program-violating tokens beyond the AST root, but the rule
# fires on Program, so we point lint-agent at a directory with no .ts files.
mkdir -p "$CLEAN_DIR/empty-src"
printf '// placeholder, no lint targets\n' >"$CLEAN_DIR/empty-src/README.md"

if ! (cd "$CLEAN_DIR" && bun run scripts/lint-agent.ts --output ./envelope.json empty-src/ \
      >"$TMP_ROOT/clean.out" 2>"$TMP_ROOT/clean.err"); then
  echo "FAIL: lint-agent clean run exited non-zero"
  cat "$TMP_ROOT/clean.err"
  exit 1
fi

CLEAN_JSON=$(cat "$CLEAN_DIR/envelope.json")
echo "$CLEAN_JSON" | bun -e '
  const fs = require("fs");
  const env = JSON.parse(fs.readFileSync(0, "utf8"));
  if (env.version !== "1") { console.error("bad version"); process.exit(1); }
  if (env.tool !== "lint:agent") { console.error("bad tool"); process.exit(1); }
  if (!Array.isArray(env.findings)) { console.error("findings not array"); process.exit(1); }
  if (env.findings.length !== 0) { console.error("expected zero findings"); process.exit(1); }
  if (env.summary.blocking !== 0 || env.summary.warning !== 0 || env.summary.info !== 0) {
    console.error("bad summary on clean run"); process.exit(1);
  }
'

# --- Run 1b: --output=path (equals form) must work the same as --output <path> -
# lint-agent.ts is invoked with both forms across the repo; the changed-file
# wrapper (lint:agent:local-rules:changed) emits --output=path when an agent
# passes the equals form. Without this assertion, a regression in either parser
# branch would only surface in the wrapper's non-empty path which the wrapper
# smoke can't exercise hermetically.
if ! (cd "$CLEAN_DIR" && bun run scripts/lint-agent.ts --output=./envelope-equals.json empty-src/ \
      >"$TMP_ROOT/clean-equals.out" 2>"$TMP_ROOT/clean-equals.err"); then
  echo "FAIL: lint-agent --output=path run exited non-zero"
  cat "$TMP_ROOT/clean-equals.err"
  exit 1
fi
[ -f "$CLEAN_DIR/envelope-equals.json" ] || {
  echo "FAIL: --output=path did not write envelope-equals.json"
  exit 1
}
diff -q "$CLEAN_DIR/envelope.json" "$CLEAN_DIR/envelope-equals.json" >/dev/null || {
  echo "FAIL: --output and --output= produced different envelopes"
  exit 1
}

# --- Run 1c: both forms reject a --prefixed path -------------------------------
# Symmetry: --output --foo and --output=--foo both look like an agent passed a
# bare flag instead of a path. Without this assertion the equals form would
# silently write to a file literally named "--foo" — surprising, and only
# detectable downstream when the path turns out to be unusable.
set +e
(cd "$CLEAN_DIR" && bun run scripts/lint-agent.ts --output --bogus empty-src/ \
   >"$TMP_ROOT/reject-space.out" 2>"$TMP_ROOT/reject-space.err")
status=$?
set -e
if [[ "$status" -eq 0 ]]; then
  echo "FAIL: --output --bogus should be rejected"
  exit 1
fi
grep -q "requires a path argument" "$TMP_ROOT/reject-space.err" || {
  echo "FAIL: space-form rejection missing expected error text"
  cat "$TMP_ROOT/reject-space.err"
  exit 1
}

set +e
(cd "$CLEAN_DIR" && bun run scripts/lint-agent.ts --output=--bogus empty-src/ \
   >"$TMP_ROOT/reject-equals.out" 2>"$TMP_ROOT/reject-equals.err")
status=$?
set -e
if [[ "$status" -eq 0 ]]; then
  echo "FAIL: --output=--bogus should be rejected"
  exit 1
fi
grep -q "requires a path argument" "$TMP_ROOT/reject-equals.err" || {
  echo "FAIL: equals-form rejection missing expected error text"
  cat "$TMP_ROOT/reject-equals.err"
  exit 1
}

# --- Run 2: known violations across all repair kinds --------------------------
VIO_DIR="$TMP_ROOT/violations"
build_fixture "$VIO_DIR"
mkdir -p "$VIO_DIR/src"
cat >"$VIO_DIR/src/buggy.js" <<'JS'
var nonLocalViolation = 1;
export function overlaidComplexity(value) {
  if (value) return nonLocalViolation;
  return 0;
}
export const value = nonLocalViolation;
JS

set +e
(cd "$VIO_DIR" && bun run scripts/lint-agent.ts --output ./envelope.json src/ \
   >"$TMP_ROOT/violations.out" 2>"$TMP_ROOT/violations.err")
status=$?
set -e
if [[ "$status" -ne 1 ]]; then
  echo "FAIL: expected exit 1 from blocking findings, got $status"
  cat "$TMP_ROOT/violations.err"
  exit 1
fi

VIO_JSON=$(cat "$VIO_DIR/envelope.json")
echo "$VIO_JSON" | bun -e '
  const fs = require("fs");
  const env = JSON.parse(fs.readFileSync(0, "utf8"));
  if (env.version !== "1") { console.error("bad version"); process.exit(1); }
  if (env.tool !== "lint:agent") { console.error("bad tool"); process.exit(1); }
  if (!Array.isArray(env.findings) || env.findings.length !== 8) {
    console.error("expected 8 findings, got", env.findings?.length); process.exit(1);
  }
  const localFindings = env.findings.filter((f) => f.control.startsWith("lint/local/"));
  if (localFindings.length !== 6) {
    console.error("expected 6 local findings, got", localFindings.length); process.exit(1);
  }
  const byControl = Object.fromEntries(env.findings.map((f) => [f.control, f]));
  const complexity = byControl["lint/complexity"];
  if (!complexity) { console.error("missing overlaid complexity finding"); process.exit(1); }
  if (complexity.severity !== "block") { console.error("complexity severity wrong"); process.exit(1); }
  if (complexity.ruleId !== "complexity") { console.error("complexity ruleId wrong"); process.exit(1); }
  if (complexity.messageId !== "complex") { console.error("complexity messageId wrong:", complexity.messageId); process.exit(1); }
  if (complexity.repairKind !== "manual") { console.error("complexity repairKind wrong"); process.exit(1); }
  if (!complexity.why.includes("Complex branching")) { console.error("complexity why wrong:", complexity.why); process.exit(1); }
  if (!complexity.howToFix.includes("Extract cohesive decisions")) { console.error("complexity howToFix wrong:", complexity.howToFix); process.exit(1); }

  const manual = byControl["lint/local/always-flag-manual"];
  if (!manual) { console.error("missing manual finding"); process.exit(1); }
  if (manual.severity !== "block") { console.error("manual severity wrong"); process.exit(1); }
  if (manual.repairKind !== "manual") { console.error("manual repairKind wrong"); process.exit(1); }
  if (manual.howToFix !== "fixture diagnostic. See docs/guides/local-eslint-rules.md.") { console.error("manual fallback howToFix wrong:", manual.howToFix); process.exit(1); }
  if (/Repair manually/.test(manual.howToFix)) { console.error("manual fallback leaked generic repair text:", manual.howToFix); process.exit(1); }
  if (manual.repairCommand !== undefined) { console.error("manual must not carry repairCommand"); process.exit(1); }

  const manualHow = byControl["lint/local/always-flag-manual-how"];
  if (!manualHow) { console.error("missing manual Why/How finding"); process.exit(1); }
  if (manualHow.howToFix !== "Extract the fixture behavior into a helper. See docs/guides/local-eslint-rules.md.") { console.error("manual Why/How tail wrong:", manualHow.howToFix); process.exit(1); }

  const codemod = byControl["lint/local/always-flag-codemod"];
  if (!codemod) { console.error("missing codemod finding"); process.exit(1); }
  if (codemod.severity !== "warn") { console.error("codemod severity wrong"); process.exit(1); }
  if (codemod.repairKind !== "codemod") { console.error("codemod repairKind wrong"); process.exit(1); }
  if (codemod.repairCommand !== "bun run codemod:fixture") { console.error("codemod repairCommand wrong"); process.exit(1); }
  if (codemod.howToFix !== "Run `bun run codemod:fixture -- src/buggy.js`, then review the generated edit before committing.") {
    console.error("codemod howToFix wrong:", codemod.howToFix); process.exit(1);
  }

  const autofix = byControl["lint/local/always-flag-autofix"];
  if (!autofix) { console.error("missing autofix finding"); process.exit(1); }
  if (autofix.repairKind !== "autofix") { console.error("autofix repairKind wrong"); process.exit(1); }
  if (autofix.howToFix !== "Confirm the autofix preserved the behavior.") {
    console.error("autofix howToFix wrong:", autofix.howToFix); process.exit(1);
  }

  const suggestion = byControl["lint/local/always-flag-suggestion"];
  if (!suggestion) { console.error("missing suggestion finding"); process.exit(1); }
  if (suggestion.repairKind !== "suggestion") { console.error("suggestion repairKind wrong"); process.exit(1); }
  if (suggestion.howToFix !== "Apply ESLint suggestion \"Use fixture replacement\": replace with `const replacement = 1;`.") {
    console.error("suggestion howToFix wrong:", suggestion.howToFix); process.exit(1);
  }

  const suggestionFallback = byControl["lint/local/always-flag-suggestion-fallback"];
  if (!suggestionFallback) { console.error("missing suggestion fallback finding"); process.exit(1); }
  if (suggestionFallback.howToFix !== "suggestion fallback diagnostic. See docs/guides/local-eslint-rules.md.") {
    console.error("suggestion fallback howToFix wrong:", suggestionFallback.howToFix); process.exit(1);
  }
  if (/Apply the ESLint suggestion|Repair manually/.test(suggestionFallback.howToFix)) {
    console.error("suggestion fallback leaked invisible repair text:", suggestionFallback.howToFix); process.exit(1);
  }

  const skippedNonLocal = byControl["lint/skipped-non-local"];
  if (!skippedNonLocal) { console.error("missing skipped non-local finding"); process.exit(1); }
  if (skippedNonLocal.severity !== "info") { console.error("skipped non-local severity wrong"); process.exit(1); }
  if (skippedNonLocal.ruleId !== "no-var") { console.error("skipped non-local ruleId wrong:", skippedNonLocal.ruleId); process.exit(1); }
  if (skippedNonLocal.path !== "src/buggy.js") { console.error("skipped non-local path wrong:", skippedNonLocal.path); process.exit(1); }
  if (skippedNonLocal.line !== 1) { console.error("skipped non-local line wrong:", skippedNonLocal.line); process.exit(1); }
  if (skippedNonLocal.repairKind !== "manual") { console.error("skipped non-local repairKind wrong"); process.exit(1); }
  if (skippedNonLocal.why !== "Non-local ESLint rule; no structured local-rule metadata is available.") {
    console.error("skipped non-local why wrong:", skippedNonLocal.why); process.exit(1);
  }
  if (skippedNonLocal.howToFix !== "Run `bun run lint` for the full ESLint report and fix this finding there.") {
    console.error("skipped non-local howToFix wrong:", skippedNonLocal.howToFix); process.exit(1);
  }

  if (env.summary.blocking !== 6) { console.error("blocking count wrong:", env.summary.blocking); process.exit(1); }
  if (env.summary.warning !== 1) { console.error("warning count wrong:", env.summary.warning); process.exit(1); }
  if (env.summary.info !== 1) { console.error("info count wrong:", env.summary.info); process.exit(1); }
  const byControlCounts = env.summary.byControl;
  if (byControlCounts["lint/complexity"] !== 1) { console.error("byControl complexity wrong"); process.exit(1); }
  if (byControlCounts["lint/local/always-flag-manual"] !== 1) { console.error("byControl manual wrong"); process.exit(1); }
  if (byControlCounts["lint/local/always-flag-manual-how"] !== 1) { console.error("byControl manual-how wrong"); process.exit(1); }
  if (byControlCounts["lint/local/always-flag-codemod"] !== 1) { console.error("byControl codemod wrong"); process.exit(1); }
  if (byControlCounts["lint/local/always-flag-autofix"] !== 1) { console.error("byControl autofix wrong"); process.exit(1); }
  if (byControlCounts["lint/local/always-flag-suggestion"] !== 1) { console.error("byControl suggestion wrong"); process.exit(1); }
  if (byControlCounts["lint/local/always-flag-suggestion-fallback"] !== 1) { console.error("byControl suggestion fallback wrong"); process.exit(1); }
  if (byControlCounts["lint/skipped-non-local"] !== 1) { console.error("byControl skipped non-local wrong"); process.exit(1); }
'

if ! grep -q "skipped 1 non-local finding" "$TMP_ROOT/violations.err"; then
  echo "FAIL: stderr did not mention the skipped non-local finding"
  cat "$TMP_ROOT/violations.err"
  exit 1
fi

# --- Run 3: ratchet-only structural thresholds surface as overlaid warnings ---
RATCHET_DIR="$TMP_ROOT/ratchet-threshold"
build_fixture "$RATCHET_DIR"
mkdir -p "$RATCHET_DIR/ratchet-only"
{
  printf 'export function overRatchetThreshold() {\n'
  for i in $(seq 1 100); do
    printf '  const value%s = %s;\n' "$i" "$i"
  done
  printf '  return value1;\n'
  printf '}\n'
} >"$RATCHET_DIR/ratchet-only/long-function.js"
cat >"$RATCHET_DIR/ratchet-only/deep-function.js" <<'JS'
export function overRatchetDepth(values) {
  if (values.length > 0) {
    while (values.length > 1) {
      for (const value of values) {
        if (value > 1) return value;
      }
    }
  }
  return 0;
}
JS

if ! (cd "$RATCHET_DIR" && bun run scripts/lint-agent.ts --output ./envelope.json ratchet-only/ \
      >"$TMP_ROOT/ratchet.out" 2>"$TMP_ROOT/ratchet.err"); then
  echo "FAIL: advisory ratchet-threshold finding should not make lint-agent exit non-zero"
  cat "$TMP_ROOT/ratchet.err"
  exit 1
fi

RATCHET_JSON=$(cat "$RATCHET_DIR/envelope.json")
echo "$RATCHET_JSON" | bun -e '
  const fs = require("fs");
  const env = JSON.parse(fs.readFileSync(0, "utf8"));
  if (env.findings.length !== 2) { console.error("expected 2 ratchet-threshold findings, got", env.findings.length); process.exit(1); }
  const byControl = Object.fromEntries(env.findings.map((finding) => [finding.control, finding]));
  const lines = byControl["lint/max-lines-per-function"];
  if (!lines) { console.error("missing max-lines-per-function finding"); process.exit(1); }
  if (lines.ruleId !== "max-lines-per-function") { console.error("bad max-lines ruleId:", lines.ruleId); process.exit(1); }
  if (lines.messageId !== "exceed") { console.error("bad max-lines messageId:", lines.messageId); process.exit(1); }
  if (lines.severity !== "warn") { console.error("max-lines finding must be warn:", lines.severity); process.exit(1); }
  if (!lines.why.includes("Long functions")) { console.error("bad max-lines why:", lines.why); process.exit(1); }
  if (!lines.howToFix.includes("Extract cohesive responsibilities")) { console.error("bad max-lines howToFix:", lines.howToFix); process.exit(1); }
  const depth = byControl["lint/max-depth"];
  if (!depth) { console.error("missing max-depth finding"); process.exit(1); }
  if (depth.ruleId !== "max-depth") { console.error("bad max-depth ruleId:", depth.ruleId); process.exit(1); }
  if (depth.messageId !== "tooDeeply") { console.error("bad max-depth messageId:", depth.messageId); process.exit(1); }
  if (depth.severity !== "warn") { console.error("max-depth finding must be warn:", depth.severity); process.exit(1); }
  if (!depth.why.includes("Deeply nested")) { console.error("bad max-depth why:", depth.why); process.exit(1); }
  if (!depth.howToFix.includes("Use guard clauses")) { console.error("bad max-depth howToFix:", depth.howToFix); process.exit(1); }
  if (env.summary.blocking !== 0 || env.summary.warning !== 2 || env.summary.info !== 0) {
    console.error("bad structural summary:", env.summary); process.exit(1);
  }
'

# --- Run 4: fatal parser errors surface as block-severity findings ------------
PARSER_DIR="$TMP_ROOT/parser-error"
build_fixture "$PARSER_DIR"
mkdir -p "$PARSER_DIR/src"
# Intentional syntax error: parse fails before any rule runs.
printf 'const = ;\n' >"$PARSER_DIR/src/broken.js"

set +e
(cd "$PARSER_DIR" && bun run scripts/lint-agent.ts --output ./envelope.json src/ \
   >"$TMP_ROOT/parser.out" 2>"$TMP_ROOT/parser.err")
status=$?
set -e
if [[ "$status" -ne 1 ]]; then
  echo "FAIL: parser error should exit 1, got $status"
  cat "$TMP_ROOT/parser.err"
  exit 1
fi

PARSER_JSON=$(cat "$PARSER_DIR/envelope.json")
echo "$PARSER_JSON" | bun -e '
  const fs = require("fs");
  const env = JSON.parse(fs.readFileSync(0, "utf8"));
  if (env.findings.length !== 1) { console.error("expected 1 parser finding, got", env.findings.length); process.exit(1); }
  const f = env.findings[0];
  if (f.control !== "lint/parser-error") { console.error("bad control:", f.control); process.exit(1); }
  if (f.severity !== "block") { console.error("parser error must be block"); process.exit(1); }
  if (f.repairKind !== "manual") { console.error("parser repairKind must be manual"); process.exit(1); }
  if (f.ruleId !== undefined) { console.error("parser finding must not carry ruleId"); process.exit(1); }
  if (!/Fix the syntax error/.test(f.howToFix)) { console.error("parser howToFix wrong:", f.howToFix); process.exit(1); }
  if (env.summary.blocking !== 1) { console.error("summary blocking wrong"); process.exit(1); }
'

# --- Run 5: the agent envelope uses the salted, self-invalidating main cache --
# lint-agent must derive its cache args from scripts/lib/eslint-main-cache.sh
# so a change to any salt input (here: a new TS source that is a type-graph
# input but not itself linted) moves the cache identity, exactly as it does for
# the main lint lane. The old unsalted node_modules/.cache/eslint/ location
# would have served pre-change findings. An isolated cache root keeps the
# fixture from pruning the real repo's shared eslint-main cache.
SALT_DIR="$TMP_ROOT/salt"
build_fixture "$SALT_DIR"
SALT_CACHE_ROOT="$TMP_ROOT/salt-cache"
mkdir -p "$SALT_DIR/ratchet-only"
# ratchet-only disables the always-flag rules, so this file lints clean (exit 0)
# yet is still linted, which is what makes ESLint persist the cache entry. The
# fixture flat config lints .js (not .ts), so the linted target is .js.
printf 'export const ratchetOk = 1;\n' >"$SALT_DIR/ratchet-only/ok.js"

run_salt_agent() {
  (cd "$SALT_DIR" && MUSI_ESLINT_MAIN_CACHE_ROOT="$SALT_CACHE_ROOT" \
    bun run scripts/lint-agent.ts --output ./envelope.json ratchet-only/ \
    >"$TMP_ROOT/salt.out" 2>"$TMP_ROOT/salt.err")
}

count_identity_dirs() {
  find "$SALT_CACHE_ROOT" -mindepth 1 -maxdepth 1 -type d -name 'identity-*' 2>/dev/null | wc -l
}

if ! run_salt_agent; then
  echo "FAIL: salted-cache run 1 exited non-zero"
  cat "$TMP_ROOT/salt.err"
  exit 1
fi

if [ "$(count_identity_dirs)" -ne 1 ]; then
  echo "FAIL: expected exactly one salted identity-* cache dir after run 1"
  find "$SALT_CACHE_ROOT" 2>/dev/null || true
  exit 1
fi
IDENTITY_BEFORE=$(find "$SALT_CACHE_ROOT" -mindepth 1 -maxdepth 1 -type d -name 'identity-*')
if [ ! -f "$IDENTITY_BEFORE/.eslintcache" ]; then
  echo "FAIL: agent did not write the salted .eslintcache under $IDENTITY_BEFORE"
  find "$SALT_CACHE_ROOT" 2>/dev/null || true
  exit 1
fi

# Change a salt input that is NOT the linted file: a new TS source in the type
# graph. ESLint's own per-file metadata/config hash never looks at it (the
# fixture never even lints .ts), so only the salt catches this. The identity
# must move and the stale sibling be pruned.
printf 'export const extraTypeGraphInput = 2;\n' >"$SALT_DIR/extra-source.ts"

if ! run_salt_agent; then
  echo "FAIL: salted-cache run 2 exited non-zero"
  cat "$TMP_ROOT/salt.err"
  exit 1
fi

IDENTITY_AFTER=$(find "$SALT_CACHE_ROOT" -mindepth 1 -maxdepth 1 -type d -name 'identity-*')
if [ "$IDENTITY_AFTER" = "$IDENTITY_BEFORE" ]; then
  echo "FAIL: a salt-input change did not move the agent cache identity"
  exit 1
fi
if [ "$(count_identity_dirs)" -ne 1 ]; then
  echo "FAIL: stale salted identity dir was not pruned after the salt-input change"
  find "$SALT_CACHE_ROOT" 2>/dev/null || true
  exit 1
fi

echo "PASS: lint-agent smoke"
