#!/usr/bin/env bun
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  runSharedSchemaCodemod,
  runSharedSchemaCodemodCli,
  type SharedSchemaCodemodConfig,
  type SharedSchemaTargetContext,
} from "./lib/trpc-shared-engine.js";
import { referencedIdentifiers } from "./lib/trpc-shared-schema-identifiers.js";
import { validateSharedSchemaSource } from "./lib/trpc-shared-schema-paths.js";
import { SHARED_SCHEMA_PREFIX } from "./lib/trpc-shared-schema-types.js";
import {
  assertConstSchemaIsOnlyOutputReference,
  CODEMOD_NAME,
  collectOutputCandidates,
  isSelfImport,
  outputTypeNameForSchema,
} from "./trpc-shared-output-candidates.js";

export type TrpcSharedOutputCodemodArgs = string[];

function defaultTargetSource(routerFile: string): string {
  const basename = path.basename(routerFile, ".ts");
  return `${SHARED_SCHEMA_PREFIX}${basename}.js`;
}

function resolveTargetSource(context: SharedSchemaTargetContext): string {
  if (context.explicitTargetSource) {
    validateSharedSchemaSource(CODEMOD_NAME, context.explicitTargetSource);
    return context.explicitTargetSource;
  }
  return defaultTargetSource(context.relativeRouterPath);
}

const config: SharedSchemaCodemodConfig = {
  announceSelectedTarget: false,
  assertConstSchemaIsOnlyCallReference: assertConstSchemaIsOnlyOutputReference,
  codemodName: CODEMOD_NAME,
  collectCandidates: collectOutputCandidates,
  defaultTargetSource,
  isImportBindingAllowed: (binding, targetSource) => !isSelfImport(targetSource, binding),
  kind: "output",
  removeLocalNames: (candidates, neededImports) => {
    const dependencyImports = new Set(neededImports.keys());
    for (const candidate of candidates) {
      for (const identifier of referencedIdentifiers(candidate.schemaExpression)) {
        if (identifier !== "z") dependencyImports.add(identifier);
      }
    }
    return dependencyImports;
  },
  resolveTargetSource,
  supportsAll: true,
  typeNameForSchema: outputTypeNameForSchema,
  usage: {
    all: "Usage: bun run codemod:trpc-shared-output -- [--dry-run] --all",
    check: "Usage: bun run codemod:trpc-shared-output -- --check",
    single:
      "Usage: bun run codemod:trpc-shared-output -- [--dry-run] [--target <shared-schema.js>] <router-file> | --check | [--dry-run] --all",
  },
};

export function runTrpcSharedOutputCodemod(
  argv: TrpcSharedOutputCodemodArgs,
  root = process.cwd(),
): void {
  runSharedSchemaCodemod(config, argv, root);
}

export function runTrpcSharedOutputCodemodCli(): void {
  runSharedSchemaCodemodCli(runTrpcSharedOutputCodemod);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runTrpcSharedOutputCodemodCli();
}
