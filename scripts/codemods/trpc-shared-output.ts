#!/usr/bin/env bun
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CallExpression, Node, SourceFile, SyntaxKind, VariableStatement } from "ts-morph";

import {
  CodemodError,
  ROUTER_ROOT,
  SHARED_SCHEMA_PREFIX,
  assertSafeSchemaIdentifier,
  collectTargetIdentifiers,
  createProject,
  discoverRouterFiles,
  ensureNamedImport,
  ensureValueImportAvailable,
  fail as failWithName,
  getSourceFileAtPath,
  getTopLevelConstSchemas,
  isReferenceIdentifier,
  isZObjectCall,
  moduleSource,
  namedImportSpecifiers,
  normalizeRelativeRouterPath,
  propertyAssignmentName,
  propertyCallMethod,
  propertyCallObject,
  referencedIdentifiers,
  removeUnusedNamedImport,
  rewriteAllowedSharedImportSource,
  targetHasIdentifier,
  targetPathFromSource,
  validateSharedSchemaSource,
  variableDeclarationName,
  writeOrPreviewFiles,
} from "./lib/trpc-shared-schema.js";
import type {
  ImportBinding,
  ImportSpecifierInfo,
  TargetIdentifiers,
} from "./lib/trpc-shared-schema.js";

const CODEMOD_NAME = "trpc-shared-output";
const OUTPUT_SCHEMA_SUFFIX = "OutputSchema";

type Candidate = {
  kind: "inline" | "const";
  schemaName: string;
  outputCall: CallExpression;
  schemaExpression: Node;
  schemaText: string;
  constStatement?: VariableStatement;
};

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

function fail(message: string): never {
  failWithName(CODEMOD_NAME, message);
}

function parseArgs(args: string[]): CliArgs {
  const positional: string[] = [];
  let targetSource: string | undefined;
  let dryRun = false;
  let all = false;
  let check = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) fail("Empty arguments are not supported.");
    if (arg === "--all") {
      all = true;
      continue;
    }
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
  if (all && check) fail("--all and --check cannot be combined.");
  if (check) {
    if (positional.length !== 0 || targetSource || dryRun) {
      fail("Usage: bun run codemod:trpc-shared-output -- --check");
    }
    return { mode: "check" };
  }
  if (all) {
    if (positional.length !== 0 || targetSource) {
      fail("Usage: bun run codemod:trpc-shared-output -- [--dry-run] --all");
    }
    return { mode: "all", dryRun };
  }
  if (positional.length !== 1) {
    fail(
      "Usage: bun run codemod:trpc-shared-output -- [--dry-run] [--target <shared-schema.js>] <router-file> | --check | [--dry-run] --all",
    );
  }
  const routerFile = positional[0];
  if (!routerFile) fail("Router file argument is required.");
  return { mode: "single", routerFile, targetSource, dryRun };
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

function collectSharedSchemaImports(sourceFile: SourceFile): Set<string> {
  const imports = new Set<string>();
  for (const importDeclaration of sourceFile.getImportDeclarations()) {
    const source = moduleSource(importDeclaration);
    if (importDeclaration.isTypeOnly()) continue;
    if (!source.startsWith(SHARED_SCHEMA_PREFIX)) continue;
    for (const specifier of namedImportSpecifiers(importDeclaration)) imports.add(specifier.local);
  }
  return imports;
}

function collectAllowlistedRouterImports(
  sourceFile: SourceFile,
  targetSource: string,
): Map<string, ImportBinding> {
  const bindings = new Map<string, ImportBinding>();
  for (const importDeclaration of sourceFile.getImportDeclarations()) {
    if (importDeclaration.isTypeOnly()) continue;
    const dependencySource = rewriteAllowedSharedImportSource(
      CODEMOD_NAME,
      moduleSource(importDeclaration),
      targetSource,
    );
    if (!dependencySource) continue;
    for (const specifier of importDeclaration.getNamedImports()) {
      if (specifier.isTypeOnly()) continue;
      const imported = specifier.getName();
      const local = specifier.getAliasNode()?.getText() ?? imported;
      bindings.set(local, { imported, local, targetSource: dependencySource });
    }
  }
  return bindings;
}

function isOutputCall(callExpression: CallExpression): boolean {
  const expression = callExpression.getExpression();
  return Node.isPropertyAccessExpression(expression) && expression.getName() === "output";
}

function isSimpleZObjectExpression(node: Node): boolean {
  // Output schemas intentionally allow permissive z.object(...); input schemas stay strict.
  if (isZObjectCall(node)) return true;
  if (!Node.isCallExpression(node) || propertyCallMethod(node) !== "strict") return false;
  const object = propertyCallObject(node);
  return object ? isZObjectCall(object) : false;
}

function isSharedSchemaArrayExpression(node: Node, sharedImports: Set<string>): boolean {
  if (!Node.isCallExpression(node)) return false;
  const expression = node.getExpression();
  if (!Node.isPropertyAccessExpression(expression)) return false;
  if (expression.getName() !== "array" || expression.getExpression().getText() !== "z") {
    return false;
  }
  const element = node.getArguments()[0];
  return Boolean(element && Node.isIdentifier(element) && sharedImports.has(element.getText()));
}

function procedureName(outputCall: CallExpression): string | undefined {
  for (const ancestor of outputCall.getAncestors()) {
    if (Node.isPropertyAssignment(ancestor)) return propertyAssignmentName(ancestor);
    if (Node.isVariableDeclaration(ancestor)) return variableDeclarationName(ancestor);
  }
  return undefined;
}

function isSupportedOutputExpression(node: Node, sharedImports: Set<string>): boolean {
  return isSimpleZObjectExpression(node) || isSharedSchemaArrayExpression(node, sharedImports);
}

function resolveOutputCandidate(
  outputCall: CallExpression,
  constSchemas: Map<string, VariableStatement>,
  sharedImports: Set<string>,
): Candidate | undefined {
  const argument = outputCall.getArguments()[0];
  if (!argument) fail(".output(...) call has no argument.");

  if (Node.isIdentifier(argument) && sharedImports.has(argument.getText())) return undefined;

  if (Node.isIdentifier(argument)) {
    const constStatement = constSchemas.get(argument.getText());
    if (!constStatement) {
      fail(`${argument.getText()} is not a supported top-level output const schema.`);
    }
    const declaration = constStatement.getDeclarations()[0];
    if (!declaration) fail(`${argument.getText()} is not a supported const schema.`);
    const initializer = declaration.getInitializer();
    if (!initializer || !isSupportedOutputExpression(initializer, sharedImports)) {
      fail(`${argument.getText()} is not a supported simple output schema.`);
    }
    return {
      kind: "const",
      schemaName: argument.getText(),
      outputCall,
      schemaExpression: initializer,
      schemaText: initializer.getText(),
      constStatement,
    };
  }

  if (isSupportedOutputExpression(argument, sharedImports)) {
    const name = procedureName(outputCall);
    if (!name) fail("Could not derive a schema name for inline .output(...) shape.");
    assertSafeSchemaIdentifier(CODEMOD_NAME, name);
    return {
      kind: "inline",
      schemaName: `${name}${OUTPUT_SCHEMA_SUFFIX}`,
      outputCall,
      schemaExpression: argument,
      schemaText: argument.getText(),
    };
  }

  fail(`Unsupported .output(...) shape: ${argument.getText()}.`);
}

function collectCandidates(sourceFile: SourceFile): Candidate[] {
  const constSchemas = getTopLevelConstSchemas(sourceFile);
  const sharedImports = collectSharedSchemaImports(sourceFile);
  const candidates: Candidate[] = [];
  for (const callExpression of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!isOutputCall(callExpression)) continue;
    const candidate = resolveOutputCandidate(callExpression, constSchemas, sharedImports);
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

type DiscoveryResult = {
  candidateCount: number;
  error?: string;
  relativeRouterPath: string;
};

function codemodErrorReason(error: CodemodError): string {
  const prefix = `${CODEMOD_NAME} codemod: `;
  return error.message.startsWith(prefix) ? error.message.slice(prefix.length) : error.message;
}

function discoverOutputCandidates(root: string): DiscoveryResult[] {
  const project = createProject();
  const results: DiscoveryResult[] = [];
  for (const relativeRouterPath of discoverRouterFiles(root)) {
    const routerFile = project.addSourceFileAtPath(path.join(root, relativeRouterPath));
    try {
      const candidates = collectCandidates(routerFile);
      if (candidates.length > 0) {
        results.push({ candidateCount: candidates.length, relativeRouterPath });
      }
    } catch (error) {
      if (error instanceof CodemodError) {
        results.push({
          candidateCount: 0,
          error: codemodErrorReason(error),
          relativeRouterPath,
        });
        continue;
      }
      throw error;
    }
  }
  return results;
}

function reportDiscovery(results: DiscoveryResult[]): void {
  if (results.length === 0) {
    console.log(
      `${CODEMOD_NAME} codemod: no router-local output schemas found under ${ROUTER_ROOT}.`,
    );
    return;
  }
  for (const result of results) {
    if (result.error) {
      console.log(
        `${CODEMOD_NAME} codemod: check ${result.relativeRouterPath}: unsupported (${result.error})`,
      );
      continue;
    }
    console.log(
      `${CODEMOD_NAME} codemod: check ${result.relativeRouterPath}: ${result.candidateCount} candidate(s).`,
    );
  }
}

function runCheck(root: string): void {
  reportDiscovery(discoverOutputCandidates(root));
}

function upperFirst(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function typeNameForSchema(schemaName: string): string {
  // Keep this suffix policy in sync with docs/guides/add-trpc-procedure.md.
  if (schemaName.endsWith(OUTPUT_SCHEMA_SUFFIX)) {
    return `${upperFirst(schemaName.slice(0, -OUTPUT_SCHEMA_SUFFIX.length))}Output`;
  }
  for (const suffix of ["ResponseSchema", "ResultSchema", "Schema"]) {
    if (!schemaName.endsWith(suffix)) continue;
    const typeSuffix = suffix.slice(0, -"Schema".length);
    return `${upperFirst(schemaName.slice(0, -suffix.length))}${typeSuffix}`;
  }
  fail(`${schemaName} does not end with a supported schema suffix; move it manually.`);
}

function isOutputCallArgument(identifier: Node, outputCall: CallExpression): boolean {
  return identifier === outputCall.getArguments()[0];
}

function assertConstSchemaIsOnlyOutputReference(
  candidate: Candidate,
  sourceFile: SourceFile,
): void {
  if (!candidate.constStatement) return;
  for (const identifier of sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)) {
    if (identifier.getText() !== candidate.schemaName) continue;
    if (!isReferenceIdentifier(identifier)) continue;
    if (isOutputCallArgument(identifier, candidate.outputCall)) continue;
    fail(
      `${candidate.schemaName} has references outside the migrated .output(...) call; move it manually.`,
    );
  }
}

function isSelfImport(targetSource: string, binding: ImportBinding): boolean {
  // Covers default-target self-imports for values not yet exported by the target file.
  const selfSource = rewriteAllowedSharedImportSource(CODEMOD_NAME, targetSource, targetSource);
  return binding.targetSource === selfSource;
}

function validateCandidates(
  sourceFile: SourceFile,
  targetSource: string,
  candidates: Candidate[],
  targetIdentifiers: TargetIdentifiers,
  allowlistedImports: Map<string, ImportBinding>,
): Map<string, ImportBinding> {
  const seen = new Set<string>();
  const seenTypeNames = new Set<string>();
  const neededImports = new Map<string, ImportBinding>();
  for (const candidate of candidates) {
    if (seen.has(candidate.schemaName)) {
      fail(`${candidate.schemaName} is generated more than once in this file.`);
    }
    seen.add(candidate.schemaName);
    if (targetHasIdentifier(targetIdentifiers, candidate.schemaName)) {
      fail(`${candidate.schemaName} already exists in the target shared schema file.`);
    }
    const typeName = typeNameForSchema(candidate.schemaName);
    if (seenTypeNames.has(typeName)) {
      fail(`${typeName} is generated more than once in this file.`);
    }
    seenTypeNames.add(typeName);
    if (targetHasIdentifier(targetIdentifiers, typeName)) {
      fail(`${typeName} already exists in the target shared schema file.`);
    }
    assertConstSchemaIsOnlyOutputReference(candidate, sourceFile);
    for (const identifier of referencedIdentifiers(candidate.schemaExpression)) {
      if (identifier === "z") continue;
      if (targetIdentifiers.value.has(identifier)) continue;
      const binding = allowlistedImports.get(identifier);
      if (binding && !isSelfImport(targetSource, binding)) {
        neededImports.set(identifier, binding);
        continue;
      }
      fail(
        `${identifier} is not available in the target shared schema file; import it from a supported shared module or move this schema manually.`,
      );
    }
  }
  return neededImports;
}

function ensureSharedImports(
  targetFile: SourceFile,
  neededImports: Map<string, ImportBinding>,
  targetIdentifiers: TargetIdentifiers,
): void {
  if (!targetIdentifiers.value.has("z")) {
    ensureValueImportAvailable(CODEMOD_NAME, targetFile, "zod", { imported: "z", local: "z" });
    ensureNamedImport(targetFile, "zod", [{ imported: "z", local: "z" }]);
  }
  const grouped = new Map<string, ImportSpecifierInfo[]>();
  for (const binding of neededImports.values()) {
    ensureValueImportAvailable(CODEMOD_NAME, targetFile, binding.targetSource, binding);
    const current = grouped.get(binding.targetSource) ?? [];
    current.push({ imported: binding.imported, local: binding.local });
    grouped.set(binding.targetSource, current);
  }
  for (const [source, specifiers] of [...grouped.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    ensureNamedImport(targetFile, source, specifiers);
  }
}

function appendSharedExports(targetFile: SourceFile, candidates: Candidate[]): void {
  const statements = candidates.map((candidate) => {
    const typeName = typeNameForSchema(candidate.schemaName);
    return `export const ${candidate.schemaName} = ${candidate.schemaText};\n\nexport type ${typeName} = z.infer<typeof ${candidate.schemaName}>;`;
  });
  targetFile.addStatements(`\n${statements.join("\n\n")}`);
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
  for (const candidate of candidates) {
    if (candidate.kind === "inline") {
      const argument = candidate.outputCall.getArguments()[0];
      if (!argument) fail(".output(...) call has no argument.");
      argument.replaceWithText(candidate.schemaName);
    }
  }
  for (const candidate of candidates) {
    if (candidate.constStatement) candidate.constStatement.remove();
  }
  ensureNamedImport(
    routerFile,
    targetSource,
    candidates.map((candidate) => ({
      imported: candidate.schemaName,
      local: candidate.schemaName,
    })),
  );
  for (const localName of dependencyImports) removeUnusedNamedImport(routerFile, localName);
  removeUnusedNamedImport(routerFile, "z");
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
  const results = discoverOutputCandidates(root);
  const unsupported = results.filter((result) => result.error);
  if (unsupported.length > 0) {
    reportDiscovery(unsupported);
    fail(`--all stopped because ${unsupported.length} router file(s) need manual output moves.`);
  }

  const candidates = results.filter((result) => result.candidateCount > 0);
  if (candidates.length === 0) {
    console.log(
      `${CODEMOD_NAME} codemod: no router-local output schemas found under ${ROUTER_ROOT}.`,
    );
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
  console.log(`${CODEMOD_NAME} codemod: --all processed ${candidates.length} router file(s).`);
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

  const candidates = collectCandidates(routerFile);
  if (candidates.length === 0) {
    console.log(
      `${CODEMOD_NAME} codemod: no router-local output schemas found in ${relativeRouterPath}.`,
    );
    return;
  }

  const targetIdentifiers = collectTargetIdentifiers(targetFile);
  const neededImports = validateCandidates(
    routerFile,
    targetSource,
    candidates,
    targetIdentifiers,
    collectAllowlistedRouterImports(routerFile, targetSource),
  );

  ensureSharedImports(targetFile, neededImports, targetIdentifiers);
  appendSharedExports(targetFile, candidates);
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
