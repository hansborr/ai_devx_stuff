// @ts-check

import {
  extraConfigFileReincludePatterns,
  rootAndPackageTsConfigFiles,
  rootJsConfigFiles,
} from "./config-surfaces.js";

/** @type {readonly `.${string}`[]} */
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

/** @type {readonly string[]} */
export const codeFiles = [extensionsToBraceGlob(jsTsLintableExtensions)];
/** @type {readonly string[]} */
export const typescriptFiles = [
  extensionsToBraceGlob(jsTsLintableExtensions.filter(isTypeScriptLintableExtension)),
];

/** @type {readonly string[]} */
export const eslintConfigSupportFiles = ["eslint-config/*.js"];
/** @type {readonly string[]} */
export const eslintConfigJsFiles = [...rootJsConfigFiles, ...eslintConfigSupportFiles];

/** @type {readonly string[]} */
export const rootConfigReincludePatterns = [
  ...rootJsConfigFiles.map((file) => `!${file}`),
  ...rootAndPackageTsConfigFiles.map((file) => `!${file}`),
];

/** @type {readonly string[]} */
export const configFileReincludePatterns = [
  ...rootConfigReincludePatterns,
  ...extraConfigFileReincludePatterns,
];

/** @type {readonly string[]} */
export const testAndHelperFiles = [
  "**/*.{test,spec}.{js,cjs,mjs,ts,tsx,mts,cts}",
  "**/*test-helper*.{js,cjs,mjs,ts,tsx,mts,cts}",
  "**/test/**/*.{js,cjs,mjs,ts,tsx,mts,cts}",
  "e2e/**/*.{js,cjs,mjs,ts,tsx,mts,cts}",
];

/** @type {readonly string[]} */
export const unitTestFiles = ["**/*.test.{ts,tsx}", "**/*.spec.ts"];
/** @type {readonly string[]} */
export const nonE2eTestIgnores = ["e2e/**/*", "**/e2e/**/*"];

/** @type {readonly string[]} */
export const sharedSourceFiles = ["packages/shared/src/**/*.{ts,tsx}"];
/** @type {readonly string[]} */
export const sharedTestAndHelperSourceFiles = [
  "packages/shared/src/**/*.{test,spec}.{ts,tsx}",
  "packages/shared/src/**/*test-helper*.{ts,tsx}",
  "packages/shared/src/test/**/*.{ts,tsx}",
];

/** @type {readonly string[]} */
export const serverSourceFiles = ["packages/server/src/**/*.{ts,tsx}"];
/** @type {readonly string[]} */
export const serverTestAndHelperSourceFiles = [
  "packages/server/src/**/__type-tests__/**/*.{ts,tsx}",
  "packages/server/src/**/*.{test,spec}.{ts,tsx}",
  "packages/server/src/**/*test-helper*.{ts,tsx}",
  "packages/server/src/test/**/*.{ts,tsx}",
];

/** @type {readonly string[]} */
export const clientSourceFiles = ["packages/client/src/**/*.{ts,tsx}"];
// Codepoint-sorted (`t` < `{`) so the lint-ratchet registry's isSortedUnique
// check — which requires cross-machine-stable codepoint order — accepts this
// list where it is used as ratchet `ignores`. Order is otherwise irrelevant to
// ESLint, which treats these as an ignore/file set.
/** @type {readonly string[]} */
export const clientTestAndHelperSourceFiles = [
  "packages/client/src/**/*.{test,spec}.{ts,tsx}",
  "packages/client/src/**/*test-helper*.{ts,tsx}",
  "packages/client/src/test/**/*.{ts,tsx}",
];

/** @type {readonly string[]} */
export const productionFunctionStructureFiles = [
  "packages/{client,server,shared}/src/**/*.{ts,tsx}",
];

/** @type {readonly string[]} */
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
/** @type {readonly string[]} */
export const productionFunctionStructureIgnores = [
  ...distGeneratedNodeModulesIgnores,
  ...sharedTestAndHelperSourceFiles,
  ...serverTestAndHelperSourceFiles,
  ...clientTestAndHelperSourceFiles,
].sort(byCodepoint);
