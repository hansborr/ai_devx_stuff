#!/usr/bin/env bash
# Smoke test for scripts/lint-ratchet.ts.
#
# Covers the real committed baseline plus fixture regressions, update refusal,
# check-baseline validation, and strict improvement failures.
set -euo pipefail

cd "$(dirname "$0")/.."

REPO_ROOT="$(pwd)"
TMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/lint-ratchet-smoke-XXXXXX")
cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

assert_usage_failure() {
  local description=$1
  local expected_substring=$2
  shift 2
  local err status
  set +e
  err=$(bun run scripts/lint-ratchet.ts "$@" 2>&1 >/dev/null)
  status=$?
  set -e
  [ "$status" -eq 2 ] || fail "$description: expected exit 2, got $status (stderr: $err)"
  grep -qF -- "$expected_substring" <<< "$err" \
    || fail "$description: stderr missing '$expected_substring': $err"
}

assert_envelope() {
  local file=$1
  local expected_blocking=$2
  # bun -e strips `--`, so positional args after it land back-to-back in
  # process.argv with no consistent index. Pass through env vars instead so
  # the smoke does not depend on bun's argv convention.
  ASSERT_FILE="$file" ASSERT_BLOCKING="$expected_blocking" bun -e '
    const fs = require("fs");
    const env = JSON.parse(fs.readFileSync(process.env.ASSERT_FILE, "utf8"));
    const expectedBlocking = Number(process.env.ASSERT_BLOCKING);
    if (env.version !== "1") throw new Error("bad version");
    if (env.tool !== "lint:ratchet") throw new Error(`bad tool ${env.tool}`);
    if (!Array.isArray(env.findings)) throw new Error("findings not array");
    if (env.summary.blocking !== expectedBlocking) {
      throw new Error(`blocking expected ${expectedBlocking}, got ${env.summary.blocking}`);
    }
  ' || fail "invalid lint-ratchet envelope: $file"
}

build_fixture() {
  local fixture_dir=$1
  mkdir -p "$fixture_dir/scripts" "$fixture_dir/packages/shared/src/schemas"
  mkdir -p "$fixture_dir/eslint-rules" "$fixture_dir/docs/guides"
  cp scripts/lint-ratchet.ts "$fixture_dir/scripts/lint-ratchet.ts"
  cp scripts/lint-ratchet-config.ts "$fixture_dir/scripts/lint-ratchet-config.ts"
  cp scripts/lint-ratchet-baseline-compare.ts \
    "$fixture_dir/scripts/lint-ratchet-baseline-compare.ts"
  cp scripts/lint-ratchet-baseline-parse.ts \
    "$fixture_dir/scripts/lint-ratchet-baseline-parse.ts"
  cp scripts/lint-ratchet-baseline.ts "$fixture_dir/scripts/lint-ratchet-baseline.ts"
  cp scripts/lint-ratchet-check-registry.ts \
    "$fixture_dir/scripts/lint-ratchet-check-registry.ts"
  cp scripts/lint-ratchet-metrics.ts "$fixture_dir/scripts/lint-ratchet-metrics.ts"
  cp scripts/lint-ratchet-output.ts "$fixture_dir/scripts/lint-ratchet-output.ts"
  cp scripts/lint-ratchet-report.ts "$fixture_dir/scripts/lint-ratchet-report.ts"
  cp scripts/lint-ratchet-summary.ts "$fixture_dir/scripts/lint-ratchet-summary.ts"
  cp scripts/lint-rule-docs.ts "$fixture_dir/scripts/lint-rule-docs.ts"
  cp packages/shared/src/schemas/harness-diagnostics.ts \
    "$fixture_dir/packages/shared/src/schemas/harness-diagnostics.ts"
  cp eslint-rules/type-assertion-boundary.js \
    "$fixture_dir/eslint-rules/type-assertion-boundary.js"
  cp eslint-rules/max-lines.js "$fixture_dir/eslint-rules/max-lines.js"
  ln -s "$REPO_ROOT/node_modules" "$fixture_dir/node_modules"
  ln -s "$REPO_ROOT/packages/shared/node_modules" "$fixture_dir/packages/shared/node_modules"

  cat >"$fixture_dir/package.json" <<'JSON'
{
  "name": "lint-ratchet-fixture",
  "private": true,
  "type": "module"
}
JSON

  write_fixture_tsconfig "$fixture_dir"

  cat >"$fixture_dir/eslint.config.js" <<'JS'
import maxLines from "./eslint-rules/max-lines.js";
import typeAssertionBoundary from "./eslint-rules/type-assertion-boundary.js";

export default [
  {
    plugins: {
      local: {
        rules: {
          "max-lines": maxLines,
          "type-assertion-boundary": typeAssertionBoundary,
        },
      },
    },
  },
];
JS

  printf '# Local ESLint Rules Fixture\n' >"$fixture_dir/docs/guides/local-eslint-rules.md"
  printf '# Lint Ratchet Fixture\n' >"$fixture_dir/docs/guides/lint-ratchet.md"
}

assert_generated_config_matches_expected() {
  local actual_file=$1
  local expected_template=$2
  ACTUAL_FILE="$actual_file" EXPECTED_TEMPLATE="$expected_template" \
    REPO_ROOT="$REPO_ROOT" bun -e '
      const fs = require("fs");
      const { pathToFileURL } = require("url");
      const expected = fs
        .readFileSync(process.env.EXPECTED_TEMPLATE, "utf8")
        .replaceAll("%REPO_ROOT_FILE_URL%", pathToFileURL(process.env.REPO_ROOT).href);
      const actual = fs.readFileSync(process.env.ACTUAL_FILE, "utf8");
      if (actual !== expected) {
        throw new Error(`generated config drifted for ${process.env.ACTUAL_FILE}`);
      }
    ' || fail "generated config drifted: $actual_file"
}

assert_local_identity_regression() {
  local max_key="04f2e06f57af"
  local type_key="02e6d4270880"
  local config_root="$REPO_ROOT/node_modules/.cache/eslint-ratchet/configs"
  local max_config="$config_root/ratchet-local-max-lines-$max_key.mjs"
  local type_config="$config_root/ratchet-local-type-assertion-boundary-$type_key.mjs"
  [ -f "$max_config" ] \
    || fail "local max-lines cache key changed or config missing: $max_config"
  [ -f "$type_config" ] \
    || fail "local type-assertion cache key changed or config missing: $type_config"
  [ -f "$REPO_ROOT/node_modules/.cache/eslint-ratchet/ratchet-local-max-lines-$max_key/.eslintcache" ] \
    || fail "local max-lines eslint cache path changed"
  [ -f "$REPO_ROOT/node_modules/.cache/eslint-ratchet/ratchet-local-type-assertion-boundary-$type_key/.eslintcache" ] \
    || fail "local type-assertion eslint cache path changed"
  assert_generated_config_matches_expected "$max_config" \
    "$REPO_ROOT/scripts/test-fixtures/lint-ratchet/expected-local-max-lines.config.mjs"
  assert_generated_config_matches_expected "$type_config" \
    "$REPO_ROOT/scripts/test-fixtures/lint-ratchet/expected-local-type-assertion-boundary.config.mjs"
}

use_fixture_node_modules_with_fake_plugin() {
  local fixture_dir=$1
  rm "$fixture_dir/node_modules"
  mkdir -p "$fixture_dir/node_modules/eslint-plugin-ratchet-fixture"
  ln -s "$REPO_ROOT/node_modules/.bin" "$fixture_dir/node_modules/.bin"
  ln -s "$REPO_ROOT/node_modules/typescript-eslint" \
    "$fixture_dir/node_modules/typescript-eslint"

  cat >"$fixture_dir/node_modules/eslint-plugin-ratchet-fixture/package.json" <<'JSON'
{
  "name": "eslint-plugin-ratchet-fixture",
  "version": "1.0.0",
  "type": "module",
  "main": "index.js"
}
JSON

  cat >"$fixture_dir/node_modules/eslint-plugin-ratchet-fixture/index.js" <<'JS'
const alwaysReport = {
  meta: {
    type: "problem",
    schema: [],
    messages: { found: "fixture third-party finding" },
  },
  create(context) {
    return {
      Program(node) {
        context.report({ node, messageId: "found" });
      },
    };
  },
};

const noFixtureMarker = {
  meta: {
    type: "problem",
    schema: [],
    messages: { found: "fixture marker finding" },
  },
  create(context) {
    return {
      Identifier(node) {
        if (node.name === "fixtureViolation") {
          context.report({ node, messageId: "found" });
        }
      },
    };
  },
};

export default {
  rules: {
    "always-report": alwaysReport,
    "no-fixture-marker": noFixtureMarker,
  },
};
JS
}

write_fixture_tsconfig() {
  local fixture_dir=$1
  cat >"$fixture_dir/tsconfig.json" <<'JSON'
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "noEmit": true,
    "strict": true,
    "target": "ES2022"
  },
  "include": ["packages/**/*.ts"]
}
JSON
}

write_third_party_config() {
  local fixture_dir=$1
  local rule_name=$2
  local parser_profile=$3
  local allowlist=${4-allowlisted}
  local rule_id=${5-"ratchet-fixture/$rule_name"}
  local plugin_module=${6-"eslint-plugin-ratchet-fixture"}
  local plugin_export=${7-}
  local rule_options=${8-"[]"}
  local rule_namespace=${9-"ratchet-fixture"}
  local plugin_export_line=""
  if [ -n "$plugin_export" ]; then
    plugin_export_line="    pluginExport: \"$plugin_export\","
  fi
  local allowlist_entries="[]"
  if [ "$allowlist" = "allowlisted" ]; then
    allowlist_entries="[
  {
    pluginModule: \"$plugin_module\",
    ruleNamespace: \"$rule_namespace\",
$plugin_export_line
  },
]"
  fi

  cat >"$fixture_dir/scripts/lint-ratchet-config.ts" <<TS
type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;

export type LintRatchetMode = "no-new" | "ratchet-down" | "report-only";
export type LintRatchetMetric = "message-count";
type LintRatchetRepairKind = "manual";
export type LintRatchetParserProfile = "minimal-ts" | "type-aware-ts";
export type LintRatchetPluginExport = "default" | "plugin";

export interface LintRatchetLocalSource {
  readonly kind: "local";
}

export interface LintRatchetThirdPartySource {
  readonly kind: "third-party";
  readonly pluginModule: string;
}

export type LintRatchetRuleSource =
  | LintRatchetLocalSource
  | LintRatchetThirdPartySource;

interface LintRatchetConfigBase {
  readonly id: string;
  readonly ruleId: string;
  readonly files: readonly string[];
  readonly ignores: readonly string[];
  readonly ruleOptions: readonly JsonValue[];
  readonly mode: LintRatchetMode;
  readonly target: number;
  readonly metric: LintRatchetMetric;
  readonly repairKind: LintRatchetRepairKind;
}

export type LintRatchetConfig =
  | (LintRatchetConfigBase & {
      readonly source?: LintRatchetLocalSource;
      readonly parserProfile?: "minimal-ts";
    })
  | (LintRatchetConfigBase & {
      readonly source: LintRatchetThirdPartySource;
      readonly parserProfile: LintRatchetParserProfile;
    });

export interface LintRatchetThirdPartyPluginAllowlistEntry {
  readonly pluginModule: string;
  readonly ruleNamespace: string;
  readonly pluginExport?: LintRatchetPluginExport;
}

export const lintRatchetThirdPartyPluginAllowlist: readonly LintRatchetThirdPartyPluginAllowlistEntry[] =
  $allowlist_entries;

export const lintRatchets = [
  {
    id: "ratchet/fixture-third-party",
    ruleId: "$rule_id",
    files: ["packages/app/src/**/*.ts"],
    ignores: ["**/dist/**", "**/generated/**", "**/node_modules/**"],
    ruleOptions: $rule_options,
    source: {
      kind: "third-party",
      pluginModule: "$plugin_module",
    },
    parserProfile: "$parser_profile",
    mode: "no-new",
    target: 0,
    metric: "message-count",
    repairKind: "manual",
  },
] as const satisfies readonly LintRatchetConfig[];
TS
}

write_core_config() {
  local fixture_dir=$1
  local rule_id=${2-"complexity"}
  local parser_profile=${3-"minimal-ts"}
  local rule_options=${4-"[{ max: 1 }]"}
  local metric=${5-"message-count"}

  cat >"$fixture_dir/scripts/lint-ratchet-config.ts" <<TS
type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;

export type LintRatchetMode = "no-new" | "ratchet-down" | "report-only";
export type LintRatchetMetric = "message-count" | "complexity-severity";
type LintRatchetRepairKind = "manual";
export type LintRatchetParserProfile = "minimal-ts" | "type-aware-ts";
export type LintRatchetPluginExport = "default" | "plugin";

export interface LintRatchetLocalSource {
  readonly kind: "local";
}

export interface LintRatchetThirdPartySource {
  readonly kind: "third-party";
  readonly pluginModule: string;
}

export interface LintRatchetCoreSource {
  readonly kind: "core";
}

export type LintRatchetRuleSource =
  | LintRatchetLocalSource
  | LintRatchetThirdPartySource
  | LintRatchetCoreSource;

interface LintRatchetConfigBase {
  readonly id: string;
  readonly ruleId: string;
  readonly files: readonly string[];
  readonly ignores: readonly string[];
  readonly ruleOptions: readonly JsonValue[];
  readonly mode: LintRatchetMode;
  readonly target: number;
  readonly metric: LintRatchetMetric;
  readonly repairKind: LintRatchetRepairKind;
}

export type LintRatchetConfig =
  | (LintRatchetConfigBase & {
      readonly source?: LintRatchetLocalSource;
      readonly parserProfile?: "minimal-ts";
    })
  | (LintRatchetConfigBase & {
      readonly source: LintRatchetThirdPartySource;
      readonly parserProfile: LintRatchetParserProfile;
    })
  | (LintRatchetConfigBase & {
      readonly source: LintRatchetCoreSource;
      readonly parserProfile: LintRatchetParserProfile;
    });

export interface LintRatchetThirdPartyPluginAllowlistEntry {
  readonly pluginModule: string;
  readonly ruleNamespace: string;
  readonly pluginExport?: LintRatchetPluginExport;
}

export const lintRatchetThirdPartyPluginAllowlist: readonly LintRatchetThirdPartyPluginAllowlistEntry[] =
  [];

export const lintRatchets = [
  {
    id: "ratchet/fixture-core",
    ruleId: "$rule_id",
    files: ["packages/app/src/**/*.ts"],
    ignores: ["**/dist/**", "**/generated/**", "**/node_modules/**"],
    ruleOptions: $rule_options,
    source: { kind: "core" },
    parserProfile: "$parser_profile",
    mode: "no-new",
    target: 0,
    metric: "$metric",
    repairKind: "manual",
  },
] as const satisfies readonly LintRatchetConfig[];
TS
}

write_max_lines_config() {
  local fixture_dir=$1

  cat >"$fixture_dir/scripts/lint-ratchet-config.ts" <<'TS'
type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;

export type LintRatchetMode = "no-new" | "ratchet-down" | "report-only";
export type LintRatchetMetric = "message-count" | "effective-line-count";
type LintRatchetRepairKind = "manual";
export type LintRatchetParserProfile = "minimal-ts" | "type-aware-ts";
export type LintRatchetPluginExport = "default" | "plugin";

export interface LintRatchetLocalSource {
  readonly kind: "local";
}

export interface LintRatchetThirdPartySource {
  readonly kind: "third-party";
  readonly pluginModule: string;
}

export type LintRatchetRuleSource =
  | LintRatchetLocalSource
  | LintRatchetThirdPartySource;

interface LintRatchetConfigBase {
  readonly id: string;
  readonly ruleId: string;
  readonly files: readonly string[];
  readonly ignores: readonly string[];
  readonly ruleOptions: readonly JsonValue[];
  readonly mode: LintRatchetMode;
  readonly target: number;
  readonly metric: LintRatchetMetric;
  readonly repairKind: LintRatchetRepairKind;
}

export type LintRatchetConfig =
  | (LintRatchetConfigBase & {
      readonly source?: LintRatchetLocalSource;
      readonly parserProfile?: "minimal-ts";
    })
  | (LintRatchetConfigBase & {
      readonly source: LintRatchetThirdPartySource;
      readonly parserProfile: LintRatchetParserProfile;
    });

export interface LintRatchetThirdPartyPluginAllowlistEntry {
  readonly pluginModule: string;
  readonly ruleNamespace: string;
  readonly pluginExport?: LintRatchetPluginExport;
}

export const lintRatchetThirdPartyPluginAllowlist: readonly LintRatchetThirdPartyPluginAllowlistEntry[] =
  [];

export const lintRatchets = [
  {
    id: "ratchet/fixture-max-lines",
    ruleId: "local/max-lines",
    files: ["packages/app/src/**/*.ts"],
    ignores: [],
    ruleOptions: [{ max: 3, skipBlankLines: true, skipComments: true }],
    mode: "no-new",
    target: 0,
    metric: "effective-line-count",
    repairKind: "manual",
  },
] as const satisfies readonly LintRatchetConfig[];
TS
}

write_type_assertion_config() {
  local fixture_dir=$1

  cat >"$fixture_dir/scripts/lint-ratchet-config.ts" <<'TS'
type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;

export type LintRatchetMode = "no-new" | "ratchet-down" | "report-only";
export type LintRatchetMetric = "message-count";
type LintRatchetRepairKind = "manual";
export type LintRatchetParserProfile = "minimal-ts" | "type-aware-ts";
export type LintRatchetPluginExport = "default" | "plugin";

export interface LintRatchetLocalSource {
  readonly kind: "local";
}

export interface LintRatchetThirdPartySource {
  readonly kind: "third-party";
  readonly pluginModule: string;
}

export type LintRatchetRuleSource =
  | LintRatchetLocalSource
  | LintRatchetThirdPartySource;

interface LintRatchetConfigBase {
  readonly id: string;
  readonly ruleId: string;
  readonly files: readonly string[];
  readonly ignores: readonly string[];
  readonly ruleOptions: readonly JsonValue[];
  readonly mode: LintRatchetMode;
  readonly target: number;
  readonly metric: LintRatchetMetric;
  readonly repairKind: LintRatchetRepairKind;
}

export type LintRatchetConfig =
  | (LintRatchetConfigBase & {
      readonly source?: LintRatchetLocalSource;
      readonly parserProfile?: "minimal-ts";
    })
  | (LintRatchetConfigBase & {
      readonly source: LintRatchetThirdPartySource;
      readonly parserProfile: LintRatchetParserProfile;
    });

export interface LintRatchetThirdPartyPluginAllowlistEntry {
  readonly pluginModule: string;
  readonly ruleNamespace: string;
  readonly pluginExport?: LintRatchetPluginExport;
}

export const lintRatchetThirdPartyPluginAllowlist: readonly LintRatchetThirdPartyPluginAllowlistEntry[] =
  [];

export const lintRatchets = [
  {
    id: "ratchet/local-type-assertion-boundary",
    ruleId: "local/type-assertion-boundary",
    files: ["packages/app/src/**/*.ts"],
    ignores: ["**/dist/**", "**/generated/**", "**/node_modules/**"],
    ruleOptions: [],
    mode: "no-new",
    target: 0,
    metric: "message-count",
    repairKind: "manual",
  },
] as const satisfies readonly LintRatchetConfig[];
TS
}

write_clean_source() {
  local fixture_dir=$1
  mkdir -p "$fixture_dir/packages/app/src"
  printf 'export const value = 1;\n' >"$fixture_dir/packages/app/src/example.ts"
}

write_max_lines_source() {
  local fixture_dir=$1
  local lines=$2
  mkdir -p "$fixture_dir/packages/app/src"
  : >"$fixture_dir/packages/app/src/example.ts"
  for line in $(seq 1 "$lines"); do
    printf 'export const value%s = %s;\n' "$line" "$line" \
      >>"$fixture_dir/packages/app/src/example.ts"
  done
}

write_complexity_source() {
  local fixture_dir=$1
  mkdir -p "$fixture_dir/packages/app/src"
  cat >"$fixture_dir/packages/app/src/example.ts" <<'TS'
export function choose(value: number): number {
  if (value > 0) {
    return 1;
  }
  if (value < 0) {
    return -1;
  }
  return 0;
}
TS
}

write_more_complexity_source() {
  local fixture_dir=$1
  mkdir -p "$fixture_dir/packages/app/src"
  cat >"$fixture_dir/packages/app/src/example.ts" <<'TS'
export function choose(value: number): number {
  if (value > 10) {
    return 10;
  }
  if (value > 0) {
    return 1;
  }
  if (value < 0) {
    return -1;
  }
  return 0;
}
TS
}

write_marker_source() {
  local fixture_dir=$1
  mkdir -p "$fixture_dir/packages/app/src"
  printf 'export const fixtureViolation = 1;\n' \
    >"$fixture_dir/packages/app/src/example.ts"
}

write_type_dependency_sources() {
  local fixture_dir=$1
  mkdir -p "$fixture_dir/packages/app/src"
  cat >"$fixture_dir/packages/app/src/schema.ts" <<'TS'
export interface FixtureSchema {
  readonly name: string;
}
TS
  cat >"$fixture_dir/packages/app/src/consumer.ts" <<'TS'
import type { FixtureSchema } from "./schema";

export function hasName(value: FixtureSchema): boolean {
  if (value.name) {
    return true;
  }
  return false;
}
TS
}

make_type_dependency_schema_nullable() {
  local fixture_dir=$1
  cat >"$fixture_dir/packages/app/src/schema.ts" <<'TS'
export interface FixtureSchema {
  readonly name: string | undefined;
}
TS
}

write_violation_source() {
  local fixture_dir=$1
  mkdir -p "$fixture_dir/packages/app/src"
  cat >"$fixture_dir/packages/app/src/example.ts" <<'TS'
const raw = {};
export const value = raw as { value: number };
TS
}

run_fixture_update() {
  local fixture_dir=$1
  (cd "$fixture_dir" && bun run scripts/lint-ratchet.ts --update \
    >"$TMP_ROOT/update.out" 2>"$TMP_ROOT/update.err")
}

third_party_config_path() {
  local fixture_dir=$1
  find "$fixture_dir/node_modules/.cache/eslint-ratchet/configs" \
    -name 'ratchet-fixture-third-party-*.mjs' -type f | sort
}

third_party_cache_files() {
  local fixture_dir=$1
  local cache_root="$fixture_dir/node_modules/.cache/eslint-ratchet"
  [ -d "$cache_root" ] || return 0
  find "$cache_root" -mindepth 2 -maxdepth 2 -name ".eslintcache" -type f \
    -path "*/ratchet-fixture-third-party-*/*" | sort
}

core_config_path() {
  local fixture_dir=$1
  find "$fixture_dir/node_modules/.cache/eslint-ratchet/configs" \
    -name 'ratchet-fixture-core-*.mjs' -type f | sort
}

core_cache_files() {
  local fixture_dir=$1
  local cache_root="$fixture_dir/node_modules/.cache/eslint-ratchet"
  [ -d "$cache_root" ] || return 0
  find "$cache_root" -mindepth 2 -maxdepth 2 -name ".eslintcache" -type f \
    -path "*/ratchet-fixture-core-*/*" | sort
}

# --- Real tree: committed baseline is clean under the default gate -----------
if ! bun run lint:ratchet >"$TMP_ROOT/real.out" 2>"$TMP_ROOT/real.err"; then
  cat "$TMP_ROOT/real.err"
  fail "lint:ratchet failed on the real tree"
fi
assert_envelope "$TMP_ROOT/real.out" 0

if ! bun run lint:ratchet:check-baseline >"$TMP_ROOT/real-check.out" 2>"$TMP_ROOT/real-check.err"; then
  cat "$TMP_ROOT/real-check.err"
  fail "lint:ratchet:check-baseline failed on the real tree"
fi
if ! bun run lint:ratchet:check-registry >"$TMP_ROOT/real-registry.out" 2>"$TMP_ROOT/real-registry.err"; then
  cat "$TMP_ROOT/real-registry.err"
  fail "lint:ratchet:check-registry failed on the real tree"
fi
grep -qF "lint:ratchet:check-registry OK" "$TMP_ROOT/real-registry.err" \
  || fail "lint:ratchet:check-registry OK line missing: $(cat "$TMP_ROOT/real-registry.err")"
assert_local_identity_regression

# --- Usage errors return exit 2 (CLI contract for harness wrappers) ----------
# Each assertion runs against the real tree; usage errors throw before ESLint
# is invoked so there are no side effects on the live cache or baseline.
assert_usage_failure "unknown flag" "Unknown argument" --not-a-flag
assert_usage_failure "two modes at once" "choose only one mode" --update --check-baseline
assert_usage_failure "--allow-worse outside --update" "--allow-worse is only valid with --update" --allow-worse
assert_usage_failure "--reason outside --update" "--reason is only valid with --update" --reason=anything
assert_usage_failure "--reason missing value" "--reason requires a non-empty argument" --update --reason
assert_usage_failure "--allow-worse without --reason" "--allow-worse requires a non-empty --reason" --update --allow-worse
assert_usage_failure "--allow-worse with blank --reason" "--allow-worse requires a non-empty --reason" --update --allow-worse --reason=""

# --- Fixture clean run -------------------------------------------------------
CLEAN_DIR="$TMP_ROOT/clean"
build_fixture "$CLEAN_DIR"
write_type_assertion_config "$CLEAN_DIR"
write_clean_source "$CLEAN_DIR"
run_fixture_update "$CLEAN_DIR" || fail "fixture clean update failed: $(cat "$TMP_ROOT/update.err")"
if ! (cd "$CLEAN_DIR" && bun run scripts/lint-ratchet.ts \
      >"$TMP_ROOT/clean.out" 2>"$TMP_ROOT/clean.err"); then
  cat "$TMP_ROOT/clean.err"
  fail "fixture clean run failed"
fi
assert_envelope "$TMP_ROOT/clean.out" 0

# --- Fixture regression ------------------------------------------------------
REGRESSION_DIR="$TMP_ROOT/regression"
build_fixture "$REGRESSION_DIR"
write_type_assertion_config "$REGRESSION_DIR"
write_clean_source "$REGRESSION_DIR"
run_fixture_update "$REGRESSION_DIR" || fail "fixture regression update failed"
write_violation_source "$REGRESSION_DIR"

set +e
(cd "$REGRESSION_DIR" && bun run scripts/lint-ratchet.ts \
  >"$TMP_ROOT/regression.out" 2>"$TMP_ROOT/regression.err")
status=$?
set -e
[ "$status" -eq 1 ] || fail "fixture regression should exit 1, got $status: $(cat "$TMP_ROOT/regression.err")"
assert_envelope "$TMP_ROOT/regression.out" 1
ASSERT_FILE="$TMP_ROOT/regression.out" bun -e '
  const fs = require("fs");
  const env = JSON.parse(fs.readFileSync(process.env.ASSERT_FILE, "utf8"));
  const finding = env.findings[0];
  if (finding.control !== "ratchet/local-type-assertion-boundary") throw new Error("bad control");
  if (finding.ruleId !== "local/type-assertion-boundary") throw new Error("bad ruleId");
  if (!finding.path) throw new Error("missing path");
' || fail "regression envelope missing expected finding"

set +e
(cd "$REGRESSION_DIR" && bun run scripts/lint-ratchet.ts --update \
  >"$TMP_ROOT/refuse-update.out" 2>"$TMP_ROOT/refuse-update.err")
status=$?
set -e
[ "$status" -ne 0 ] || fail "update should refuse worse generated baseline"
grep -qF "generated baseline is worse" "$TMP_ROOT/refuse-update.err" \
  || fail "worse update stderr missing refusal: $(cat "$TMP_ROOT/refuse-update.err")"

# --- Fixture: effective-line-count catches growth without count growth -------
MAX_LINES_DIR="$TMP_ROOT/max-lines"
build_fixture "$MAX_LINES_DIR"
write_max_lines_config "$MAX_LINES_DIR"
write_max_lines_source "$MAX_LINES_DIR" 4
run_fixture_update "$MAX_LINES_DIR" || fail "max-lines initial update failed"
grep -qF '"count": 1' "$MAX_LINES_DIR/lint-ratchet.baseline.json" \
  || fail "max-lines baseline missing finding count"
grep -qF '"lines": 4' "$MAX_LINES_DIR/lint-ratchet.baseline.json" \
  || fail "max-lines baseline missing effective line count"
write_max_lines_source "$MAX_LINES_DIR" 5
set +e
(cd "$MAX_LINES_DIR" && bun run scripts/lint-ratchet.ts \
  >"$TMP_ROOT/max-lines.out" 2>"$TMP_ROOT/max-lines.err")
status=$?
set -e
[ "$status" -eq 1 ] \
  || fail "max-lines default run should fail on line growth, got $status: $(cat "$TMP_ROOT/max-lines.err")"
assert_envelope "$TMP_ROOT/max-lines.out" 1
ASSERT_FILE="$TMP_ROOT/max-lines.out" bun -e '
  const fs = require("fs");
  const env = JSON.parse(fs.readFileSync(process.env.ASSERT_FILE, "utf8"));
  const finding = env.findings[0];
  if (finding.control !== "ratchet/fixture-max-lines") throw new Error("bad control");
  if (finding.ruleId !== "local/max-lines") throw new Error("bad ruleId");
  if (finding.reason !== "increased-lines") throw new Error(`bad reason ${finding.reason}`);
  if (finding.baselineLines !== 4) throw new Error(`bad baselineLines ${finding.baselineLines}`);
  if (finding.currentLines !== 5) throw new Error(`bad currentLines ${finding.currentLines}`);
  if (!finding.howToFix.includes("effective line count from 5")) {
    throw new Error(`missing line-count fix text: ${finding.howToFix}`);
  }
' || fail "max-lines envelope missing effective-line-count detail"
set +e
(cd "$MAX_LINES_DIR" && bun run scripts/lint-ratchet.ts --check-baseline \
  >"$TMP_ROOT/max-lines-check.out" 2>"$TMP_ROOT/max-lines-check.err")
status=$?
set -e
[ "$status" -eq 1 ] \
  || fail "max-lines check-baseline should fail on line growth, got $status: $(cat "$TMP_ROOT/max-lines-check.err")"
grep -qF "effective lines increased from 4 to 5" "$TMP_ROOT/max-lines-check.err" \
  || fail "max-lines check-baseline missing line growth detail: $(cat "$TMP_ROOT/max-lines-check.err")"
set +e
(cd "$MAX_LINES_DIR" && bun run scripts/lint-ratchet.ts --update \
  >"$TMP_ROOT/max-lines-update.out" 2>"$TMP_ROOT/max-lines-update.err")
status=$?
set -e
[ "$status" -ne 0 ] || fail "max-lines update should refuse worse lines"
grep -qF "generated baseline is worse" "$TMP_ROOT/max-lines-update.err" \
  || fail "max-lines update stderr missing refusal: $(cat "$TMP_ROOT/max-lines-update.err")"

MAX_LINES_IMPROVE_DIR="$TMP_ROOT/max-lines-improve"
build_fixture "$MAX_LINES_IMPROVE_DIR"
write_max_lines_config "$MAX_LINES_IMPROVE_DIR"
write_max_lines_source "$MAX_LINES_IMPROVE_DIR" 5
run_fixture_update "$MAX_LINES_IMPROVE_DIR" || fail "max-lines improve update failed"
write_max_lines_source "$MAX_LINES_IMPROVE_DIR" 4
set +e
(cd "$MAX_LINES_IMPROVE_DIR" && bun run scripts/lint-ratchet.ts --check-baseline \
  >"$TMP_ROOT/max-lines-improve-check.out" 2>"$TMP_ROOT/max-lines-improve-check.err")
status=$?
set -e
[ "$status" -eq 1 ] \
  || fail "max-lines check-baseline should fail when effective lines shrink, got $status: $(cat "$TMP_ROOT/max-lines-improve-check.err")"
grep -qF "effective lines decreased from 5 to 4" "$TMP_ROOT/max-lines-improve-check.err" \
  || fail "max-lines improvement detail missing: $(cat "$TMP_ROOT/max-lines-improve-check.err")"
grep -qF "run bun run lint:ratchet:update" "$TMP_ROOT/max-lines-improve-check.err" \
  || fail "max-lines improvement repair command missing: $(cat "$TMP_ROOT/max-lines-improve-check.err")"
max_lines_before=$(ASSERT_FILE="$MAX_LINES_IMPROVE_DIR/lint-ratchet.baseline.json" bun -e '
  const fs = require("fs");
  const parsed = JSON.parse(fs.readFileSync(process.env.ASSERT_FILE, "utf8"));
  const item = parsed.tests["ratchet/fixture-max-lines"].items["packages/app/src/example.ts"];
  if (item === undefined) throw new Error("missing max-lines item");
  console.log(item.lines);
') || fail "max-lines improvement baseline read failed"
[ "$max_lines_before" -eq 5 ] \
  || fail "max-lines improvement baseline should start at 5 lines, got $max_lines_before"
run_fixture_update "$MAX_LINES_IMPROVE_DIR" \
  || fail "max-lines improvement update did not clear failure: $(cat "$TMP_ROOT/update.err")"
set +e
(cd "$MAX_LINES_IMPROVE_DIR" && bun run scripts/lint-ratchet.ts --check-baseline \
  >"$TMP_ROOT/max-lines-improve-clean-check.out" \
  2>"$TMP_ROOT/max-lines-improve-clean-check.err")
status=$?
set -e
[ "$status" -eq 0 ] \
  || fail "max-lines check-baseline should pass after update, got $status: $(cat "$TMP_ROOT/max-lines-improve-clean-check.err")"
grep -qF "lint:ratchet:check-baseline OK — 1 current finding(s)." \
  "$TMP_ROOT/max-lines-improve-clean-check.err" \
  || fail "max-lines check-baseline OK line missing after update: $(cat "$TMP_ROOT/max-lines-improve-clean-check.err")"
if grep -qF "current findings are better" "$TMP_ROOT/max-lines-improve-clean-check.err"; then
  fail "max-lines check-baseline still reported an improvement after update: $(cat "$TMP_ROOT/max-lines-improve-clean-check.err")"
fi
if ! (cd "$MAX_LINES_IMPROVE_DIR" && bun run scripts/lint-ratchet.ts \
      >"$TMP_ROOT/max-lines-improve-clean.out" \
      2>"$TMP_ROOT/max-lines-improve-clean.err"); then
  cat "$TMP_ROOT/max-lines-improve-clean.err"
  fail "max-lines default run should pass after improvement update"
fi
assert_envelope "$TMP_ROOT/max-lines-improve-clean.out" 0
max_lines_after=$(ASSERT_FILE="$MAX_LINES_IMPROVE_DIR/lint-ratchet.baseline.json" bun -e '
  const fs = require("fs");
  const parsed = JSON.parse(fs.readFileSync(process.env.ASSERT_FILE, "utf8"));
  const item = parsed.tests["ratchet/fixture-max-lines"].items["packages/app/src/example.ts"];
  if (item === undefined) throw new Error("missing max-lines item");
  console.log(item.lines);
') || fail "max-lines improvement baseline reread failed"
[ "$max_lines_after" -eq 4 ] \
  || fail "max-lines improvement baseline should update to 4 lines, got $max_lines_after"
[ "$max_lines_before" -gt "$max_lines_after" ] \
  || fail "max-lines improvement baseline did not shrink: $max_lines_before -> $max_lines_after"

# --- Fixture check-baseline validation is non-mutating -----------------------
# Mutate the baseline JSON structurally (drop ruleOptions) so the smoke does
# not depend on the exact textual layout `formatLintRatchetBaseline` emits.
MUTATE_DIR="$TMP_ROOT/mutate"
build_fixture "$MUTATE_DIR"
write_type_assertion_config "$MUTATE_DIR"
write_clean_source "$MUTATE_DIR"
run_fixture_update "$MUTATE_DIR" || fail "fixture mutate update failed"
ASSERT_FILE="$MUTATE_DIR/lint-ratchet.baseline.json" bun -e '
  const fs = require("fs");
  const file = process.env.ASSERT_FILE;
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const test of Object.values(parsed.tests)) {
    delete test.ruleOptions;
  }
  fs.writeFileSync(file, JSON.stringify(parsed, null, 2) + "\n");
' || fail "structural mutate failed"
before=$(cat "$MUTATE_DIR/lint-ratchet.baseline.json")
set +e
(cd "$MUTATE_DIR" && bun run scripts/lint-ratchet.ts --check-baseline \
  >"$TMP_ROOT/mutate-check.out" 2>"$TMP_ROOT/mutate-check.err")
status=$?
set -e
[ "$status" -ne 0 ] || fail "check-baseline should reject mutated baseline"
after=$(cat "$MUTATE_DIR/lint-ratchet.baseline.json")
[ "$before" = "$after" ] || fail "check-baseline rewrote the mutated baseline"

# --- Fixture: update recovers from stale registry metadata -------------------
# The committed baseline has a stale configHash; update should rewrite it
# instead of failing on the strict registry-identity check.
STALE_DIR="$TMP_ROOT/stale-recover"
build_fixture "$STALE_DIR"
write_type_assertion_config "$STALE_DIR"
write_clean_source "$STALE_DIR"
run_fixture_update "$STALE_DIR" || fail "stale-recover initial update failed"
ASSERT_FILE="$STALE_DIR/lint-ratchet.baseline.json" bun -e '
  const fs = require("fs");
  const file = process.env.ASSERT_FILE;
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const test of Object.values(parsed.tests)) {
    test.configHash = "sha256:stale";
  }
  fs.writeFileSync(file, JSON.stringify(parsed, null, 2) + "\n");
' || fail "stale-recover mutate failed"

set +e
(cd "$STALE_DIR" && bun run scripts/lint-ratchet.ts --check-baseline \
  >"$TMP_ROOT/stale-check.out" 2>"$TMP_ROOT/stale-check.err")
status=$?
set -e
[ "$status" -ne 0 ] || fail "check-baseline should still reject stale registry metadata"
grep -qF "configHash is stale" "$TMP_ROOT/stale-check.err" \
  || fail "stale check missing expected message: $(cat "$TMP_ROOT/stale-check.err")"

if ! (cd "$STALE_DIR" && bun run scripts/lint-ratchet.ts --update \
      >"$TMP_ROOT/stale-update.out" 2>"$TMP_ROOT/stale-update.err"); then
  cat "$TMP_ROOT/stale-update.err"
  fail "update should rewrite a baseline with stale registry metadata"
fi
grep -qF "sha256:stale" "$STALE_DIR/lint-ratchet.baseline.json" \
  && fail "update did not refresh the stale configHash"

# --- Fixture: update refuses a baseline with an orphan registry id without
#     --allow-worse --reason; accepts with the flag (Leaf 26) -----------------
# A committed entry whose id is no longer in the registry looks identical to
# a renamed ratchet (the new id has no committed floor, so count protection
# is bypassed). update must require explicit operator acknowledgement, even
# though the structural parse can still rebuild the file.
ORPHAN_DIR="$TMP_ROOT/orphan"
build_fixture "$ORPHAN_DIR"
write_type_assertion_config "$ORPHAN_DIR"
write_clean_source "$ORPHAN_DIR"
run_fixture_update "$ORPHAN_DIR" || fail "orphan initial update failed"
ASSERT_FILE="$ORPHAN_DIR/lint-ratchet.baseline.json" bun -e '
  const fs = require("fs");
  const file = process.env.ASSERT_FILE;
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  const renamed = {};
  for (const [id, test] of Object.entries(parsed.tests)) {
    renamed[id + "-removed"] = test;
  }
  parsed.tests = renamed;
  fs.writeFileSync(file, JSON.stringify(parsed, null, 2) + "\n");
' || fail "orphan mutate failed"
# Plain --update must refuse with the rename-or-removal diagnostic.
set +e
(cd "$ORPHAN_DIR" && bun run scripts/lint-ratchet.ts --update \
   >"$TMP_ROOT/orphan-refuse.out" 2>"$TMP_ROOT/orphan-refuse.err")
status=$?
set -e
[ "$status" -ne 0 ] || fail "orphan --update should refuse without --allow-worse"
grep -qF "rename or removal" "$TMP_ROOT/orphan-refuse.err" \
  || fail "orphan refuse stderr missing rename-or-removal hint: $(cat "$TMP_ROOT/orphan-refuse.err")"
grep -qF "-removed" "$TMP_ROOT/orphan-refuse.err" \
  || fail "orphan refuse stderr should name the orphan id: $(cat "$TMP_ROOT/orphan-refuse.err")"
grep -qF "-removed" "$ORPHAN_DIR/lint-ratchet.baseline.json" \
  || fail "orphan refuse should not rewrite the baseline"
# With --allow-worse --reason, update proceeds and drops the orphan id.
if ! (cd "$ORPHAN_DIR" && bun run scripts/lint-ratchet.ts --update \
      --allow-worse --reason="renamed local rule" \
      >"$TMP_ROOT/orphan-accept.out" 2>"$TMP_ROOT/orphan-accept.err"); then
  cat "$TMP_ROOT/orphan-accept.err"
  fail "update --allow-worse --reason should rewrite a baseline whose registry id no longer exists"
fi
grep -qF "-removed" "$ORPHAN_DIR/lint-ratchet.baseline.json" \
  && fail "update --allow-worse did not drop the orphan registry id"

# --- Fixture: rule source change invalidates cached findings -----------------
# Establish a baseline with a violation under the real rule, then replace the
# rule file with a no-op that emits no findings. Without rule-source hashing,
# ESLint's cache (keyed off the generated config path) would happily reuse the
# previous findings. With Leaf 01 in place, both the cache path AND the
# strict-parse ruleSourceHash check force a re-run.
RULESRC_DIR="$TMP_ROOT/rule-source"
build_fixture "$RULESRC_DIR"
write_type_assertion_config "$RULESRC_DIR"
write_violation_source "$RULESRC_DIR"
run_fixture_update "$RULESRC_DIR" || fail "rule-source initial update failed"
# Baseline now expects 1 finding under the real rule.
grep -qF '"count": 1' "$RULESRC_DIR/lint-ratchet.baseline.json" \
  || fail "rule-source baseline missing the seeded violation count"

# Replace the local rule with a no-op so it no longer fires. Keep the docs
# metadata the rule-docs validator requires so the smoke isolates rule-source
# invalidation rather than metadata regressions.
cat >"$RULESRC_DIR/eslint-rules/type-assertion-boundary.js" <<'JS'
export default {
  meta: {
    type: "problem",
    schema: [],
    docs: {
      description: "No-op fixture replacement for type-assertion-boundary.",
      principle: "Cache invalidation smoke fixture.",
      category: "maintainability",
      pairedGuide: "none",
      repairKind: "manual",
    },
  },
  create() { return {}; },
};
JS

# check-baseline must reject the now-stale ruleSourceHash binding (strict
# parse). Without Leaf 01 this would silently pass because nothing tied the
# baseline to the rule implementation.
set +e
(cd "$RULESRC_DIR" && bun run scripts/lint-ratchet.ts --check-baseline \
  >"$TMP_ROOT/rule-source-check.out" 2>"$TMP_ROOT/rule-source-check.err")
status=$?
set -e
[ "$status" -ne 0 ] || fail "check-baseline should reject a baseline bound to a stale rule source"
grep -qF "ruleSourceHash is stale" "$TMP_ROOT/rule-source-check.err" \
  || fail "rule-source check missing expected stale-hash message: $(cat "$TMP_ROOT/rule-source-check.err")"

# Update re-baselines under the no-op rule and proves the cache invalidates:
# the previous run's cached "1 violation" finding under the old rule must not
# leak into the rebaselined type-assertion ratchet. The fixture copies the live
# registry, so other ratchets may still have current findings in this temp tree.
if ! (cd "$RULESRC_DIR" && bun run scripts/lint-ratchet.ts --update \
      >"$TMP_ROOT/rule-source-update.out" 2>"$TMP_ROOT/rule-source-update.err"); then
  cat "$TMP_ROOT/rule-source-update.err"
  fail "update should re-baseline under the no-op rule"
fi
ASSERT_FILE="$RULESRC_DIR/lint-ratchet.baseline.json" bun -e '
  const fs = require("fs");
  const parsed = JSON.parse(fs.readFileSync(process.env.ASSERT_FILE, "utf8"));
  const test = parsed.tests["ratchet/local-type-assertion-boundary"];
  if (!test) throw new Error("missing type-assertion ratchet baseline");
  if (Object.keys(test.items).length !== 0) {
    throw new Error(`type-assertion items not empty: ${JSON.stringify(test.items)}`);
  }
' || fail "rebaselined type-assertion items not empty after rule replacement"

# --- Fixture: unsupported third-party plugin namespace fails loudly ----------
UNSUPPORTED_PLUGIN_DIR="$TMP_ROOT/unsupported-plugin"
build_fixture "$UNSUPPORTED_PLUGIN_DIR"
write_clean_source "$UNSUPPORTED_PLUGIN_DIR"
write_third_party_config "$UNSUPPORTED_PLUGIN_DIR" "always-report" "minimal-ts" "not-allowlisted"
set +e
(cd "$UNSUPPORTED_PLUGIN_DIR" && bun run scripts/lint-ratchet.ts --update \
  >"$TMP_ROOT/unsupported-plugin.out" 2>"$TMP_ROOT/unsupported-plugin.err")
status=$?
set -e
[ "$status" -eq 2 ] \
  || fail "unsupported plugin should exit 2, got $status: $(cat "$TMP_ROOT/unsupported-plugin.err")"
grep -qF "is not allowlisted" "$TMP_ROOT/unsupported-plugin.err" \
  || fail "unsupported plugin stderr missing allowlist failure: $(cat "$TMP_ROOT/unsupported-plugin.err")"

# --- Fixture: malformed third-party rule ids fail before allowlist lookup ----
MALFORMED_RULE_ID_DIR="$TMP_ROOT/malformed-rule-id"
build_fixture "$MALFORMED_RULE_ID_DIR"
write_clean_source "$MALFORMED_RULE_ID_DIR"
write_third_party_config "$MALFORMED_RULE_ID_DIR" "unused" "minimal-ts" \
  "allowlisted" "@badly"
set +e
(cd "$MALFORMED_RULE_ID_DIR" && bun run scripts/lint-ratchet.ts --update \
  >"$TMP_ROOT/malformed-rule-id.out" 2>"$TMP_ROOT/malformed-rule-id.err")
status=$?
set -e
[ "$status" -eq 2 ] \
  || fail "malformed ruleId should exit 2, got $status: $(cat "$TMP_ROOT/malformed-rule-id.err")"
grep -qF "ruleId is not a valid lint rule identifier" "$TMP_ROOT/malformed-rule-id.err" \
  || fail "malformed ruleId stderr missing validation failure: $(cat "$TMP_ROOT/malformed-rule-id.err")"
! grep -qF "is not allowlisted" "$TMP_ROOT/malformed-rule-id.err" \
  || fail "malformed ruleId should not report allowlist failure: $(cat "$TMP_ROOT/malformed-rule-id.err")"

# --- Fixture: malformed core rule ids fail before ESLint runs ---------------
MALFORMED_CORE_RULE_ID_DIR="$TMP_ROOT/malformed-core-rule-id"
build_fixture "$MALFORMED_CORE_RULE_ID_DIR"
write_clean_source "$MALFORMED_CORE_RULE_ID_DIR"
write_core_config "$MALFORMED_CORE_RULE_ID_DIR" "foo/bar"
set +e
(cd "$MALFORMED_CORE_RULE_ID_DIR" && bun run scripts/lint-ratchet.ts --update \
  >"$TMP_ROOT/malformed-core-rule-id.out" 2>"$TMP_ROOT/malformed-core-rule-id.err")
status=$?
set -e
[ "$status" -eq 2 ] \
  || fail "malformed core ruleId should exit 2, got $status: $(cat "$TMP_ROOT/malformed-core-rule-id.err")"
grep -qF "core ruleId must be a bare ESLint built-in id" \
  "$TMP_ROOT/malformed-core-rule-id.err" \
  || fail "malformed core ruleId stderr missing validation failure: $(cat "$TMP_ROOT/malformed-core-rule-id.err")"

# --- Fixture: supported core rule executes and baselines findings -----------
CORE_DIR="$TMP_ROOT/core"
build_fixture "$CORE_DIR"
write_complexity_source "$CORE_DIR"
write_core_config "$CORE_DIR" "complexity" "minimal-ts" "[{ max: 1 }]"
run_fixture_update "$CORE_DIR" \
  || fail "core update failed: $(cat "$TMP_ROOT/update.err")"
grep -qF '"ratchet/fixture-core"' "$CORE_DIR/lint-ratchet.baseline.json" \
  || fail "core baseline missing fixture ratchet"
grep -qF '"count": 1' "$CORE_DIR/lint-ratchet.baseline.json" \
  || fail "core baseline missing expected finding count"
if ! (cd "$CORE_DIR" && bun run scripts/lint-ratchet.ts \
      >"$TMP_ROOT/core.out" 2>"$TMP_ROOT/core.err"); then
  cat "$TMP_ROOT/core.err"
  fail "core default run failed after update"
fi
assert_envelope "$TMP_ROOT/core.out" 0
CORE_CONFIG=$(core_config_path "$CORE_DIR")
[ -n "$CORE_CONFIG" ] || fail "core generated config missing"
grep -qF 'rules: { "complexity": ["error",{"max":1}] }' "$CORE_CONFIG" \
  || fail "core generated config missing bare rule id"
! grep -qF "plugins:" "$CORE_CONFIG" \
  || fail "core generated config should not declare plugins"
CORE_CACHE=$(core_cache_files "$CORE_DIR")
[ -n "$CORE_CACHE" ] \
  || fail "minimal-ts core ratchet did not create an eslint cache file"

# --- Fixture: complexity-severity catches growth without count growth -------
COMPLEXITY_DIR="$TMP_ROOT/complexity-severity"
build_fixture "$COMPLEXITY_DIR"
write_complexity_source "$COMPLEXITY_DIR"
write_core_config "$COMPLEXITY_DIR" "complexity" "minimal-ts" "[{ max: 1 }]" "complexity-severity"
run_fixture_update "$COMPLEXITY_DIR" \
  || fail "complexity-severity initial update failed: $(cat "$TMP_ROOT/update.err")"
grep -qF '"count": 1' "$COMPLEXITY_DIR/lint-ratchet.baseline.json" \
  || fail "complexity-severity baseline missing finding count"
grep -qF '"maxComplexity": 3' "$COMPLEXITY_DIR/lint-ratchet.baseline.json" \
  || fail "complexity-severity baseline missing max complexity"
write_more_complexity_source "$COMPLEXITY_DIR"
set +e
(cd "$COMPLEXITY_DIR" && bun run scripts/lint-ratchet.ts \
  >"$TMP_ROOT/complexity.out" 2>"$TMP_ROOT/complexity.err")
status=$?
set -e
[ "$status" -eq 1 ] \
  || fail "complexity-severity default run should fail on complexity growth, got $status: $(cat "$TMP_ROOT/complexity.err")"
assert_envelope "$TMP_ROOT/complexity.out" 1
ASSERT_FILE="$TMP_ROOT/complexity.out" bun -e '
  const fs = require("fs");
  const env = JSON.parse(fs.readFileSync(process.env.ASSERT_FILE, "utf8"));
  const finding = env.findings[0];
  if (finding.control !== "ratchet/fixture-core") throw new Error("bad control");
  if (finding.ruleId !== "complexity") throw new Error("bad ruleId");
  if (finding.reason !== "increased-complexity") throw new Error(`bad reason ${finding.reason}`);
  if (finding.baselineComplexity !== 3) throw new Error(`bad baselineComplexity ${finding.baselineComplexity}`);
  if (finding.currentComplexity !== 4) throw new Error(`bad currentComplexity ${finding.currentComplexity}`);
  if (!finding.howToFix.includes("complexity from 4")) {
    throw new Error(`missing complexity fix text: ${finding.howToFix}`);
  }
' || fail "complexity envelope missing severity detail"
set +e
(cd "$COMPLEXITY_DIR" && bun run scripts/lint-ratchet.ts --check-baseline \
  >"$TMP_ROOT/complexity-check.out" 2>"$TMP_ROOT/complexity-check.err")
status=$?
set -e
[ "$status" -eq 1 ] \
  || fail "complexity check-baseline should fail on complexity growth, got $status: $(cat "$TMP_ROOT/complexity-check.err")"
grep -qF "complexity increased from 3 to 4" "$TMP_ROOT/complexity-check.err" \
  || fail "complexity check-baseline missing growth detail: $(cat "$TMP_ROOT/complexity-check.err")"
set +e
(cd "$COMPLEXITY_DIR" && bun run scripts/lint-ratchet.ts --update \
  >"$TMP_ROOT/complexity-update.out" 2>"$TMP_ROOT/complexity-update.err")
status=$?
set -e
[ "$status" -ne 0 ] || fail "complexity update should refuse worse severity"
grep -qF "generated baseline is worse" "$TMP_ROOT/complexity-update.err" \
  || fail "complexity update stderr missing refusal: $(cat "$TMP_ROOT/complexity-update.err")"

COMPLEXITY_IMPROVE_DIR="$TMP_ROOT/complexity-severity-improve"
build_fixture "$COMPLEXITY_IMPROVE_DIR"
write_more_complexity_source "$COMPLEXITY_IMPROVE_DIR"
write_core_config "$COMPLEXITY_IMPROVE_DIR" "complexity" "minimal-ts" "[{ max: 1 }]" "complexity-severity"
run_fixture_update "$COMPLEXITY_IMPROVE_DIR" \
  || fail "complexity improvement update failed: $(cat "$TMP_ROOT/update.err")"
write_complexity_source "$COMPLEXITY_IMPROVE_DIR"
set +e
(cd "$COMPLEXITY_IMPROVE_DIR" && bun run scripts/lint-ratchet.ts --check-baseline \
  >"$TMP_ROOT/complexity-improve-check.out" 2>"$TMP_ROOT/complexity-improve-check.err")
status=$?
set -e
[ "$status" -eq 1 ] \
  || fail "complexity check-baseline should fail when complexity shrinks, got $status: $(cat "$TMP_ROOT/complexity-improve-check.err")"
grep -qF "complexity decreased from 4 to 3" "$TMP_ROOT/complexity-improve-check.err" \
  || fail "complexity improvement detail missing: $(cat "$TMP_ROOT/complexity-improve-check.err")"
grep -qF "run bun run lint:ratchet:update" "$TMP_ROOT/complexity-improve-check.err" \
  || fail "complexity improvement repair command missing: $(cat "$TMP_ROOT/complexity-improve-check.err")"
complexity_before=$(ASSERT_FILE="$COMPLEXITY_IMPROVE_DIR/lint-ratchet.baseline.json" bun -e '
  const fs = require("fs");
  const parsed = JSON.parse(fs.readFileSync(process.env.ASSERT_FILE, "utf8"));
  const item = parsed.tests["ratchet/fixture-core"].items["packages/app/src/example.ts"];
  if (item === undefined) throw new Error("missing complexity item");
  console.log(item.maxComplexity);
') || fail "complexity improvement baseline read failed"
[ "$complexity_before" -eq 4 ] \
  || fail "complexity improvement baseline should start at 4, got $complexity_before"
run_fixture_update "$COMPLEXITY_IMPROVE_DIR" \
  || fail "complexity improvement update did not clear failure: $(cat "$TMP_ROOT/update.err")"
set +e
(cd "$COMPLEXITY_IMPROVE_DIR" && bun run scripts/lint-ratchet.ts --check-baseline \
  >"$TMP_ROOT/complexity-improve-clean-check.out" \
  2>"$TMP_ROOT/complexity-improve-clean-check.err")
status=$?
set -e
[ "$status" -eq 0 ] \
  || fail "complexity check-baseline should pass after update, got $status: $(cat "$TMP_ROOT/complexity-improve-clean-check.err")"
grep -qF "lint:ratchet:check-baseline OK — 1 current finding(s)." \
  "$TMP_ROOT/complexity-improve-clean-check.err" \
  || fail "complexity check-baseline OK line missing after update: $(cat "$TMP_ROOT/complexity-improve-clean-check.err")"
if grep -qF "current findings are better" "$TMP_ROOT/complexity-improve-clean-check.err"; then
  fail "complexity check-baseline still reported an improvement after update: $(cat "$TMP_ROOT/complexity-improve-clean-check.err")"
fi
if ! (cd "$COMPLEXITY_IMPROVE_DIR" && bun run scripts/lint-ratchet.ts \
      >"$TMP_ROOT/complexity-improve-clean.out" \
      2>"$TMP_ROOT/complexity-improve-clean.err"); then
  cat "$TMP_ROOT/complexity-improve-clean.err"
  fail "complexity default run should pass after improvement update"
fi
assert_envelope "$TMP_ROOT/complexity-improve-clean.out" 0
complexity_after=$(ASSERT_FILE="$COMPLEXITY_IMPROVE_DIR/lint-ratchet.baseline.json" bun -e '
  const fs = require("fs");
  const parsed = JSON.parse(fs.readFileSync(process.env.ASSERT_FILE, "utf8"));
  const item = parsed.tests["ratchet/fixture-core"].items["packages/app/src/example.ts"];
  if (item === undefined) throw new Error("missing complexity item");
  console.log(item.maxComplexity);
') || fail "complexity improvement baseline reread failed"
[ "$complexity_after" -eq 3 ] \
  || fail "complexity improvement baseline should update to 3, got $complexity_after"
[ "$complexity_before" -gt "$complexity_after" ] \
  || fail "complexity improvement baseline did not shrink: $complexity_before -> $complexity_after"

# --- Fixture: supported third-party rule executes and baselines findings -----
THIRD_PARTY_DIR="$TMP_ROOT/third-party"
build_fixture "$THIRD_PARTY_DIR"
use_fixture_node_modules_with_fake_plugin "$THIRD_PARTY_DIR"
write_clean_source "$THIRD_PARTY_DIR"
write_third_party_config "$THIRD_PARTY_DIR" "always-report" "minimal-ts"
run_fixture_update "$THIRD_PARTY_DIR" \
  || fail "third-party update failed: $(cat "$TMP_ROOT/update.err")"
grep -qF '"ratchet/fixture-third-party"' "$THIRD_PARTY_DIR/lint-ratchet.baseline.json" \
  || fail "third-party baseline missing fixture ratchet"
grep -qF '"count": 1' "$THIRD_PARTY_DIR/lint-ratchet.baseline.json" \
  || fail "third-party baseline missing expected finding count"
if ! (cd "$THIRD_PARTY_DIR" && bun run scripts/lint-ratchet.ts \
      >"$TMP_ROOT/third-party.out" 2>"$TMP_ROOT/third-party.err"); then
  cat "$TMP_ROOT/third-party.err"
  fail "third-party default run failed after update"
fi
assert_envelope "$TMP_ROOT/third-party.out" 0
THIRD_PARTY_CACHE=$(third_party_cache_files "$THIRD_PARTY_DIR")
[ -n "$THIRD_PARTY_CACHE" ] \
  || fail "minimal-ts third-party ratchet did not create an eslint cache file"

# --- Fixture: type-aware parser profile renders the project-service shape ----
TYPE_AWARE_DIR="$TMP_ROOT/type-aware"
build_fixture "$TYPE_AWARE_DIR"
use_fixture_node_modules_with_fake_plugin "$TYPE_AWARE_DIR"
write_fixture_tsconfig "$TYPE_AWARE_DIR"
write_clean_source "$TYPE_AWARE_DIR"
write_third_party_config "$TYPE_AWARE_DIR" "no-fixture-marker" "type-aware-ts"
run_fixture_update "$TYPE_AWARE_DIR" \
  || fail "type-aware third-party update failed: $(cat "$TMP_ROOT/update.err")"
TYPE_AWARE_CONFIG=$(third_party_config_path "$TYPE_AWARE_DIR")
[ -n "$TYPE_AWARE_CONFIG" ] || fail "type-aware generated config missing"
grep -qF "projectService: true" "$TYPE_AWARE_CONFIG" \
  || fail "type-aware generated config missing projectService"
grep -qF "tsconfigRootDir: \"$TYPE_AWARE_DIR\"" "$TYPE_AWARE_CONFIG" \
  || fail "type-aware generated config missing tsconfigRootDir"
grep -qF '"ratchet/fixture-third-party"' "$TYPE_AWARE_DIR/lint-ratchet.baseline.json" \
  || fail "type-aware baseline missing fixture ratchet"
TYPE_AWARE_CACHE=$(third_party_cache_files "$TYPE_AWARE_DIR")
[ -z "$TYPE_AWARE_CACHE" ] \
  || fail "type-aware ratchet should not create eslint cache files: $TYPE_AWARE_CACHE"
TYPE_AWARE_STALE_CACHE="$TYPE_AWARE_DIR/node_modules/.cache/eslint-ratchet/$(basename "$TYPE_AWARE_CONFIG" .mjs)"
mkdir -p "$TYPE_AWARE_STALE_CACHE"
echo "stale" > "$TYPE_AWARE_STALE_CACHE/.eslintcache"
if ! (cd "$TYPE_AWARE_DIR" && bun run scripts/lint-ratchet.ts \
      >"$TMP_ROOT/type-aware.out" 2>"$TMP_ROOT/type-aware.err"); then
  cat "$TMP_ROOT/type-aware.err"
  fail "type-aware default run failed after update"
fi
assert_envelope "$TMP_ROOT/type-aware.out" 0
[ ! -e "$TYPE_AWARE_STALE_CACHE" ] \
  || fail "type-aware run did not sweep its now-unused eslint cache dir"

# --- Fixture: type-aware cache does not mask imported type changes ----------
TYPE_DEP_DIR="$TMP_ROOT/type-aware-type-dependency"
build_fixture "$TYPE_DEP_DIR"
write_fixture_tsconfig "$TYPE_DEP_DIR"
write_type_dependency_sources "$TYPE_DEP_DIR"
STRICT_BOOLEAN_OPTIONS='[{ allowAny: false, allowNullableBoolean: false, allowNullableEnum: false, allowNullableNumber: false, allowNullableObject: true, allowNullableString: false, allowNumber: true, allowString: true }]'
write_third_party_config "$TYPE_DEP_DIR" "strict-boolean-expressions" "type-aware-ts" \
  "allowlisted" "@typescript-eslint/strict-boolean-expressions" \
  "typescript-eslint" "plugin" "$STRICT_BOOLEAN_OPTIONS" "@typescript-eslint"
run_fixture_update "$TYPE_DEP_DIR" \
  || fail "type-dependency initial update failed: $(cat "$TMP_ROOT/update.err")"
grep -qF '"items": {}' "$TYPE_DEP_DIR/lint-ratchet.baseline.json" \
  || fail "type-dependency baseline should start clean"
cp "$TYPE_DEP_DIR/packages/app/src/consumer.ts" "$TMP_ROOT/type-dependency-consumer.before"
make_type_dependency_schema_nullable "$TYPE_DEP_DIR"
cmp -s "$TMP_ROOT/type-dependency-consumer.before" \
  "$TYPE_DEP_DIR/packages/app/src/consumer.ts" \
  || fail "type-dependency test unexpectedly modified the consumer file"
set +e
(cd "$TYPE_DEP_DIR" && bun run scripts/lint-ratchet.ts \
  >"$TMP_ROOT/type-dependency.out" 2>"$TMP_ROOT/type-dependency.err")
status=$?
set -e
[ "$status" -eq 1 ] \
  || fail "type-dependency default run should catch the unchanged consumer finding, got $status: $(cat "$TMP_ROOT/type-dependency.err")"
assert_envelope "$TMP_ROOT/type-dependency.out" 1
ASSERT_FILE="$TMP_ROOT/type-dependency.out" bun -e '
  const fs = require("fs");
  const env = JSON.parse(fs.readFileSync(process.env.ASSERT_FILE, "utf8"));
  const finding = env.findings[0];
  if (finding.path !== "packages/app/src/consumer.ts") {
    throw new Error(`expected consumer finding, got ${finding.path}`);
  }
' || fail "type-dependency envelope missing unchanged consumer finding"

# --- Fixture: third-party check/update follows local ratchet semantics -------
THIRD_BASELINE_DIR="$TMP_ROOT/third-party-baseline"
build_fixture "$THIRD_BASELINE_DIR"
use_fixture_node_modules_with_fake_plugin "$THIRD_BASELINE_DIR"
write_clean_source "$THIRD_BASELINE_DIR"
write_third_party_config "$THIRD_BASELINE_DIR" "no-fixture-marker" "minimal-ts"
run_fixture_update "$THIRD_BASELINE_DIR" \
  || fail "third-party baseline initial update failed: $(cat "$TMP_ROOT/update.err")"
write_marker_source "$THIRD_BASELINE_DIR"
set +e
(cd "$THIRD_BASELINE_DIR" && bun run scripts/lint-ratchet.ts --check-baseline \
  >"$TMP_ROOT/third-baseline-check.out" 2>"$TMP_ROOT/third-baseline-check.err")
status=$?
set -e
[ "$status" -eq 1 ] \
  || fail "third-party check-baseline should exit 1, got $status: $(cat "$TMP_ROOT/third-baseline-check.err")"
grep -qF "current findings are worse" "$TMP_ROOT/third-baseline-check.err" \
  || fail "third-party check-baseline stderr missing worse finding note: $(cat "$TMP_ROOT/third-baseline-check.err")"
set +e
(cd "$THIRD_BASELINE_DIR" && bun run scripts/lint-ratchet.ts \
  >"$TMP_ROOT/third-baseline-default.out" 2>"$TMP_ROOT/third-baseline-default.err")
status=$?
set -e
[ "$status" -eq 1 ] \
  || fail "third-party default regression should exit 1, got $status: $(cat "$TMP_ROOT/third-baseline-default.err")"
assert_envelope "$TMP_ROOT/third-baseline-default.out" 1
set +e
(cd "$THIRD_BASELINE_DIR" && bun run scripts/lint-ratchet.ts --update \
  >"$TMP_ROOT/third-baseline-refuse.out" 2>"$TMP_ROOT/third-baseline-refuse.err")
status=$?
set -e
[ "$status" -ne 0 ] || fail "third-party update should refuse worse baseline"
if ! (cd "$THIRD_BASELINE_DIR" && bun run scripts/lint-ratchet.ts --update \
      --allow-worse --reason "fixture accepts third-party debt" \
      >"$TMP_ROOT/third-baseline-update.out" 2>"$TMP_ROOT/third-baseline-update.err"); then
  cat "$TMP_ROOT/third-baseline-update.err"
  fail "third-party allow-worse update should write baseline"
fi
grep -qF '"count": 1' "$THIRD_BASELINE_DIR/lint-ratchet.baseline.json" \
  || fail "third-party allow-worse update did not write finding count"

# --- Fixture: third-party generated config and cache path are deterministic --
DETERMINISTIC_CONFIG=$(third_party_config_path "$THIRD_PARTY_DIR")
[ -n "$DETERMINISTIC_CONFIG" ] || fail "third-party deterministic config missing"
cp "$DETERMINISTIC_CONFIG" "$TMP_ROOT/third-party.config.before"
DETERMINISTIC_PATH_BEFORE="$DETERMINISTIC_CONFIG"
if ! (cd "$THIRD_PARTY_DIR" && bun run scripts/lint-ratchet.ts \
      >"$TMP_ROOT/third-party-deterministic.out" \
      2>"$TMP_ROOT/third-party-deterministic.err"); then
  cat "$TMP_ROOT/third-party-deterministic.err"
  fail "third-party deterministic rerun failed"
fi
DETERMINISTIC_PATH_AFTER=$(third_party_config_path "$THIRD_PARTY_DIR")
[ "$DETERMINISTIC_PATH_BEFORE" = "$DETERMINISTIC_PATH_AFTER" ] \
  || fail "third-party cache key changed between identical runs"
cmp -s "$TMP_ROOT/third-party.config.before" "$DETERMINISTIC_PATH_AFTER" \
  || fail "third-party generated config bytes changed between identical runs"

# --- Fixture: third-party package version participates in cache identity -----
VERSION_PATH_BEFORE="$DETERMINISTIC_PATH_AFTER"
ASSERT_FILE="$THIRD_PARTY_DIR/node_modules/eslint-plugin-ratchet-fixture/package.json" bun -e '
  const fs = require("fs");
  const file = process.env.ASSERT_FILE;
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  parsed.version = "1.0.1";
  fs.writeFileSync(file, JSON.stringify(parsed, null, 2) + "\n");
' || fail "third-party package version mutate failed"
if ! (cd "$THIRD_PARTY_DIR" && bun run scripts/lint-ratchet.ts --update \
      >"$TMP_ROOT/third-party-version.out" \
      2>"$TMP_ROOT/third-party-version.err"); then
  cat "$TMP_ROOT/third-party-version.err"
  fail "third-party package version update failed"
fi
VERSION_PATH_AFTER=$(third_party_config_path "$THIRD_PARTY_DIR")
[ "$VERSION_PATH_BEFORE" != "$VERSION_PATH_AFTER" ] \
  || fail "third-party package version did not change the cache/config path"

# --- Fixture: stale cache siblings get swept on next run --------------------
# Inject fake stale cache + config siblings under the production cache layout.
# Sweep must remove the matching stale entries (`<safe-id>-<12hex>`) and leave:
#   - the live entry created by this run (`<safe-id>-<currentHash>`),
#   - an entry for an unrelated ratchet (different safe-id prefix),
#   - an entry whose safe-id is a hyphen-extension of this ratchet's safe-id
#     (`<safe-id>-extended-<12hex>`) — the prefix-collision case.
# Stale entries follow the production naming so the sweeper sees them; the
# prefix-collision and unrelated decoys deliberately use a 12-hex hash so they
# look like real live caches of those (hypothetical) sibling ratchets.
CACHE_ROOT="$REPO_ROOT/node_modules/.cache/eslint-ratchet"
CONFIG_ROOT="$CACHE_ROOT/configs"
SAFE_ID="ratchet-local-type-assertion-boundary"
mkdir -p "$CACHE_ROOT" "$CONFIG_ROOT"
# Stale hash for the live ratchet (must look like a 12-hex cache key so the
# sweeper recognizes it as one of its own and removes it).
STALE_HASH="deadbeef1234"
STALE_CACHE="$CACHE_ROOT/$SAFE_ID-$STALE_HASH"
STALE_CONFIG="$CONFIG_ROOT/$SAFE_ID-$STALE_HASH.mjs"
# Hypothetical sibling whose safe-id is a hyphen-extension of the live ratchet.
# Must survive the sweep.
PREFIX_HASH="cafef00d5678"
PREFIX_CACHE="$CACHE_ROOT/$SAFE_ID-extended-$PREFIX_HASH"
PREFIX_CONFIG="$CONFIG_ROOT/$SAFE_ID-extended-$PREFIX_HASH.mjs"
# Unrelated ratchet whose safe-id is a non-prefix. Must survive the sweep.
UNRELATED_HASH="abcdef012345"
UNRELATED_CACHE="$CACHE_ROOT/ratchet-other-rule-$UNRELATED_HASH"
# Decoys are written into the real cache directory. Register a dedicated trap
# (additive to the existing TMP_ROOT cleanup) so a failed assertion still
# scrubs the surviving decoys.
cleanup_sweep_decoys() {
  rm -rf "$STALE_CACHE" "$STALE_CONFIG" "$PREFIX_CACHE" "$PREFIX_CONFIG" "$UNRELATED_CACHE"
}
trap 'cleanup_sweep_decoys; cleanup' EXIT
mkdir -p "$STALE_CACHE" "$PREFIX_CACHE" "$UNRELATED_CACHE"
echo "stale" > "$STALE_CACHE/.eslintcache"
echo "// stale" > "$STALE_CONFIG"
echo "prefix" > "$PREFIX_CACHE/.eslintcache"
echo "// prefix" > "$PREFIX_CONFIG"
echo "unrelated" > "$UNRELATED_CACHE/.eslintcache"
SWEEP_DIR="$TMP_ROOT/sweep"
build_fixture "$SWEEP_DIR"
write_type_assertion_config "$SWEEP_DIR"
write_clean_source "$SWEEP_DIR"
run_fixture_update "$SWEEP_DIR" || fail "sweep fixture initial update failed"
[ ! -e "$STALE_CACHE" ] || fail "sweep did not remove stale cache sibling: $STALE_CACHE"
[ ! -e "$STALE_CONFIG" ] || fail "sweep did not remove stale config sibling: $STALE_CONFIG"
[ -d "$PREFIX_CACHE" ] \
  || fail "sweep removed a hyphen-extension sibling's cache: $PREFIX_CACHE"
[ -f "$PREFIX_CONFIG" ] \
  || fail "sweep removed a hyphen-extension sibling's config: $PREFIX_CONFIG"
[ -d "$UNRELATED_CACHE" ] || fail "sweep removed an unrelated ratchet's cache: $UNRELATED_CACHE"
cleanup_sweep_decoys
trap cleanup EXIT

# --- Fixture improvements fail check-baseline with update guidance -----------
IMPROVE_DIR="$TMP_ROOT/improve"
build_fixture "$IMPROVE_DIR"
write_type_assertion_config "$IMPROVE_DIR"
write_violation_source "$IMPROVE_DIR"
run_fixture_update "$IMPROVE_DIR" || fail "fixture improve update failed"
write_clean_source "$IMPROVE_DIR"
set +e
(cd "$IMPROVE_DIR" && bun run scripts/lint-ratchet.ts --check-baseline \
  >"$TMP_ROOT/improve-check.out" 2>"$TMP_ROOT/improve-check.err")
status=$?
set -e
[ "$status" -eq 1 ] \
  || fail "check-baseline should fail when current findings improve, got $status: $(cat "$TMP_ROOT/improve-check.err")"
grep -qF "finding count decreased from 1 to 0" "$TMP_ROOT/improve-check.err" \
  || fail "improvement detail missing: $(cat "$TMP_ROOT/improve-check.err")"
grep -qF "run bun run lint:ratchet:update" "$TMP_ROOT/improve-check.err" \
  || fail "improvement repair command missing: $(cat "$TMP_ROOT/improve-check.err")"
improve_before=$(ASSERT_FILE="$IMPROVE_DIR/lint-ratchet.baseline.json" bun -e '
  const fs = require("fs");
  const parsed = JSON.parse(fs.readFileSync(process.env.ASSERT_FILE, "utf8"));
  const test = parsed.tests["ratchet/local-type-assertion-boundary"];
  if (test === undefined) throw new Error("missing type-assertion ratchet");
  const count = Object.values(test.items).reduce((sum, item) => sum + item.count, 0);
  console.log(count);
') || fail "improvement baseline read failed"
[ "$improve_before" -eq 1 ] \
  || fail "improvement baseline should start at 1 finding, got $improve_before"
run_fixture_update "$IMPROVE_DIR" \
  || fail "improvement update did not clear failure: $(cat "$TMP_ROOT/update.err")"
improve_total_after_update=$(ASSERT_FILE="$IMPROVE_DIR/lint-ratchet.baseline.json" bun -e '
  const fs = require("fs");
  const parsed = JSON.parse(fs.readFileSync(process.env.ASSERT_FILE, "utf8"));
  const total = Object.values(parsed.tests).reduce(
    (sum, test) => sum + Object.values(test.items).reduce(
      (itemSum, item) => itemSum + item.count,
      0,
    ),
    0,
  );
  console.log(total);
') || fail "improvement total baseline count read failed"
set +e
(cd "$IMPROVE_DIR" && bun run scripts/lint-ratchet.ts --check-baseline \
  >"$TMP_ROOT/improve-clean-check.out" 2>"$TMP_ROOT/improve-clean-check.err")
status=$?
set -e
[ "$status" -eq 0 ] \
  || fail "check-baseline should pass after improvement update, got $status: $(cat "$TMP_ROOT/improve-clean-check.err")"
grep -qF "lint:ratchet:check-baseline OK — $improve_total_after_update current finding(s)." \
  "$TMP_ROOT/improve-clean-check.err" \
  || fail "check-baseline OK line missing after improvement update: $(cat "$TMP_ROOT/improve-clean-check.err")"
if grep -qF "current findings are better" "$TMP_ROOT/improve-clean-check.err"; then
  fail "check-baseline still reported an improvement after update: $(cat "$TMP_ROOT/improve-clean-check.err")"
fi
if ! (cd "$IMPROVE_DIR" && bun run scripts/lint-ratchet.ts \
      >"$TMP_ROOT/improve-clean.out" 2>"$TMP_ROOT/improve-clean.err"); then
  cat "$TMP_ROOT/improve-clean.err"
  fail "default run should pass after improvement update"
fi
assert_envelope "$TMP_ROOT/improve-clean.out" 0
improve_after=$(ASSERT_FILE="$IMPROVE_DIR/lint-ratchet.baseline.json" bun -e '
  const fs = require("fs");
  const parsed = JSON.parse(fs.readFileSync(process.env.ASSERT_FILE, "utf8"));
  const test = parsed.tests["ratchet/local-type-assertion-boundary"];
  if (test === undefined) throw new Error("missing type-assertion ratchet");
  const count = Object.values(test.items).reduce((sum, item) => sum + item.count, 0);
  console.log(count);
') || fail "improvement baseline reread failed"
[ "$improve_after" -eq 0 ] \
  || fail "improvement baseline should update to 0 findings, got $improve_after"
[ "$improve_before" -gt "$improve_after" ] \
  || fail "improvement baseline did not shrink: $improve_before -> $improve_after"

echo "PASS: lint-ratchet smoke"
