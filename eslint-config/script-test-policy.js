// @ts-check

import { scriptProjectConfigIgnores } from "./config-surfaces.js";

/** @type {readonly string[]} */
export const scriptTypeScriptFiles = ["scripts/**/*.ts"];
/** @type {readonly string[]} */
export const serverScriptTypeScriptFiles = [
  "packages/server/prisma/seed*.ts",
  "packages/server/scripts/**/*.ts",
];

/** @type {readonly string[]} */
export const scriptFixtureIgnores = [
  "scripts/codemods/fixtures/**",
  "scripts/drift-ai/fixtures/**",
  "scripts/fixtures/**",
  "scripts/harness-audit/fixtures/**",
  "scripts/logs-audit/fixtures/**",
];

/** @type {readonly string[]} */
export const scriptProjectIgnores = [...scriptFixtureIgnores, ...scriptProjectConfigIgnores];

/** @type {readonly string[]} */
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

/** @type {readonly string[]} */
export const codemodTestFiles = [
  "scripts/codemods/concurrency-guard.test.ts",
  "scripts/codemods/expand-barrel.test.ts",
  "scripts/codemods/structured-logging-fix.test.ts",
  "scripts/codemods/trpc-shared-schema-codemod.test.ts",
];

/** @type {readonly string[]} */
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
