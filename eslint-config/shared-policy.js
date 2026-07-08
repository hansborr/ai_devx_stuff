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
  "expectParseSuccess",
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
  "packages/shared/src/**/*.test-helper.{ts,tsx}",
  "packages/shared/src/test/**/*.{ts,tsx}",
];

export const serverSourceFiles = ["packages/server/src/**/*.{ts,tsx}"];
export const serverTestAndHelperSourceFiles = [
  "packages/server/src/**/*.{test,spec}.{ts,tsx}",
  "packages/server/src/**/*.test-helper.{ts,tsx}",
  "packages/server/src/test/**/*.{ts,tsx}",
];

export const clientSourceFiles = ["packages/client/src/**/*.{ts,tsx}"];
export const clientTestAndHelperSourceFiles = [
  "packages/client/src/**/*.{test,spec}.{ts,tsx}",
  "packages/client/src/**/*.test-helper.{ts,tsx}",
  "packages/client/src/test/**/*.{ts,tsx}",
];

export const sharedSchemasBarrelRestrictedImportPattern = {
  regex: "^@musi/shared/schemas$",
  message:
    "Import from the specific schema source file, e.g. `@musi/shared/schemas/spell.js`. The barrel was removed; see DX4.1 in docs/roadmap/developer-experience.md.",
};

export const processExitRestrictedSyntax = {
  selector: "CallExpression[callee.object.name='process'][callee.property.name='exit']",
  message:
    "Avoid process.exit(...) outside CLI/bootstrap entrypoints. Set process.exitCode and return/throw so finally blocks, log flushing, and socket teardown can run. If this IS a terminating entrypoint, add the file to the allowlist override in eslint.config.js.",
};

export const processEnvRestrictedSyntax = {
  selector: "MemberExpression[object.name='process'][property.name='env']",
  message:
    "Avoid reading process.env outside config/env.ts. Use serverEnv from packages/server/src/config/env.ts (or add the key there). For child-process spawn `env:` pass-through and the db-status admin tool, add the file to the allowlist override below.",
};

const maxLinesCountingOptions = { skipBlankLines: true, skipComments: true };

const maxLinesExceptionsBaselinePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "max-lines-exceptions.baseline.json",
);

/** @param {unknown} value */
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
  const parsed = JSON.parse(readFileSync(maxLinesExceptionsBaselinePath, "utf8"));
  if (
    !isPolicyObject(parsed) ||
    parsed.tool !== "eslint-max-lines" ||
    !Array.isArray(parsed.entries)
  ) {
    throw new Error(
      "max-lines-exceptions.baseline.json must declare tool 'eslint-max-lines' and an entries[] array",
    );
  }
  return parsed.entries.map((/** @type {unknown} */ entry, /** @type {number} */ index) => {
    if (!isPolicyObject(entry)) {
      throw new Error(`max-lines exception ${String(index)} must be an object`);
    }
    const { path, cap, severity, reason, lifecycle, ratchetExcluded } = entry;
    if (
      typeof path !== "string" ||
      typeof cap !== "number" ||
      (severity !== "error" && severity !== "warn") ||
      typeof reason !== "string" ||
      typeof lifecycle !== "string" ||
      typeof ratchetExcluded !== "boolean"
    ) {
      throw new Error(`max-lines exception ${String(index)} (${String(path)}) is malformed`);
    }
    return { path, cap, severity, reason, lifecycle, ratchetExcluded };
  });
}

const maxLinesExceptions = readMaxLinesExceptions();

export const maxLinesPolicy = {
  counting: maxLinesCountingOptions,
  ratchetFloor: { cap: 300 },
  exceptions: maxLinesExceptions,
  ratchets: [],
};
