// @ts-check
//
// Loads and validates eslint-config/config-surface-manifest.json, the authored
// inventory of MAINTAINED CONFIG FILES that broad ignore patterns or the normal
// package TypeScript projects would otherwise miss — root/package tool configs
// (eslint.config.js, vitest.config.ts, stryker.*.mjs, ...). See
// docs/guides/lint-ratchet-adoption.md#config-surface-manifest-adoption.
//
// SCOPE, because it gets asked on every new eslint-config/ file: the policy
// modules under eslint-config/ are NOT listed here and must not be added. Two
// globs already reach them as a set — `eslint-config/*.js` for ESLint
// (eslintConfigSupportFiles in path-glob-policy.js) and the same glob as
// tsconfig.eslint-js.json's include for the checkJs lane — so a per-file entry
// here would only duplicate a glob that already holds. Generated modules are no
// exception: neither ratchet-restricted-disable-rules.generated.js nor
// local-plugin.generated.js appears here, and each registers its freshness
// through its own generatedSurface record in harness.controls.json instead.
// (local-plugin.generated.js additionally sits in tsconfig.eslint-js.json's
// exclude; see that file for why.)

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** @typedef {"js" | "mjs" | "ts"} ConfigSurfaceLanguage */
/** @typedef {"root-js" | "root-package-ts" | "script-ts" | "eslint-rules-ts"} ConfigSurfaceGroup */
/** @typedef {"linted"} ConfigSurfaceCoverageStatus */
/**
 * @typedef {{
 *   readonly path: string;
 *   readonly language: ConfigSurfaceLanguage;
 *   readonly group: ConfigSurfaceGroup;
 *   readonly coverageStatus: ConfigSurfaceCoverageStatus;
 * }} ConfigSurfaceEntry
 */

/** @type {ReadonlySet<string>} */
const CONFIG_SURFACE_GROUPS = new Set([
  "root-js",
  "root-package-ts",
  "script-ts",
  "eslint-rules-ts",
]);
/** @type {ReadonlySet<string>} */
const CONFIG_SURFACE_LANGUAGES = new Set(["js", "mjs", "ts"]);
/** @type {ReadonlySet<string>} */
const CONFIG_SURFACE_COVERAGE_STATUSES = new Set(["linted"]);

const manifestPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "config-surface-manifest.json",
);

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
  return typeof value === "object" && value !== null;
}

/** @returns {readonly unknown[]} */
function readRawManifest() {
  /** @type {unknown} */
  const parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!isObject(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.surfaces)) {
    throw new Error("config-surface-manifest.json must declare schemaVersion 1 and surfaces[]");
  }
  return parsed.surfaces;
}

/**
 * @param {Record<string, unknown>} raw
 * @param {string} key
 * @param {number} index
 */
function readStringField(raw, key, index) {
  const value = raw[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `config-surface-manifest.json surfaces[${String(index)}].${key} must be a string`,
    );
  }
  return value;
}

/** @param {string} value @returns {value is ConfigSurfaceLanguage} */
function isConfigSurfaceLanguage(value) {
  return CONFIG_SURFACE_LANGUAGES.has(value);
}

/** @param {string} value @returns {value is ConfigSurfaceGroup} */
function isConfigSurfaceGroup(value) {
  return CONFIG_SURFACE_GROUPS.has(value);
}

/** @param {string} value @returns {value is ConfigSurfaceCoverageStatus} */
function isConfigSurfaceCoverageStatus(value) {
  return CONFIG_SURFACE_COVERAGE_STATUSES.has(value);
}

/**
 * @param {string} path
 * @param {Set<string>} seen
 * @param {number} index
 */
function validatePath(path, seen, index) {
  if (path.startsWith("/") || path.includes("..") || path.includes("\\")) {
    throw new Error(
      `config-surface-manifest.json surfaces[${String(index)}].path is not repo-relative: ${path}`,
    );
  }
  if (seen.has(path)) {
    throw new Error(`config-surface-manifest.json has duplicate path: ${path}`);
  }
  seen.add(path);
}

/** @returns {readonly ConfigSurfaceEntry[]} */
function readConfigSurfaceEntries() {
  const seen = new Set();
  return readRawManifest().map((raw, index) => {
    if (!isObject(raw)) {
      throw new Error(`config-surface-manifest.json surfaces[${String(index)}] must be an object`);
    }
    const path = readStringField(raw, "path", index);
    const language = readStringField(raw, "language", index);
    const group = readStringField(raw, "group", index);
    const coverageStatus = readStringField(raw, "coverageStatus", index);
    validatePath(path, seen, index);
    if (!isConfigSurfaceLanguage(language)) {
      throw new Error(`config-surface-manifest.json ${path} has unsupported language: ${language}`);
    }
    if (!isConfigSurfaceGroup(group)) {
      throw new Error(`config-surface-manifest.json ${path} has unsupported group: ${group}`);
    }
    if (!isConfigSurfaceCoverageStatus(coverageStatus)) {
      throw new Error(
        `config-surface-manifest.json ${path} has unsupported coverageStatus: ${coverageStatus}`,
      );
    }
    return { path, language, group, coverageStatus };
  });
}

export const configSurfaceManifestPath = manifestPath;
/** @type {readonly ConfigSurfaceEntry[]} */
export const configSurfaceEntries = readConfigSurfaceEntries();

/** @type {readonly string[]} */
export const rootJsConfigFiles = configSurfaceEntries
  .filter((entry) => entry.group === "root-js")
  .map((entry) => entry.path);

/** @type {readonly string[]} */
export const rootAndPackageTsConfigFiles = configSurfaceEntries
  .filter((entry) => entry.group === "root-package-ts")
  .map((entry) => entry.path);

/** @type {readonly string[]} */
export const tsConfigFiles = configSurfaceEntries
  .filter((entry) => entry.language === "ts")
  .map((entry) => entry.path);

/** @type {readonly string[]} */
export const extraConfigFileReincludePatterns = configSurfaceEntries
  .filter((entry) => entry.group === "script-ts")
  .map((entry) => `!${entry.path}`);

/** @type {readonly string[]} */
export const eslintRulesConfigReincludePatterns = configSurfaceEntries
  .filter((entry) => entry.group === "eslint-rules-ts")
  .map((entry) => `!${entry.path}`);

/** @type {readonly string[]} */
export const scriptProjectConfigIgnores = configSurfaceEntries
  .filter((entry) => entry.group === "script-ts")
  .map((entry) => entry.path);
