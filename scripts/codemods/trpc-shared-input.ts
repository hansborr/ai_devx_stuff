#!/usr/bin/env bun
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { Project, SourceFile } from "ts-morph";

import type { ImportBinding, SharedSchemaCodemodCandidate } from "./lib/trpc-shared-schema.js";
import {
  appendSharedSchemaExports,
  CodemodError,
  collectAllowlistedRouterImports,
  collectExportedTopLevelIdentifiers,
  collectTargetIdentifiers,
  createProject,
  discoverSharedSchemaCandidates,
  ensureSharedSchemaImports,
  fail as failWithName,
  getSourceFileAtPath,
  moduleSource,
  normalizeRelativeRouterPath,
  reportSharedSchemaDiscovery,
  rewriteRouterSharedSchemaReferences,
  SHARED_SCHEMA_PREFIX,
  targetPathFromSource,
  validateSharedSchemaCandidates,
  validateSharedSchemaSource,
  writeOrPreviewFiles,
} from "./lib/trpc-shared-schema.js";
import {
  assertConstSchemaIsOnlyInputReference,
  CODEMOD_NAME,
  collectInputCandidates,
  inputTypeNameForSchema,
} from "./trpc-shared-input-candidates.js";

const SHARED_INPUT_PREFIX = SHARED_SCHEMA_PREFIX;

type Candidate = SharedSchemaCodemodCandidate;

type CliArgs =
  | {
      mode: "single";
      routerFile: string;
      targetSource?: string;
      dryRun: boolean;
    }
  | {
      mode: "check";
    };

export type TrpcSharedInputCodemodArgs = string[];

type ParsedCliFlags = {
  check: boolean;
  dryRun: boolean;
  positional: string[];
  targetSource?: string;
};

function fail(message: string): never {
  failWithName(CODEMOD_NAME, message);
}

function initialParsedFlags(): ParsedCliFlags {
  return {
    check: false,
    dryRun: false,
    positional: [],
  };
}

function targetValue(args: string[], index: number): string {
  const value = args[index + 1];
  if (!value) fail("--target requires a shared schema module source.");
  return value;
}

function readFlagArg(args: string[], index: number, parsed: ParsedCliFlags): number {
  const arg = args[index];
  if (!arg) fail("Empty arguments are not supported.");
  if (arg === "--check") {
    parsed.check = true;
    return index;
  }
  if (arg === "--dry-run") {
    parsed.dryRun = true;
    return index;
  }
  if (arg === "--target") {
    parsed.targetSource = targetValue(args, index);
    return index + 1;
  }
  if (arg.startsWith("--target=")) {
    parsed.targetSource = arg.slice("--target=".length);
    return index;
  }
  if (arg.startsWith("-")) fail(`Unknown argument: ${arg}`);
  parsed.positional.push(arg);
  return index;
}

function checkModeArgs(parsed: ParsedCliFlags): CliArgs | undefined {
  if (!parsed.check) return undefined;
  if (parsed.positional.length !== 0 || parsed.targetSource || parsed.dryRun) {
    fail("Usage: bun run codemod:trpc-shared-input -- --check");
  }
  return { mode: "check" };
}

function singleModeArgs(parsed: ParsedCliFlags): CliArgs {
  if (parsed.positional.length !== 1) {
    fail(
      "Usage: bun run codemod:trpc-shared-input -- [--dry-run] [--target <shared-schema.js>] <router-file> | --check",
    );
  }
  const routerFile = parsed.positional[0];
  if (!routerFile) fail("Router file argument is required.");
  return {
    mode: "single",
    routerFile,
    targetSource: parsed.targetSource,
    dryRun: parsed.dryRun,
  };
}

function finalizeArgs(parsed: ParsedCliFlags): CliArgs {
  return checkModeArgs(parsed) ?? singleModeArgs(parsed);
}

function parseArgs(args: string[]): CliArgs {
  const parsed = initialParsedFlags();
  for (let index = 0; index < args.length; index += 1) {
    index = readFlagArg(args, index, parsed);
  }
  return finalizeArgs(parsed);
}

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

function runCheck(root: string): void {
  reportSharedSchemaDiscovery(
    CODEMOD_NAME,
    "input",
    discoverSharedSchemaCandidates(CODEMOD_NAME, root, collectInputCandidates),
  );
}

function rewriteRouter(
  routerFile: SourceFile,
  targetSource: string,
  candidates: Candidate[],
  neededImports: Map<string, ImportBinding>,
): void {
  rewriteRouterSharedSchemaReferences({
    candidates,
    codemodName: CODEMOD_NAME,
    removeLocalNames: neededImports.keys(),
    routerFile,
    targetSource,
  });
}

export function runTrpcSharedInputCodemod(
  argv: TrpcSharedInputCodemodArgs,
  root = process.cwd(),
): void {
  const args = parseArgs(argv);
  if (args.mode === "check") {
    runCheck(root);
    return;
  }
  const routerPath = path.resolve(root, args.routerFile);
  const relativeRouterPath = normalizeRelativeRouterPath(CODEMOD_NAME, root, routerPath);
  if (!existsSync(routerPath)) fail(`${relativeRouterPath} does not exist.`);

  const project = createProject();
  const routerFile = project.addSourceFileAtPath(routerPath);
  const targetSource = resolveTargetSource(
    root,
    project,
    relativeRouterPath,
    routerFile,
    args.targetSource,
  );
  const defaultSource = defaultTargetSource(relativeRouterPath);
  const targetPath = targetPathFromSource(root, targetSource);
  const targetFile = existsSync(targetPath)
    ? getSourceFileAtPath(project, targetPath)
    : project.createSourceFile(targetPath, "", { overwrite: true });

  const candidates = collectInputCandidates(routerFile);
  if (candidates.length === 0) {
    console.log(
      `${CODEMOD_NAME} codemod: no router-local input schemas found in ${relativeRouterPath}.`,
    );
    return;
  }

  const targetIdentifiers = collectTargetIdentifiers(targetFile);
  const neededImports = validateSharedSchemaCandidates({
    allowlistedImports: collectAllowlistedRouterImports(CODEMOD_NAME, routerFile, targetSource),
    assertConstSchemaIsOnlyCallReference: assertConstSchemaIsOnlyInputReference,
    candidates,
    codemodName: CODEMOD_NAME,
    sourceFile: routerFile,
    targetIdentifiers,
    typeNameForSchema: inputTypeNameForSchema,
  });

  ensureSharedSchemaImports(CODEMOD_NAME, targetFile, neededImports, targetIdentifiers);
  appendSharedSchemaExports(targetFile, candidates, inputTypeNameForSchema);
  rewriteRouter(routerFile, targetSource, candidates, neededImports);
  writeOrPreviewFiles(
    CODEMOD_NAME,
    root,
    [
      { path: routerPath, text: routerFile.getFullText() },
      { path: targetPath, text: targetFile.getFullText() },
    ],
    args.dryRun,
  );

  if (targetSource !== defaultSource) {
    console.log(`${CODEMOD_NAME} codemod: selected existing target ${targetSource}.`);
  }
  console.log(
    `${CODEMOD_NAME} codemod: moved ${candidates.map((candidate) => candidate.schemaName).join(", ")}; touched ${relativeRouterPath} and ${path.relative(root, targetPath)}.`,
  );
}

export function runTrpcSharedInputCodemodCli(): void {
  try {
    runTrpcSharedInputCodemod(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CodemodError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runTrpcSharedInputCodemodCli();
}
