// @ts-check

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CONFIG_SURFACE_GROUPS = new Set([
  "root-js",
  "root-package-ts",
  "script-ts",
  "eslint-rules-ts",
]);
const CONFIG_SURFACE_LANGUAGES = new Set(["js", "mjs", "ts"]);
const CONFIG_SURFACE_COVERAGE_STATUSES = new Set(["linted"]);

const manifestPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "config-surface-manifest.json",
);

function isObject(value) {
  return typeof value === "object" && value !== null;
}

function readRawManifest() {
  const parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!isObject(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.surfaces)) {
    throw new Error("config-surface-manifest.json must declare schemaVersion 1 and surfaces[]");
  }
  return parsed.surfaces;
}

function readStringField(raw, key, index) {
  const value = raw[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `config-surface-manifest.json surfaces[${String(index)}].${key} must be a string`,
    );
  }
  return value;
}

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
    if (!CONFIG_SURFACE_LANGUAGES.has(language)) {
      throw new Error(`config-surface-manifest.json ${path} has unsupported language: ${language}`);
    }
    if (!CONFIG_SURFACE_GROUPS.has(group)) {
      throw new Error(`config-surface-manifest.json ${path} has unsupported group: ${group}`);
    }
    if (!CONFIG_SURFACE_COVERAGE_STATUSES.has(coverageStatus)) {
      throw new Error(
        `config-surface-manifest.json ${path} has unsupported coverageStatus: ${coverageStatus}`,
      );
    }
    return { path, language, group, coverageStatus };
  });
}

export const configSurfaceManifestPath = manifestPath;
export const configSurfaceEntries = readConfigSurfaceEntries();

export const rootJsConfigFiles = configSurfaceEntries
  .filter((entry) => entry.group === "root-js")
  .map((entry) => entry.path);

export const rootAndPackageTsConfigFiles = configSurfaceEntries
  .filter((entry) => entry.group === "root-package-ts")
  .map((entry) => entry.path);

export const tsConfigFiles = configSurfaceEntries
  .filter((entry) => entry.language === "ts")
  .map((entry) => entry.path);

export const extraConfigFileReincludePatterns = configSurfaceEntries
  .filter((entry) => entry.group === "script-ts")
  .map((entry) => `!${entry.path}`);

export const eslintRulesConfigReincludePatterns = configSurfaceEntries
  .filter((entry) => entry.group === "eslint-rules-ts")
  .map((entry) => `!${entry.path}`);

export const scriptProjectConfigIgnores = configSurfaceEntries
  .filter((entry) => entry.group === "script-ts")
  .map((entry) => entry.path);
