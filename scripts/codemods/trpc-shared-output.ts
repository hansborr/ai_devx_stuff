#!/usr/bin/env bun
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { SourceFile } from "ts-morph";

import type { ImportBinding, SharedSchemaCodemodCandidate } from "./lib/trpc-shared-schema.js";
import {
  appendSharedSchemaExports,
  CodemodError,
  collectAllowlistedRouterImports,
  collectTargetIdentifiers,
  createProject,
  discoverSharedSchemaCandidates,
  ensureSharedSchemaImports,
  fail as failWithName,
  getSourceFileAtPath,
  normalizeRelativeRouterPath,
  referencedIdentifiers,
  reportSharedSchemaDiscovery,
  rewriteRouterSharedSchemaReferences,
  SHARED_SCHEMA_PREFIX,
  targetPathFromSource,
  validateSharedSchemaCandidates,
  validateSharedSchemaSource,
  writeOrPreviewFiles,
} from "./lib/trpc-shared-schema.js";
import {
  assertConstSchemaIsOnlyOutputReference,
  CODEMOD_NAME,
  collectOutputCandidates,
  isSelfImport,
  outputTypeNameForSchema,
} from "./trpc-shared-output-candidates.js";

type Candidate = SharedSchemaCodemodCandidate;

type SingleCliArgs = {
  mode: "single";
  routerFile: string;
  targetSource?: string;
  dryRun: boolean;
};

type CliArgs =
  | SingleCliArgs
  | {
      mode: "all";
      dryRun: boolean;
    }
  | {
      mode: "check";
    };

export type TrpcSharedOutputCodemodArgs = string[];

type ParsedCliFlags = {
  all: boolean;
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
    all: false,
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
  if (arg === "--all") {
    parsed.all = true;
    return index;
  }
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
    fail("Usage: bun run codemod:trpc-shared-output -- --check");
  }
  return { mode: "check" };
}

function allModeArgs(parsed: ParsedCliFlags): CliArgs | undefined {
  if (!parsed.all) return undefined;
  if (parsed.positional.length !== 0 || parsed.targetSource) {
    fail("Usage: bun run codemod:trpc-shared-output -- [--dry-run] --all");
  }
  return { mode: "all", dryRun: parsed.dryRun };
}

function singleModeArgs(parsed: ParsedCliFlags): CliArgs {
  if (parsed.positional.length !== 1) {
    fail(
      "Usage: bun run codemod:trpc-shared-output -- [--dry-run] [--target <shared-schema.js>] <router-file> | --check | [--dry-run] --all",
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
  if (parsed.all && parsed.check) fail("--all and --check cannot be combined.");
  return checkModeArgs(parsed) ?? allModeArgs(parsed) ?? singleModeArgs(parsed);
}

function parseArgs(args: string[]): CliArgs {
  const parsed = initialParsedFlags();
  for (let index = 0; index < args.length; index += 1) {
    index = readFlagArg(args, index, parsed);
  }
  return finalizeArgs(parsed);
}

function defaultTargetSource(routerFile: string): string {
  const basename = path.basename(routerFile, ".ts");
  return `${SHARED_SCHEMA_PREFIX}${basename}.js`;
}

function resolveTargetSource(routerFile: string, explicitTargetSource: string | undefined): string {
  if (explicitTargetSource) {
    validateSharedSchemaSource(CODEMOD_NAME, explicitTargetSource);
    return explicitTargetSource;
  }
  return defaultTargetSource(routerFile);
}

function runCheck(root: string): void {
  reportSharedSchemaDiscovery(
    CODEMOD_NAME,
    "output",
    discoverSharedSchemaCandidates(CODEMOD_NAME, root, collectOutputCandidates),
  );
}

function rewriteRouter(
  routerFile: SourceFile,
  targetSource: string,
  candidates: Candidate[],
  neededImports: Map<string, ImportBinding>,
): void {
  const dependencyImports = new Set(neededImports.keys());
  for (const candidate of candidates) {
    for (const identifier of referencedIdentifiers(candidate.schemaExpression)) {
      if (identifier !== "z") dependencyImports.add(identifier);
    }
  }
  rewriteRouterSharedSchemaReferences({
    candidates,
    codemodName: CODEMOD_NAME,
    removeLocalNames: dependencyImports,
    routerFile,
    targetSource,
  });
}

export function runTrpcSharedOutputCodemod(
  argv: TrpcSharedOutputCodemodArgs,
  root = process.cwd(),
): void {
  const args = parseArgs(argv);
  if (args.mode === "check") {
    runCheck(root);
    return;
  }
  if (args.mode === "all") {
    runAll(root, args.dryRun);
    return;
  }
  runSingle(args, root);
}

function runAll(root: string, dryRun: boolean): void {
  const results = discoverSharedSchemaCandidates(CODEMOD_NAME, root, collectOutputCandidates);
  const unsupported = results.filter((result) => result.error);
  if (unsupported.length > 0) {
    reportSharedSchemaDiscovery(CODEMOD_NAME, "output", unsupported);
    fail(
      `--all stopped because ${String(unsupported.length)} router file(s) need manual output moves.`,
    );
  }

  const candidates = results.filter((result) => result.candidateCount > 0);
  if (candidates.length === 0) {
    reportSharedSchemaDiscovery(CODEMOD_NAME, "output", []);
    return;
  }

  for (const candidate of candidates) {
    runSingle(
      {
        mode: "single",
        routerFile: candidate.relativeRouterPath,
        dryRun,
      },
      root,
    );
  }
  console.log(
    `${CODEMOD_NAME} codemod: --all processed ${String(candidates.length)} router file(s).`,
  );
}

function runSingle(args: SingleCliArgs, root: string): void {
  const routerPath = path.resolve(root, args.routerFile);
  const relativeRouterPath = normalizeRelativeRouterPath(CODEMOD_NAME, root, routerPath);
  if (!existsSync(routerPath)) fail(`${relativeRouterPath} does not exist.`);

  const project = createProject();
  const routerFile = project.addSourceFileAtPath(routerPath);
  const targetSource = resolveTargetSource(relativeRouterPath, args.targetSource);
  const targetPath = targetPathFromSource(root, targetSource);
  const targetFile = existsSync(targetPath)
    ? getSourceFileAtPath(project, targetPath)
    : project.createSourceFile(targetPath, "", { overwrite: true });

  const candidates = collectOutputCandidates(routerFile);
  if (candidates.length === 0) {
    console.log(
      `${CODEMOD_NAME} codemod: no router-local output schemas found in ${relativeRouterPath}.`,
    );
    return;
  }

  const targetIdentifiers = collectTargetIdentifiers(targetFile);
  const neededImports = validateSharedSchemaCandidates({
    allowlistedImports: collectAllowlistedRouterImports(CODEMOD_NAME, routerFile, targetSource),
    assertConstSchemaIsOnlyCallReference: assertConstSchemaIsOnlyOutputReference,
    candidates,
    codemodName: CODEMOD_NAME,
    isImportBindingAllowed: (binding) => !isSelfImport(targetSource, binding),
    sourceFile: routerFile,
    targetIdentifiers,
    typeNameForSchema: outputTypeNameForSchema,
  });

  ensureSharedSchemaImports(CODEMOD_NAME, targetFile, neededImports, targetIdentifiers);
  appendSharedSchemaExports(targetFile, candidates, outputTypeNameForSchema);
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

  console.log(
    `${CODEMOD_NAME} codemod: moved ${candidates.map((candidate) => candidate.schemaName).join(", ")}; touched ${relativeRouterPath} and ${path.relative(root, targetPath)}.`,
  );
}

export function runTrpcSharedOutputCodemodCli(): void {
  try {
    runTrpcSharedOutputCodemod(process.argv.slice(2));
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
  runTrpcSharedOutputCodemodCli();
}
