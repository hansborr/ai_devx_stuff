#!/usr/bin/env bun
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { Project, SourceFile } from "ts-morph";

import { moduleSource } from "./lib/codemod-imports.js";
import {
  runSharedSchemaCodemod,
  runSharedSchemaCodemodCli,
  type SharedSchemaCodemodConfig,
  type SharedSchemaTargetContext,
} from "./lib/trpc-shared-engine.js";
import { collectExportedTopLevelIdentifiers } from "./lib/trpc-shared-schema-identifiers.js";
import {
  getSourceFileAtPath,
  targetPathFromSource,
  validateSharedSchemaSource,
} from "./lib/trpc-shared-schema-paths.js";
import { SHARED_SCHEMA_PREFIX } from "./lib/trpc-shared-schema-types.js";
import {
  assertConstSchemaIsOnlyInputReference,
  CODEMOD_NAME,
  collectInputCandidates,
  inputTypeNameForSchema,
} from "./trpc-shared-input-candidates.js";

const SHARED_INPUT_PREFIX = SHARED_SCHEMA_PREFIX;

export type TrpcSharedInputCodemodArgs = string[];

function validateTargetSource(source: string): void {
  validateSharedSchemaSource(CODEMOD_NAME, source);
}

function defaultTargetSource(routerFile: string): string {
  const basename = path.basename(routerFile, ".ts");
  return `${SHARED_INPUT_PREFIX}${basename}-inputs.js`;
}

function sameDomainTargetSource(routerFile: string): string {
  const basename = path.basename(routerFile, ".ts");
  return `${SHARED_INPUT_PREFIX}${basename}.js`;
}

function targetHasInputExports(project: Project, root: string, source: string): boolean {
  const targetPath = targetPathFromSource(root, source);
  if (!existsSync(targetPath)) return false;
  const sourceFile = getSourceFileAtPath(project, targetPath);
  return [...collectExportedTopLevelIdentifiers(sourceFile)].some(
    (identifier) => identifier.endsWith("InputSchema") || identifier.endsWith("Input"),
  );
}

function resolveTargetSource(
  root: string,
  project: Project,
  routerFile: string,
  routerFileAst: SourceFile,
  explicitTargetSource: string | undefined,
): string {
  if (explicitTargetSource) {
    validateTargetSource(explicitTargetSource);
    return explicitTargetSource;
  }

  const existingInputs = routerFileAst.getImportDeclarations().find((importDeclaration) => {
    const source = moduleSource(importDeclaration);
    return (
      !importDeclaration.isTypeOnly() &&
      source.startsWith(SHARED_INPUT_PREFIX) &&
      source.endsWith("-inputs.js")
    );
  });
  if (existingInputs) return moduleSource(existingInputs);

  const sameDomainSource = sameDomainTargetSource(routerFile);
  const importsSameDomain = routerFileAst
    .getImportDeclarations()
    .some(
      (importDeclaration) =>
        !importDeclaration.isTypeOnly() && moduleSource(importDeclaration) === sameDomainSource,
    );
  if (importsSameDomain && targetHasInputExports(project, root, sameDomainSource)) {
    return sameDomainSource;
  }

  return defaultTargetSource(routerFile);
}

const config: SharedSchemaCodemodConfig = {
  announceSelectedTarget: true,
  assertConstSchemaIsOnlyCallReference: assertConstSchemaIsOnlyInputReference,
  codemodName: CODEMOD_NAME,
  collectCandidates: collectInputCandidates,
  defaultTargetSource,
  kind: "input",
  removeLocalNames: (_candidates, neededImports) => neededImports.keys(),
  resolveTargetSource: (context: SharedSchemaTargetContext) =>
    resolveTargetSource(
      context.root,
      context.project,
      context.relativeRouterPath,
      context.routerFile,
      context.explicitTargetSource,
    ),
  supportsAll: false,
  typeNameForSchema: inputTypeNameForSchema,
  usage: {
    check: "Usage: bun run codemod:trpc-shared-input -- --check",
    single:
      "Usage: bun run codemod:trpc-shared-input -- [--dry-run] [--target <shared-schema.js>] <router-file> | --check",
  },
};

export function runTrpcSharedInputCodemod(
  argv: TrpcSharedInputCodemodArgs,
  root = process.cwd(),
): void {
  runSharedSchemaCodemod(config, argv, root);
}

export function runTrpcSharedInputCodemodCli(): void {
  runSharedSchemaCodemodCli(runTrpcSharedInputCodemod);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runTrpcSharedInputCodemodCli();
}
