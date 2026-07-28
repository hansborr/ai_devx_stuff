// @ts-check

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  configSurfaceEntries,
  eslintRulesConfigReincludePatterns,
  extraConfigFileReincludePatterns,
  rootAndPackageTsConfigFiles,
  rootJsConfigFiles,
  scriptProjectConfigIgnores,
  tsConfigFiles,
} from "./config-surfaces.js";
import {
  MAX_LINES_EXCEPTIONS_TOOL,
  parseMaxLinesExceptionEntry,
} from "./max-lines-exceptions-codec.js";

export const jsTsLintableExtensions = [
  ".js",
  ".jsx",
  ".cjs",
  ".mjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
];

/** @param {readonly string[]} extensions */
const extensionsToBraceGlob = (extensions) =>
  `**/*.{${extensions.map((extension) => extension.slice(1)).join(",")}}`;

/** @param {string} extension */
const isTypeScriptLintableExtension = (extension) =>
  extension.endsWith("ts") || extension === ".tsx";

export const codeFiles = [extensionsToBraceGlob(jsTsLintableExtensions)];
export const typescriptFiles = [
  extensionsToBraceGlob(jsTsLintableExtensions.filter(isTypeScriptLintableExtension)),
];

export { configSurfaceEntries };
export { eslintRulesConfigReincludePatterns };
export { rootAndPackageTsConfigFiles };
export { rootJsConfigFiles };
export { tsConfigFiles };

export const eslintConfigSupportFiles = ["eslint-config/*.js"];
export const eslintConfigJsFiles = [...rootJsConfigFiles, ...eslintConfigSupportFiles];

export const rootConfigReincludePatterns = [
  ...rootJsConfigFiles.map((file) => `!${file}`),
  ...rootAndPackageTsConfigFiles.map((file) => `!${file}`),
];

export const configFileReincludePatterns = [
  ...rootConfigReincludePatterns,
  ...extraConfigFileReincludePatterns,
];

export const scriptTypeScriptFiles = ["scripts/**/*.ts"];
export const serverScriptTypeScriptFiles = [
  "packages/server/prisma/seed*.ts",
  "packages/server/scripts/**/*.ts",
];

export const scriptFixtureIgnores = [
  "scripts/codemods/fixtures/**",
  "scripts/drift-ai/fixtures/**",
  "scripts/fixtures/**",
  "scripts/harness-audit/fixtures/**",
  "scripts/logs-audit/fixtures/**",
];

export const scriptProjectIgnores = [...scriptFixtureIgnores, ...scriptProjectConfigIgnores];

export const codemodSourceFiles = [
  "scripts/codemods/concurrency-guard.ts",
  "scripts/codemods/concurrency-guard/**/*.ts",
  "scripts/codemods/expand-barrel.ts",
  "scripts/codemods/expand-barrel/**/*.ts",
  "scripts/codemods/lib/**/*.ts",
  "scripts/codemods/structured-logging-fix-ast.ts",
  "scripts/codemods/structured-logging-fix-transforms.ts",
  "scripts/codemods/structured-logging-fix.ts",
  "scripts/codemods/trpc-shared-input-candidates.ts",
  "scripts/codemods/trpc-shared-input.ts",
  "scripts/codemods/trpc-shared-output-candidates.ts",
  "scripts/codemods/trpc-shared-output.ts",
];

export const codemodTestFiles = [
  "scripts/codemods/concurrency-guard.test.ts",
  "scripts/codemods/expand-barrel.test.ts",
  "scripts/codemods/structured-logging-fix.test.ts",
  "scripts/codemods/trpc-shared-schema-codemod.test.ts",
];

export const scriptTestAssertFunctionNames = [
  "expect",
  "assertNonPermissiveOutput",
  "expectClean",
  "expectHit",
  "expectOneFulfilledOneConflict",
  "expectParseFailure",
  "expectParseResultSuccess",
  "expectSchemaParseSuccess",
];

export const testAndHelperFiles = [
  "**/*.{test,spec}.{js,cjs,mjs,ts,tsx,mts,cts}",
  "**/*test-helper*.{js,cjs,mjs,ts,tsx,mts,cts}",
  "**/test/**/*.{js,cjs,mjs,ts,tsx,mts,cts}",
  "e2e/**/*.{js,cjs,mjs,ts,tsx,mts,cts}",
];

export const unitTestFiles = ["**/*.test.{ts,tsx}", "**/*.spec.ts"];
export const nonE2eTestIgnores = ["e2e/**/*", "**/e2e/**/*"];

export const sharedSourceFiles = ["packages/shared/src/**/*.{ts,tsx}"];
export const sharedTestAndHelperSourceFiles = [
  "packages/shared/src/**/*.{test,spec}.{ts,tsx}",
  "packages/shared/src/**/*test-helper*.{ts,tsx}",
  "packages/shared/src/test/**/*.{ts,tsx}",
];

export const serverSourceFiles = ["packages/server/src/**/*.{ts,tsx}"];
export const serverTestAndHelperSourceFiles = [
  "packages/server/src/**/__type-tests__/**/*.{ts,tsx}",
  "packages/server/src/**/*.{test,spec}.{ts,tsx}",
  "packages/server/src/**/*test-helper*.{ts,tsx}",
  "packages/server/src/test/**/*.{ts,tsx}",
];

export const clientSourceFiles = ["packages/client/src/**/*.{ts,tsx}"];
// Codepoint-sorted (`t` < `{`) so the lint-ratchet registry's isSortedUnique
// check — which requires cross-machine-stable codepoint order — accepts this
// list where it is used as ratchet `ignores`. Order is otherwise irrelevant to
// ESLint, which treats these as an ignore/file set.
export const clientTestAndHelperSourceFiles = [
  "packages/client/src/**/*.{test,spec}.{ts,tsx}",
  "packages/client/src/**/*test-helper*.{ts,tsx}",
  "packages/client/src/test/**/*.{ts,tsx}",
];

export const productionFunctionStructureFiles = [
  "packages/{client,server,shared}/src/**/*.{ts,tsx}",
];

const distGeneratedNodeModulesIgnores = ["**/dist/**", "**/generated/**", "**/node_modules/**"];

/**
 * Codepoint comparison (UTF-16 code units), not `localeCompare`: this list is
 * consumed as ratchet `ignores`, whose `isSortedUnique` check feeds `configHash`
 * and must return the same verdict on every machine regardless of locale/ICU.
 *
 * @param {string} a
 * @param {string} b
 */
const byCodepoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Compose the production-function-structure ignore set from the single-sourced
// per-package test-and-helper lists plus the common dist/generated/node_modules
// ignores, rather than restating the same globs a third time (a third copy was
// the source of an earlier `*test-helper*` vs `*.test-helper.*` divergence). A
// glob-convention change in one per-package list now propagates here — and to
// the ratchet entries that reuse this constant — without hand-syncing. Sorted
// programmatically by codepoint so the ratchet registry's isSortedUnique gate
// accepts it.
export const productionFunctionStructureIgnores = [
  ...distGeneratedNodeModulesIgnores,
  ...sharedTestAndHelperSourceFiles,
  ...serverTestAndHelperSourceFiles,
  ...clientTestAndHelperSourceFiles,
].sort(byCodepoint);

export const sharedSchemasBarrelRestrictedImportPattern = {
  regex: "^@musi/shared/schemas$",
  message:
    "Why: ADR-0005 keeps `@musi/shared` on subpath exports, so the removed schemas barrel stays removed and bundle graphs stay traceable. How to fix: Import from the specific schema source file, e.g. `@musi/shared/schemas/spell.js`. See docs/adr/0005-shared-subpath-exports.md.",
};

const maxLinesCountingOptions = { skipBlankLines: true, skipComments: true };

const maxLinesExceptionsBaselinePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "max-lines-exceptions.baseline.json",
);
const maxLinesExceptionsConflictMarkerPattern = /^<{7} /mu;
const maxLinesExceptionsConflictMarkerTripwire =
  "eslint-config/max-lines-exceptions.baseline.json is generated; Git conflict markers mean its semantic merge driver was not installed. Run `bun run lint:max-lines-exceptions:install-merge-driver`, restore a parseable side with `bun run baseline:restore-stage -- --ours eslint-config/max-lines-exceptions.baseline.json` (always use stage 2/`--ours`; during rebase stage 2 is the upstream base, not the branch being rebased; if the markers were already committed, restore that side from a parent commit first), then reconcile entries from both sides and normalize with `bun run lint:max-lines-exceptions:update`; never hand-merge conflict markers in this file. Inspect the resulting baseline against both sides before staging; preserve any lower floor from the other side or explicitly accept the regression.";

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPolicyObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The per-file max-lines cap exceptions live in a real baseline on the shared
// item-keyed framework (scripts/lib/baseline), not inline here. Read the
// committed JSON at config-load time — fail-loud, because a missing or malformed
// table would silently drop every cap override and let large files pass. Edit
// the caps in the JSON, then `bun scripts/max-lines-exceptions.ts --update` to
// normalize it; `--check` (default) is the gate.
function readMaxLinesExceptions() {
  let text;
  let parsed;
  try {
    text = readFileSync(maxLinesExceptionsBaselinePath, "utf8");
    parsed = JSON.parse(text);
  } catch {
    if (text !== undefined && maxLinesExceptionsConflictMarkerPattern.test(text)) {
      throw new Error(maxLinesExceptionsConflictMarkerTripwire);
    }
    throw new Error(
      "Could not read or parse eslint-config/max-lines-exceptions.baseline.json; regenerate with `bun run lint:max-lines-exceptions:update`.",
    );
  }
  if (
    !isPolicyObject(parsed) ||
    parsed.tool !== MAX_LINES_EXCEPTIONS_TOOL ||
    !Array.isArray(parsed.entries)
  ) {
    throw new Error(
      "max-lines-exceptions.baseline.json must declare tool 'eslint-max-lines' and an entries[] array",
    );
  }
  // Validate each entry with the shared codec so the live config load enforces
  // the same field schema (severity/lifecycle enums, positive-integer cap) as
  // the --check gate in scripts/max-lines-exceptions-core.ts.
  return parsed.entries.map((/** @type {unknown} */ entry, /** @type {number} */ index) => {
    const result = parseMaxLinesExceptionEntry(entry);
    if (result.ok) return result.value;
    throw new Error(`max-lines exception ${String(index)}: ${result.error}`);
  });
}

const maxLinesExceptions = readMaxLinesExceptions();

// Files a code generator fully owns are exempt from the per-file
// `local/max-lines` cap: the reviewable surface is the generator, not its
// emitted output, and the output grows with registrations (a table row per
// smoke subject), not with logic. This is an explicit allowlist, never a header
// regex — an authored file cannot opt itself out of the size gate by pasting a
// "Do not edit by hand" header; adding a path here is a reviewed change, and
// `bun run lint:max-lines-exceptions` fails loudly if any listed path is missing
// on disk, lacks its declared generator's header, or still carries a redundant
// baseline cap entry. A generated path lives here XOR in the caps baseline, never
// both, so hand-written files keep ratcheting through the baseline exactly as
// before.
const maxLinesGeneratedExemptions = [
  {
    path: "scripts/path-policy/path-policy-smoke-subjects-data.ts",
    generator: "scripts/path-policy/generate-smoke-subjects.ts",
    reason:
      "Generated side-effect-free smoke-subject lookup table keyed by test name; it grows with smoke registrations, not logic, and is rewritten by `bun run test:scripts:subjects`.",
  },
];

export const maxLinesPolicy = {
  counting: maxLinesCountingOptions,
  ratchetFloor: { cap: 300 },
  exceptions: maxLinesExceptions,
  generatedExemptions: maxLinesGeneratedExemptions,
  ratchets: [],
};
