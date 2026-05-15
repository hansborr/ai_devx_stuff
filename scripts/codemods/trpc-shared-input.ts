#!/usr/bin/env bun
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CallExpression, Node, Project, SourceFile, SyntaxKind, VariableStatement } from "ts-morph";

import {
  appendSharedSchemaExports,
  CodemodError,
  SHARED_SCHEMA_PREFIX,
  assertSafeSchemaIdentifier,
  collectAllowlistedRouterImports,
  collectExportedTopLevelIdentifiers,
  collectSchemaCallCandidates,
  collectTargetIdentifiers,
  createProject,
  discoverSharedSchemaCandidates,
  ensureSharedSchemaImports,
  fail as failWithName,
  getSourceFileAtPath,
  isReferenceIdentifier,
  isZObjectCall,
  moduleSource,
  normalizeRelativeRouterPath,
  procedureNameForSchemaCall,
  propertyCallMethod,
  propertyCallObject,
  reportSharedSchemaDiscovery,
  rewriteRouterSharedSchemaReferences,
  targetPathFromSource,
  validateSharedSchemaCandidates,
  validateSharedSchemaSource,
  writeOrPreviewFiles,
} from "./lib/trpc-shared-schema.js";
import type { ImportBinding, SharedSchemaCodemodCandidate } from "./lib/trpc-shared-schema.js";

const CODEMOD_NAME = "trpc-shared-input";
const SHARED_INPUT_PREFIX = SHARED_SCHEMA_PREFIX;
const INPUT_SCHEMA_SUFFIX = "InputSchema";
const STRUCTURAL_METHODS = new Set(["extend", "merge", "and", "or"]);

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

function fail(message: string): never {
  failWithName(CODEMOD_NAME, message);
}

function parseArgs(args: string[]): CliArgs {
  const positional: string[] = [];
  let targetSource: string | undefined;
  let dryRun = false;
  let check = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) fail("Empty arguments are not supported.");
    if (arg === "--check") {
      check = true;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--target") {
      const value = args[index + 1];
      if (!value) fail("--target requires a shared schema module source.");
      targetSource = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--target=")) {
      targetSource = arg.slice("--target=".length);
      continue;
    }
    if (arg.startsWith("-")) fail(`Unknown argument: ${arg}`);
    positional.push(arg);
  }
  if (check) {
    if (positional.length !== 0 || targetSource || dryRun) {
      fail("Usage: bun run codemod:trpc-shared-input -- --check");
    }
    return { mode: "check" };
  }
  if (positional.length !== 1) {
    fail(
      "Usage: bun run codemod:trpc-shared-input -- [--dry-run] [--target <shared-schema.js>] <router-file> | --check",
    );
  }
  const routerFile = positional[0];
  if (!routerFile) fail("Router file argument is required.");
  return { mode: "single", routerFile, targetSource, dryRun };
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
    (identifier) => identifier.endsWith(INPUT_SCHEMA_SUFFIX) || identifier.endsWith("Input"),
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

function isStrictZObjectExpression(node: Node): boolean {
  if (!Node.isCallExpression(node) || propertyCallMethod(node) !== "strict") return false;
  const object = propertyCallObject(node);
  return object ? isZObjectCall(object) : false;
}

function structuralCombinator(node: Node): string | undefined {
  const calls = [node, ...node.getDescendantsOfKind(SyntaxKind.CallExpression)];
  for (const current of calls) {
    if (!Node.isCallExpression(current)) continue;
    const method = propertyCallMethod(current);
    if (method && STRUCTURAL_METHODS.has(method)) return method;
  }
  return undefined;
}

function sharedInputRootName(node: Node): string | undefined {
  if (Node.isIdentifier(node)) return node.getText();
  if (!Node.isCallExpression(node)) return undefined;
  const method = propertyCallMethod(node);
  if (method !== "optional" && method !== "describe") return undefined;
  const object = propertyCallObject(node);
  return object ? sharedInputRootName(object) : undefined;
}

function resolveInputCandidate(
  inputCall: CallExpression,
  constSchemas: Map<string, VariableStatement>,
  sharedImports: Set<string>,
): Candidate | undefined {
  const argument = inputCall.getArguments()[0];
  if (!argument) fail(".input(...) call has no argument.");

  const sharedRoot = sharedInputRootName(argument);
  if (sharedRoot && sharedImports.has(sharedRoot)) return undefined;

  const combinator = structuralCombinator(argument);
  if (combinator) fail(`Unsupported .${combinator}(...) input shape. Move it manually.`);

  if (Node.isIdentifier(argument)) {
    const constStatement = constSchemas.get(argument.getText());
    if (!constStatement) {
      fail(
        `${argument.getText()} is not a supported top-level z.object(...).strict() const schema.`,
      );
    }
    const declaration = constStatement.getDeclarations()[0];
    if (!declaration) fail(`${argument.getText()} is not a supported const schema.`);
    const initializer = declaration.getInitializer();
    if (!initializer || !isStrictZObjectExpression(initializer)) {
      fail(`${argument.getText()} is not initialized to z.object(...).strict().`);
    }
    return {
      kind: "const",
      schemaName: argument.getText(),
      schemaCall: inputCall,
      schemaExpression: initializer,
      schemaText: initializer.getText(),
      constStatement,
    };
  }

  if (isStrictZObjectExpression(argument)) {
    const name = procedureNameForSchemaCall(inputCall);
    if (!name) fail("Could not derive a schema name for inline .input(...) shape.");
    assertSafeSchemaIdentifier(CODEMOD_NAME, name);
    return {
      kind: "inline",
      schemaName: `${name}${INPUT_SCHEMA_SUFFIX}`,
      schemaCall: inputCall,
      schemaExpression: argument,
      schemaText: argument.getText(),
    };
  }

  fail(`Unsupported .input(...) shape: ${argument.getText()}.`);
}

function collectCandidates(sourceFile: SourceFile): Candidate[] {
  return collectSchemaCallCandidates(
    sourceFile,
    "input",
    SHARED_INPUT_PREFIX,
    resolveInputCandidate,
  );
}

function runCheck(root: string): void {
  reportSharedSchemaDiscovery(
    CODEMOD_NAME,
    "input",
    discoverSharedSchemaCandidates(CODEMOD_NAME, root, collectCandidates),
  );
}

function typeNameForSchema(schemaName: string): string {
  if (!schemaName.endsWith(INPUT_SCHEMA_SUFFIX)) {
    fail(
      `${schemaName} does not end with InputSchema; move it manually so the input type name is explicit.`,
    );
  }
  const base = schemaName.slice(0, -INPUT_SCHEMA_SUFFIX.length);
  return `${base.slice(0, 1).toUpperCase()}${base.slice(1)}Input`;
}

function isInputCallArgument(identifier: Node, inputCall: CallExpression): boolean {
  return identifier === inputCall.getArguments()[0];
}

function assertConstSchemaIsOnlyInputReference(candidate: Candidate, sourceFile: SourceFile): void {
  if (!candidate.constStatement) return;
  for (const identifier of sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)) {
    if (identifier.getText() !== candidate.schemaName) continue;
    if (!isReferenceIdentifier(identifier)) continue;
    if (isInputCallArgument(identifier, candidate.schemaCall)) continue;
    fail(
      `${candidate.schemaName} has references outside the migrated .input(...) call; move it manually.`,
    );
  }
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

  const candidates = collectCandidates(routerFile);
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
    typeNameForSchema,
  });

  ensureSharedSchemaImports(CODEMOD_NAME, targetFile, neededImports, targetIdentifiers);
  appendSharedSchemaExports(targetFile, candidates, typeNameForSchema);
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
