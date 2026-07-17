import { existsSync } from "node:fs";
import path from "node:path";

import { parseSharedSchemaCodemodArgs } from "./trpc-shared-engine-args.js";
import type {
  SharedSchemaCodemodArgs,
  SharedSchemaCodemodConfig,
} from "./trpc-shared-engine-types.js";
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
  reportSharedSchemaDiscovery,
  rewriteRouterSharedSchemaReferences,
  targetPathFromSource,
  validateSharedSchemaCandidates,
  writeOrPreviewFiles,
} from "./trpc-shared-schema.js";

export type {
  SharedSchemaCodemodArgs,
  SharedSchemaCodemodConfig,
  SharedSchemaTargetContext,
} from "./trpc-shared-engine-types.js";

type SingleRunArgs = {
  routerFile: string;
  targetSource?: string;
  dryRun: boolean;
};

function fail(config: SharedSchemaCodemodConfig, message: string): never {
  failWithName(config.codemodName, message);
}

function runCheck(config: SharedSchemaCodemodConfig, root: string): void {
  reportSharedSchemaDiscovery(
    config.codemodName,
    config.kind,
    discoverSharedSchemaCandidates(config.codemodName, root, config.collectCandidates),
  );
}

function runSingle(config: SharedSchemaCodemodConfig, args: SingleRunArgs, root: string): void {
  const routerPath = path.resolve(root, args.routerFile);
  const relativeRouterPath = normalizeRelativeRouterPath(config.codemodName, root, routerPath);
  if (!existsSync(routerPath)) fail(config, `${relativeRouterPath} does not exist.`);

  const project = createProject();
  const routerFile = project.addSourceFileAtPath(routerPath);
  const targetSource = config.resolveTargetSource({
    root,
    project,
    relativeRouterPath,
    routerFile,
    explicitTargetSource: args.targetSource,
  });
  const targetPath = targetPathFromSource(root, targetSource);
  const targetFile = existsSync(targetPath)
    ? getSourceFileAtPath(project, targetPath)
    : project.createSourceFile(targetPath, "", { overwrite: true });

  const candidates = config.collectCandidates(routerFile);
  if (candidates.length === 0) {
    console.log(
      `${config.codemodName} codemod: no router-local ${config.kind} schemas found in ${relativeRouterPath}.`,
    );
    return;
  }

  const targetIdentifiers = collectTargetIdentifiers(targetFile);
  const neededImports = validateSharedSchemaCandidates({
    allowlistedImports: collectAllowlistedRouterImports(
      config.codemodName,
      routerFile,
      targetSource,
    ),
    assertConstSchemaIsOnlyCallReference: config.assertConstSchemaIsOnlyCallReference,
    candidates,
    codemodName: config.codemodName,
    isImportBindingAllowed: config.isImportBindingAllowed
      ? (binding) => config.isImportBindingAllowed?.(binding, targetSource) ?? true
      : undefined,
    sourceFile: routerFile,
    targetIdentifiers,
    typeNameForSchema: config.typeNameForSchema,
  });

  ensureSharedSchemaImports(config.codemodName, targetFile, neededImports, targetIdentifiers);
  appendSharedSchemaExports(targetFile, candidates, config.typeNameForSchema);
  rewriteRouterSharedSchemaReferences({
    candidates,
    codemodName: config.codemodName,
    removeLocalNames: config.removeLocalNames(candidates, neededImports),
    routerFile,
    targetSource,
  });
  writeOrPreviewFiles(
    config.codemodName,
    root,
    [
      { path: routerPath, text: routerFile.getFullText() },
      { path: targetPath, text: targetFile.getFullText() },
    ],
    args.dryRun,
  );

  if (
    config.announceSelectedTarget &&
    targetSource !== config.defaultTargetSource(relativeRouterPath)
  ) {
    console.log(`${config.codemodName} codemod: selected existing target ${targetSource}.`);
  }
  console.log(
    `${config.codemodName} codemod: moved ${candidates.map((candidate) => candidate.schemaName).join(", ")}; touched ${relativeRouterPath} and ${path.relative(root, targetPath)}.`,
  );
}

function runAll(config: SharedSchemaCodemodConfig, root: string, dryRun: boolean): void {
  const results = discoverSharedSchemaCandidates(
    config.codemodName,
    root,
    config.collectCandidates,
  );
  const unsupported = results.filter((result) => result.error);
  if (unsupported.length > 0) {
    reportSharedSchemaDiscovery(config.codemodName, config.kind, unsupported);
    fail(
      config,
      `--all stopped because ${String(unsupported.length)} router file(s) need manual ${config.kind} moves.`,
    );
  }

  const candidates = results.filter((result) => result.candidateCount > 0);
  if (candidates.length === 0) {
    reportSharedSchemaDiscovery(config.codemodName, config.kind, []);
    return;
  }

  for (const candidate of candidates) {
    runSingle(config, { routerFile: candidate.relativeRouterPath, dryRun }, root);
  }
  console.log(
    `${config.codemodName} codemod: --all processed ${String(candidates.length)} router file(s).`,
  );
}

/**
 * Drive one shared-schema codemod from parsed argv. Behavior (flags, stdout,
 * exit codes) is owned by {@link SharedSchemaCodemodConfig}; the input and
 * output codemods differ only in that config.
 */
export function runSharedSchemaCodemod(
  config: SharedSchemaCodemodConfig,
  argv: SharedSchemaCodemodArgs,
  root = process.cwd(),
): void {
  const args = parseSharedSchemaCodemodArgs(config, argv);
  if (args.mode === "check") {
    runCheck(config, root);
    return;
  }
  if (args.mode === "all") {
    runAll(config, root, args.dryRun);
    return;
  }
  runSingle(config, args, root);
}

/** Shared CLI entrypoint wrapper: map {@link CodemodError} to exit code 1. */
export function runSharedSchemaCodemodCli(run: (argv: SharedSchemaCodemodArgs) => void): void {
  try {
    run(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CodemodError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}
