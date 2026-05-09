#!/usr/bin/env bun
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { ImportDeclaration, Node, Project, SourceFile, SyntaxKind } from "ts-morph";

import {
  CodemodError,
  createProject,
  fail as failWithName,
  moduleSource,
  sortImportBlocks,
  writeOrPreviewFiles,
} from "./lib/trpc-shared-schema.js";
import type { ImportSpecifierInfo, WritePlan } from "./lib/trpc-shared-schema.js";

const CODEMOD_NAME = "expand-barrel";
const PACKAGES_ROOT = "packages";
const SHARED_SRC_ROOT = path.join("packages", "shared", "src");

type KnownPackageBarrel = {
  readonly barrelRelativePath: string;
  readonly packageSpecifier: string;
};

const KNOWN_PACKAGE_BARRELS: readonly KnownPackageBarrel[] = [
  {
    barrelRelativePath: path.join("packages", "shared", "src", "rules", "index.ts"),
    packageSpecifier: "@musi/shared/rules",
  },
  {
    barrelRelativePath: path.join("packages", "shared", "src", "dice", "index.ts"),
    packageSpecifier: "@musi/shared/dice",
  },
  {
    barrelRelativePath: path.join("packages", "shared", "src", "map", "index.ts"),
    packageSpecifier: "@musi/shared/map",
  },
];

type BarrelContext = {
  readonly barrelPath: string;
  readonly relativeBarrelPath: string;
  readonly packageSpecifier?: string;
};

type CliArgs =
  | { readonly mode: "check" }
  | { readonly mode: "all"; readonly dryRun: boolean }
  | { readonly mode: "single"; readonly context: BarrelContext; readonly dryRun: boolean };

type NewImportGroup = {
  readonly kind: "named";
  readonly source: string;
  readonly declarationTypeOnly: boolean;
  readonly specifiers: ImportSpecifierInfo[];
};

type DefaultImportGroup = {
  readonly kind: "default";
  readonly source: string;
  readonly declarationTypeOnly: boolean;
  readonly local: string;
};

type NamespaceImportGroup = {
  readonly kind: "namespace";
  readonly source: string;
  readonly declarationTypeOnly: boolean;
  readonly local: string;
};

type ImportGroup = NewImportGroup | DefaultImportGroup | NamespaceImportGroup;

type NamedExportBinding = {
  readonly kind: "named";
  readonly importedName: string;
  readonly sourcePath: string;
};

type DefaultExportBinding = {
  readonly kind: "default";
  readonly sourcePath: string;
};

type NamespaceExportBinding = {
  readonly kind: "namespace";
  readonly sourcePath: string;
};

type BarrelLocalExportBinding = {
  readonly kind: "barrel-local";
  readonly exportedName: string;
};

type DirectExportBinding = NamedExportBinding | DefaultExportBinding | NamespaceExportBinding;
type ExportBinding = DirectExportBinding | BarrelLocalExportBinding;
type ExportMap = Map<string, ExportBinding>;

export type ExpandBarrelCodemodArgs = string[];

function fail(message: string): never {
  failWithName(CODEMOD_NAME, message);
}

function usage(): string {
  return [
    "Usage:",
    "bun run codemod:expand-barrel -- --check",
    "bun run codemod:expand-barrel -- --barrel <path> [--dry-run]",
    "bun run codemod:expand-barrel -- --package <specifier> [--dry-run]",
    "bun run codemod:expand-barrel -- --all [--dry-run]",
  ].join("\n");
}

function parseArgs(argv: string[], root: string): CliArgs {
  let barrelArg: string | undefined;
  let packageArg: string | undefined;
  let dryRun = false;
  let all = false;
  let check = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) fail("Empty arguments are not supported.");
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--all") {
      all = true;
      continue;
    }
    if (arg === "--check") {
      check = true;
      continue;
    }
    if (arg === "--barrel") {
      const value = argv[index + 1];
      if (!value) fail("--barrel requires an index.ts path.");
      barrelArg = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--barrel=")) {
      barrelArg = arg.slice("--barrel=".length);
      continue;
    }
    if (arg === "--package") {
      const value = argv[index + 1];
      if (!value) fail("--package requires a package subpath.");
      packageArg = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--package=")) {
      packageArg = arg.slice("--package=".length);
      continue;
    }
    fail(`Unknown argument: ${arg}\n${usage()}`);
  }

  const selectedModes = [check, all, Boolean(barrelArg), Boolean(packageArg)].filter(Boolean);
  if (selectedModes.length !== 1) fail(usage());
  if (check) {
    if (dryRun) fail("--check cannot be combined with --dry-run.");
    return { mode: "check" };
  }
  if (all) return { mode: "all", dryRun };
  if (packageArg) return { mode: "single", context: contextForPackage(root, packageArg), dryRun };
  if (barrelArg) return { mode: "single", context: contextForBarrel(root, barrelArg), dryRun };
  fail(usage());
}

function contextForPackage(root: string, packageSpecifier: string): BarrelContext {
  const known = KNOWN_PACKAGE_BARRELS.find((candidate) => {
    return candidate.packageSpecifier === packageSpecifier;
  });
  if (!known) fail(`Unsupported package barrel: ${packageSpecifier}.`);
  const barrelPath = path.resolve(root, known.barrelRelativePath);
  if (!existsSync(barrelPath)) fail(`${known.barrelRelativePath} does not exist.`);
  return {
    barrelPath,
    relativeBarrelPath: known.barrelRelativePath,
    packageSpecifier,
  };
}

function contextForKnown(root: string, known: KnownPackageBarrel): BarrelContext {
  const barrelPath = path.resolve(root, known.barrelRelativePath);
  return {
    barrelPath,
    relativeBarrelPath: known.barrelRelativePath,
    packageSpecifier: known.packageSpecifier,
  };
}

function knownPackageForBarrel(root: string, barrelPath: string): KnownPackageBarrel | undefined {
  const normalized = path.resolve(barrelPath);
  return KNOWN_PACKAGE_BARRELS.find((candidate) => {
    return path.resolve(root, candidate.barrelRelativePath) === normalized;
  });
}

function contextForBarrel(root: string, barrelArg: string): BarrelContext {
  const barrelPath = path.resolve(root, barrelArg);
  const relativeBarrelPath = path.relative(root, barrelPath);
  if (relativeBarrelPath.startsWith("..") || path.isAbsolute(relativeBarrelPath)) {
    fail("Barrel file must be inside the current repository.");
  }
  if (!/index\.tsx?$/u.test(relativeBarrelPath)) fail("--barrel must point at an index.ts file.");
  if (!existsSync(barrelPath)) fail(`${relativeBarrelPath} does not exist.`);
  const known = knownPackageForBarrel(root, barrelPath);
  return {
    barrelPath,
    relativeBarrelPath,
    packageSpecifier: known?.packageSpecifier,
  };
}

function toPosix(filePath: string): string {
  return filePath.split(path.sep).join(path.posix.sep);
}

function replaceTsExtensionWithJs(filePath: string): string {
  return filePath.replace(/\.tsx?$/u, ".js");
}

function sourcePathCandidates(resolvedModulePath: string): string[] {
  const extension = path.extname(resolvedModulePath);
  if (extension === ".js" || extension === ".mjs" || extension === ".cjs") {
    const withoutExtension = resolvedModulePath.slice(0, -extension.length);
    return [`${withoutExtension}.ts`, `${withoutExtension}.tsx`];
  }
  if (extension === ".ts" || extension === ".tsx") return [resolvedModulePath];
  return [
    `${resolvedModulePath}.ts`,
    `${resolvedModulePath}.tsx`,
    path.join(resolvedModulePath, "index.ts"),
    path.join(resolvedModulePath, "index.tsx"),
  ];
}

function resolveRelativeModulePath(fromFile: string, specifier: string): string | undefined {
  const resolvedModulePath = path.resolve(path.dirname(fromFile), specifier);
  return sourcePathCandidates(resolvedModulePath).find((candidate) => existsSync(candidate));
}

function resolveExportModulePath(sourceFile: SourceFile, specifier: string): string {
  const resolved = resolveRelativeModulePath(sourceFile.getFilePath(), specifier);
  if (!resolved) {
    fail(
      `Could not resolve ${specifier} from ${path.relative(process.cwd(), sourceFile.getFilePath())}.`,
    );
  }
  return resolved;
}

function collectNamedTopLevelExports(sourceFile: SourceFile): Set<string> {
  const identifiers = new Set<string>();
  for (const statement of sourceFile.getStatements()) {
    if (Node.isVariableStatement(statement)) {
      if (!statement.isExported()) continue;
      for (const declaration of statement.getDeclarations()) {
        const nameNode = declaration.getNameNode();
        if (Node.isIdentifier(nameNode)) identifiers.add(nameNode.getText());
      }
      continue;
    }
    if (Node.isFunctionDeclaration(statement) || Node.isClassDeclaration(statement)) {
      if (!statement.isExported() || statement.isDefaultExport()) continue;
      const name = statement.getName();
      if (name) identifiers.add(name);
      continue;
    }
    if (
      Node.isInterfaceDeclaration(statement) ||
      Node.isTypeAliasDeclaration(statement) ||
      Node.isEnumDeclaration(statement)
    ) {
      if (!statement.isExported()) continue;
      const name = statement.getName();
      if (name) identifiers.add(name);
    }
  }
  return identifiers;
}

function bindingEquals(left: ExportBinding, right: ExportBinding): boolean {
  if (left.kind === "barrel-local" && right.kind === "barrel-local") {
    return left.exportedName === right.exportedName;
  }
  if (left.kind === "named" && right.kind === "named") {
    return left.sourcePath === right.sourcePath && left.importedName === right.importedName;
  }
  if (left.kind === "default" && right.kind === "default") {
    return left.sourcePath === right.sourcePath;
  }
  if (left.kind === "namespace" && right.kind === "namespace") {
    return left.sourcePath === right.sourcePath;
  }
  return false;
}

function bindingDescription(binding: ExportBinding): string {
  if (binding.kind === "barrel-local") return `local barrel export ${binding.exportedName}`;
  const relativeSource = path.relative(process.cwd(), binding.sourcePath);
  if (binding.kind === "named") return `${binding.importedName} from ${relativeSource}`;
  if (binding.kind === "default") return `default from ${relativeSource}`;
  return `namespace from ${relativeSource}`;
}

function addSymbol(symbols: ExportMap, symbolName: string, binding: ExportBinding): void {
  if (symbolName === "default") return;
  const existing = symbols.get(symbolName);
  if (!existing) {
    symbols.set(symbolName, binding);
    return;
  }
  if (bindingEquals(existing, binding)) return;
  fail(
    `${symbolName} is exported by both ${bindingDescription(existing)} and ${bindingDescription(binding)}.`,
  );
}

function exportedNameOfSpecifier(specifier: {
  getName: () => string;
  getAliasNode: () => Node | undefined;
}): string {
  return specifier.getAliasNode()?.getText() ?? specifier.getName();
}

function addLocalImportBinding(
  bindings: Map<string, DirectExportBinding>,
  localName: string,
  binding: DirectExportBinding,
): void {
  const existing = bindings.get(localName);
  if (!existing) {
    bindings.set(localName, binding);
    return;
  }
  if (bindingEquals(existing, binding)) return;
  fail(
    `${localName} is imported from both ${bindingDescription(existing)} and ${bindingDescription(
      binding,
    )}.`,
  );
}

function collectLocalImportBindings(sourceFile: SourceFile): Map<string, DirectExportBinding> {
  const bindings = new Map<string, DirectExportBinding>();
  for (const importDeclaration of sourceFile.getImportDeclarations()) {
    const source = moduleSource(importDeclaration);
    if (!source.startsWith(".")) continue;
    const sourcePath = resolveExportModulePath(sourceFile, source);
    for (const namedImport of importDeclaration.getNamedImports()) {
      const importedName = namedImport.getName();
      const localName = namedImport.getAliasNode()?.getText() ?? importedName;
      addLocalImportBinding(bindings, localName, {
        kind: "named",
        importedName,
        sourcePath,
      });
    }
    const defaultImport = importDeclaration.getDefaultImport();
    if (defaultImport) {
      addLocalImportBinding(bindings, defaultImport.getText(), { kind: "default", sourcePath });
    }
    const namespaceImport = importDeclaration.getNamespaceImport();
    if (namespaceImport) {
      addLocalImportBinding(bindings, namespaceImport.getText(), {
        kind: "namespace",
        sourcePath,
      });
    }
  }
  return bindings;
}

function directLocalExportBinding(
  sourcePath: string,
  exportedName: string,
  localName: string,
  localImports: ReadonlyMap<string, DirectExportBinding>,
): DirectExportBinding {
  return localImports.get(localName) ?? { kind: "named", importedName: exportedName, sourcePath };
}

function barrelLocalExportBinding(
  exportedName: string,
  localName: string,
  localImports: ReadonlyMap<string, DirectExportBinding>,
): ExportBinding {
  return localImports.get(localName) ?? { kind: "barrel-local", exportedName };
}

function collectExportMap(
  project: Project,
  sourcePath: string,
  pathStack: ReadonlySet<string>,
): ExportMap {
  if (pathStack.has(sourcePath)) return new Map();
  const nextStack = new Set(pathStack);
  nextStack.add(sourcePath);

  const sourceFile = project.getSourceFile(sourcePath) ?? project.addSourceFileAtPath(sourcePath);
  const symbols: ExportMap = new Map();
  const localImports = collectLocalImportBindings(sourceFile);
  for (const identifier of collectNamedTopLevelExports(sourceFile)) {
    addSymbol(symbols, identifier, { kind: "named", importedName: identifier, sourcePath });
  }

  for (const exportDeclaration of sourceFile.getExportDeclarations()) {
    const specifier = exportDeclaration.getModuleSpecifierValue();
    const namedExports = exportDeclaration.getNamedExports();
    if (!specifier) {
      for (const namedExport of namedExports) {
        const exportedName = exportedNameOfSpecifier(namedExport);
        addSymbol(
          symbols,
          exportedName,
          directLocalExportBinding(sourcePath, exportedName, namedExport.getName(), localImports),
        );
      }
      continue;
    }

    const targetPath = resolveExportModulePath(sourceFile, specifier);
    const namespaceExport = exportDeclaration.getNamespaceExport();
    if (namespaceExport) {
      addSymbol(symbols, namespaceExport.getName(), { kind: "namespace", sourcePath: targetPath });
      continue;
    }
    if (namedExports.length === 0) {
      for (const [name, binding] of collectExportMap(project, targetPath, nextStack).entries()) {
        addSymbol(symbols, name, binding);
      }
      continue;
    }

    for (const namedExport of namedExports) {
      const exportedName = exportedNameOfSpecifier(namedExport);
      const binding = resolveExportedBinding(project, targetPath, namedExport.getName(), new Set());
      if (!binding) {
        fail(
          `Could not resolve re-export ${exportedName} from ${path.relative(
            process.cwd(),
            targetPath,
          )}.`,
        );
      }
      addSymbol(symbols, exportedName, binding);
    }
  }

  return symbols;
}

function resolveExportedBinding(
  project: Project,
  sourcePath: string,
  symbolName: string,
  seen: ReadonlySet<string>,
): ExportBinding | undefined {
  const key = `${sourcePath}:${symbolName}`;
  if (seen.has(key)) return undefined;
  const nextSeen = new Set(seen);
  nextSeen.add(key);

  const sourceFile = project.getSourceFile(sourcePath) ?? project.addSourceFileAtPath(sourcePath);
  if (symbolName === "default" && sourceFile.getDefaultExportSymbol()) {
    return { kind: "default", sourcePath };
  }
  const localImports = collectLocalImportBindings(sourceFile);
  if (collectNamedTopLevelExports(sourceFile).has(symbolName)) {
    return { kind: "named", importedName: symbolName, sourcePath };
  }

  for (const exportDeclaration of sourceFile.getExportDeclarations()) {
    const specifier = exportDeclaration.getModuleSpecifierValue();
    const namedExports = exportDeclaration.getNamedExports();

    if (!specifier) {
      for (const namedExport of namedExports) {
        if (exportedNameOfSpecifier(namedExport) !== symbolName) continue;
        return directLocalExportBinding(
          sourcePath,
          symbolName,
          namedExport.getName(),
          localImports,
        );
      }
      continue;
    }

    const targetPath = resolveExportModulePath(sourceFile, specifier);
    const namespaceExport = exportDeclaration.getNamespaceExport();
    if (namespaceExport?.getName() === symbolName) {
      return { kind: "namespace", sourcePath: targetPath };
    }
    for (const namedExport of namedExports) {
      if (exportedNameOfSpecifier(namedExport) !== symbolName) continue;
      return resolveExportedBinding(project, targetPath, namedExport.getName(), nextSeen);
    }

    if (namedExports.length === 0) {
      const binding = collectExportMap(project, targetPath, new Set()).get(symbolName);
      if (binding) return binding;
    }
  }

  return undefined;
}

function buildSymbolMap(project: Project, context: BarrelContext): ExportMap {
  const sourceFile =
    project.getSourceFile(context.barrelPath) ?? project.addSourceFileAtPath(context.barrelPath);
  const symbols: ExportMap = new Map();
  const localImports = collectLocalImportBindings(sourceFile);
  for (const identifier of collectNamedTopLevelExports(sourceFile)) {
    addSymbol(symbols, identifier, { kind: "barrel-local", exportedName: identifier });
  }
  for (const exportDeclaration of sourceFile.getExportDeclarations()) {
    const specifier = exportDeclaration.getModuleSpecifierValue();
    if (!specifier) {
      for (const namedExport of exportDeclaration.getNamedExports()) {
        const exportedName = exportedNameOfSpecifier(namedExport);
        addSymbol(
          symbols,
          exportedName,
          barrelLocalExportBinding(exportedName, namedExport.getName(), localImports),
        );
      }
      continue;
    }
    const targetPath = resolveExportModulePath(sourceFile, specifier);
    const namedExports = exportDeclaration.getNamedExports();
    const namespaceExport = exportDeclaration.getNamespaceExport();
    if (namespaceExport) {
      addSymbol(symbols, namespaceExport.getName(), { kind: "namespace", sourcePath: targetPath });
      continue;
    }
    if (namedExports.length === 0) {
      for (const [name, binding] of collectExportMap(project, targetPath, new Set()).entries()) {
        addSymbol(symbols, name, binding);
      }
      continue;
    }
    for (const namedExport of namedExports) {
      const exportedName = exportedNameOfSpecifier(namedExport);
      const binding = resolveExportedBinding(project, targetPath, namedExport.getName(), new Set());
      if (!binding) fail(`Could not resolve ${exportedName} from ${specifier}.`);
      addSymbol(symbols, exportedName, binding);
    }
  }
  if (symbols.size === 0) fail(`${context.relativeBarrelPath} has no re-exported symbols.`);
  return symbols;
}

function discoverPackageFiles(root: string): string[] {
  const packageRoot = path.join(root, PACKAGES_ROOT);
  if (!existsSync(packageRoot)) return [];
  const files: string[] = [];
  const skippedDirectories = new Set(["dist", "generated", "node_modules"]);

  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const currentPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!skippedDirectories.has(entry.name)) visit(currentPath);
        continue;
      }
      if (!statSync(currentPath).isFile()) continue;
      if (currentPath.endsWith(".d.ts")) continue;
      if (!/\.tsx?$/u.test(currentPath)) continue;
      files.push(currentPath);
    }
  };

  visit(packageRoot);
  return files.sort((left, right) => left.localeCompare(right, "en"));
}

function specifierMatchesContext(
  context: BarrelContext,
  consumerPath: string,
  specifier: string,
): boolean {
  if (context.packageSpecifier && specifier === context.packageSpecifier) return true;
  if (!specifier.startsWith(".")) return false;
  const resolved = resolveRelativeModulePath(consumerPath, specifier);
  return resolved === context.barrelPath;
}

function specifierMatchesKnownBarrel(
  consumerPath: string,
  specifier: string,
  root: string,
): boolean {
  return KNOWN_PACKAGE_BARRELS.some((known) => {
    return specifierMatchesContext(contextForKnown(root, known), consumerPath, specifier);
  });
}

function packageOutputSpecifier(context: BarrelContext, sourcePath: string, root: string): string {
  if (!context.packageSpecifier) fail("Internal error: missing package specifier.");
  const barrelDir = path.dirname(context.barrelPath);
  const relativeToBarrel = path.relative(barrelDir, sourcePath);
  if (!relativeToBarrel.startsWith("..") && !path.isAbsolute(relativeToBarrel)) {
    const source = toPosix(replaceTsExtensionWithJs(relativeToBarrel));
    return `${context.packageSpecifier}/${source}`;
  }

  const sharedRelativePath = path.relative(path.join(root, SHARED_SRC_ROOT), sourcePath);
  if (sharedRelativePath === "constants.ts") return "@musi/shared/constants";

  fail(
    `${path.relative(root, sourcePath)} resolves outside ${context.packageSpecifier}; add a package export or rewrite manually.`,
  );
}

function relativeOutputSpecifier(consumerPath: string, sourcePath: string): string {
  const relative = replaceTsExtensionWithJs(path.relative(path.dirname(consumerPath), sourcePath));
  const posix = toPosix(relative);
  return posix.startsWith(".") ? posix : `./${posix}`;
}

function outputSpecifier(
  context: BarrelContext,
  consumerPath: string,
  sourcePath: string,
  root: string,
  originalSpecifier: string,
): string {
  if (!originalSpecifier.startsWith(".") && context.packageSpecifier) {
    return packageOutputSpecifier(context, sourcePath, root);
  }
  return relativeOutputSpecifier(consumerPath, sourcePath);
}

function importSpecifiers(importDeclaration: ImportDeclaration): ImportSpecifierInfo[] {
  const declarationTypeOnly = importDeclaration.isTypeOnly();
  return importDeclaration.getNamedImports().map((specifier) => ({
    imported: specifier.getName(),
    isTypeOnly: declarationTypeOnly ? false : specifier.isTypeOnly(),
    local: specifier.getAliasNode()?.getText() ?? specifier.getName(),
  }));
}

type ImportReplacement = {
  readonly text: string;
  readonly directSources: readonly string[];
};

function importSpecifierText(specifier: ImportSpecifierInfo, declarationTypeOnly: boolean): string {
  const typePrefix = !declarationTypeOnly && specifier.isTypeOnly ? "type " : "";
  if (specifier.imported === specifier.local) return `${typePrefix}${specifier.local}`;
  return `${typePrefix}${specifier.imported} as ${specifier.local}`;
}

function groupImportSpecifier(
  groups: Map<string, ImportGroup>,
  source: string,
  declarationTypeOnly: boolean,
  specifier: ImportSpecifierInfo,
): void {
  const key = `named\0${source}\0${String(declarationTypeOnly)}`;
  const current = groups.get(key);
  if (current?.kind === "named") {
    current.specifiers.push(specifier);
    return;
  }
  groups.set(key, {
    kind: "named",
    source,
    declarationTypeOnly,
    specifiers: [specifier],
  });
}

function groupDefaultImport(
  groups: Map<string, ImportGroup>,
  source: string,
  declarationTypeOnly: boolean,
  local: string,
  filePath: string,
  lineNumber: number,
  root: string,
): void {
  const key = `default\0${source}\0${String(declarationTypeOnly)}`;
  const current = groups.get(key);
  if (current?.kind === "default") {
    if (current.local === local) return;
    fail(
      `${path.relative(root, filePath)}:${String(
        lineNumber,
      )} default export from ${source} would need multiple local names.`,
    );
  }
  groups.set(key, { kind: "default", source, declarationTypeOnly, local });
}

function groupNamespaceImport(
  groups: Map<string, ImportGroup>,
  source: string,
  declarationTypeOnly: boolean,
  local: string,
): void {
  const key = `namespace\0${source}\0${String(declarationTypeOnly)}\0${local}`;
  if (groups.has(key)) return;
  groups.set(key, { kind: "namespace", source, declarationTypeOnly, local });
}

function importGroupSortKey(group: ImportGroup): string {
  const kindRank = group.kind === "default" ? "1" : group.kind === "named" ? "2" : "3";
  const local = group.kind === "named" ? "" : group.local;
  return `${group.source}\0${kindRank}\0${local}`;
}

function formatImportGroup(group: ImportGroup): string {
  const typePrefix = group.declarationTypeOnly ? "type " : "";
  if (group.kind === "default") {
    return `import ${typePrefix}${group.local} from "${group.source}";`;
  }
  if (group.kind === "namespace") {
    return `import ${typePrefix}* as ${group.local} from "${group.source}";`;
  }
  const specifiers = [...group.specifiers].sort((left, right) => {
    return (
      left.local.localeCompare(right.local, "en") ||
      left.imported.localeCompare(right.imported, "en")
    );
  });
  return `import ${typePrefix}{ ${specifiers
    .map((specifier) => importSpecifierText(specifier, group.declarationTypeOnly))
    .join(", ")} } from "${group.source}";`;
}

function warningPrefix(root: string, filePath: string, line: number): string {
  return `${CODEMOD_NAME} codemod: warning ${path.relative(root, filePath)}:${String(line)}`;
}

function replacementForImport(
  context: BarrelContext,
  symbolMap: ExportMap,
  sourceFile: SourceFile,
  importDeclaration: ImportDeclaration,
  root: string,
): ImportReplacement | undefined {
  const source = moduleSource(importDeclaration);
  const defaultImport = importDeclaration.getDefaultImport();
  if (defaultImport) {
    fail(
      `${path.relative(root, sourceFile.getFilePath())}:${String(
        importDeclaration.getStartLineNumber(),
      )} default imports from barrel ${source} are not supported.`,
    );
  }

  const namespaceImport = importDeclaration.getNamespaceImport();
  if (namespaceImport) {
    console.log(
      `${warningPrefix(
        root,
        sourceFile.getFilePath(),
        importDeclaration.getStartLineNumber(),
      )} namespace import from ${source} left unchanged.`,
    );
    return undefined;
  }

  const specifiers = importSpecifiers(importDeclaration);
  if (specifiers.length === 0) {
    console.log(
      `${warningPrefix(
        root,
        sourceFile.getFilePath(),
        importDeclaration.getStartLineNumber(),
      )} side-effect import from ${source} left unchanged.`,
    );
    return undefined;
  }

  const groups = new Map<string, ImportGroup>();
  const directSources = new Set<string>();
  let hasDirectBinding = false;
  for (const specifier of specifiers) {
    const binding = symbolMap.get(specifier.imported);
    if (!binding) {
      fail(
        `${path.relative(root, sourceFile.getFilePath())}:${String(
          importDeclaration.getStartLineNumber(),
        )} ${specifier.imported} is not exported by ${context.relativeBarrelPath}.`,
      );
    }
    if (binding.kind === "barrel-local") {
      groupImportSpecifier(groups, source, importDeclaration.isTypeOnly(), {
        ...specifier,
        imported: binding.exportedName,
      });
      continue;
    }

    const directSource = outputSpecifier(
      context,
      sourceFile.getFilePath(),
      binding.sourcePath,
      root,
      source,
    );
    hasDirectBinding = true;
    directSources.add(directSource);
    if (binding.kind === "named") {
      groupImportSpecifier(groups, directSource, importDeclaration.isTypeOnly(), {
        ...specifier,
        imported: binding.importedName,
      });
      continue;
    }
    const declarationTypeOnly = importDeclaration.isTypeOnly() || Boolean(specifier.isTypeOnly);
    if (binding.kind === "default") {
      groupDefaultImport(
        groups,
        directSource,
        declarationTypeOnly,
        specifier.local,
        sourceFile.getFilePath(),
        importDeclaration.getStartLineNumber(),
        root,
      );
      continue;
    }
    groupNamespaceImport(groups, directSource, declarationTypeOnly, specifier.local);
  }

  if (!hasDirectBinding) return undefined;
  return {
    text: [...groups.values()]
      .sort((left, right) =>
        importGroupSortKey(left).localeCompare(importGroupSortKey(right), "en"),
      )
      .map(formatImportGroup)
      .join("\n"),
    directSources: [...directSources].sort((left, right) => left.localeCompare(right, "en")),
  };
}

function addDirectMockSources(
  directMockSourcesByOriginalSource: Map<string, Set<string>>,
  originalSource: string,
  directSources: readonly string[],
): void {
  let sources = directMockSourcesByOriginalSource.get(originalSource);
  if (!sources) {
    sources = new Set<string>();
    directMockSourcesByOriginalSource.set(originalSource, sources);
  }
  for (const directSource of directSources) sources.add(directSource);
}

function transformSourceFile(
  context: BarrelContext,
  symbolMap: ExportMap,
  sourceFile: SourceFile,
  root: string,
): boolean {
  let changed = false;
  const directMockSourcesByOriginalSource = new Map<string, Set<string>>();
  const imports = sourceFile
    .getImportDeclarations()
    .filter((importDeclaration) => {
      return specifierMatchesContext(
        context,
        sourceFile.getFilePath(),
        moduleSource(importDeclaration),
      );
    })
    .sort((left, right) => right.getStart() - left.getStart());

  for (const importDeclaration of imports) {
    const originalSource = moduleSource(importDeclaration);
    const replacement = replacementForImport(
      context,
      symbolMap,
      sourceFile,
      importDeclaration,
      root,
    );
    if (!replacement) continue;
    addDirectMockSources(
      directMockSourcesByOriginalSource,
      originalSource,
      replacement.directSources,
    );
    importDeclaration.replaceWithText(replacement.text);
    changed = true;
  }

  return (
    transformMockStringReferences(context, sourceFile, root, directMockSourcesByOriginalSource) ||
    changed
  );
}

function staticString(node: Node | undefined): string | undefined {
  if (!node) return undefined;
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralText();
  }
  return undefined;
}

type MockCallInfo = {
  readonly framework: "jest" | "vi";
  readonly method: "importActual" | "mock";
};

function mockCallInfo(node: Node): MockCallInfo | undefined {
  if (!Node.isCallExpression(node)) return undefined;
  const expression = node.getExpression();
  if (!Node.isPropertyAccessExpression(expression)) return undefined;
  const framework = expression.getExpression().getText();
  const name = expression.getName();
  if (framework === "vi" && (name === "mock" || name === "importActual")) {
    return { framework, method: name };
  }
  if (framework === "jest" && name === "mock") return { framework, method: name };
  return undefined;
}

function mockKey(framework: string, specifier: string): string {
  return `${framework}\0${specifier}`;
}

function collectExistingMockKeys(sourceFile: SourceFile): Set<string> {
  const keys = new Set<string>();
  for (const call of sourceFile.getDescendants().filter(Node.isCallExpression)) {
    const info = mockCallInfo(call);
    if (!info || info.method !== "mock") continue;
    const specifier = staticString(call.getArguments()[0]);
    if (!specifier) continue;
    keys.add(mockKey(info.framework, specifier));
  }
  return keys;
}

function warnMockCallLeftUnchanged(
  sourceFile: SourceFile,
  call: Node,
  info: MockCallInfo,
  specifier: string,
  root: string,
): void {
  console.log(
    `${warningPrefix(
      root,
      sourceFile.getFilePath(),
      call.getStartLineNumber(),
    )} ${info.framework}.${info.method}("${specifier}") left unchanged.`,
  );
}

function transformMockStringReferences(
  context: BarrelContext,
  sourceFile: SourceFile,
  root: string,
  directMockSourcesByOriginalSource: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  let changed = false;
  const existingMockKeys = collectExistingMockKeys(sourceFile);
  const calls = sourceFile
    .getDescendants()
    .filter(Node.isCallExpression)
    .sort((left, right) => right.getStart() - left.getStart());

  for (const call of calls) {
    const info = mockCallInfo(call);
    if (!info) continue;
    const specifier = staticString(call.getArguments()[0]);
    if (!specifier || !specifierMatchesContext(context, sourceFile.getFilePath(), specifier)) {
      continue;
    }
    if (info.method === "importActual" || call.getArguments().length !== 1) {
      warnMockCallLeftUnchanged(sourceFile, call, info, specifier, root);
      continue;
    }

    const directSources = directMockSourcesByOriginalSource.get(specifier);
    if (!directSources || directSources.size === 0) {
      warnMockCallLeftUnchanged(sourceFile, call, info, specifier, root);
      continue;
    }

    const missingDirectSources = [...directSources]
      .sort((left, right) => left.localeCompare(right, "en"))
      .filter((directSource) => !existingMockKeys.has(mockKey(info.framework, directSource)));
    if (missingDirectSources.length === 0) continue;

    const statement = call.getFirstAncestorByKind(SyntaxKind.ExpressionStatement);
    if (!statement || statement.getExpression().getStart() !== call.getStart()) {
      warnMockCallLeftUnchanged(sourceFile, call, info, specifier, root);
      continue;
    }

    statement.replaceWithText(
      [
        statement.getText(),
        ...missingDirectSources.map((directSource) => {
          return `${info.framework}.mock("${directSource}");`;
        }),
      ].join("\n"),
    );
    for (const directSource of missingDirectSources) {
      existingMockKeys.add(mockKey(info.framework, directSource));
    }
    changed = true;
  }
  return changed;
}

function runOne(context: BarrelContext, root: string, dryRun: boolean): void {
  const project = createProject();
  const symbolMap = buildSymbolMap(project, context);
  const plans: WritePlan[] = [];

  for (const filePath of discoverPackageFiles(root)) {
    const sourceFile = project.getSourceFile(filePath) ?? project.addSourceFileAtPath(filePath);
    const changed = transformSourceFile(context, symbolMap, sourceFile, root);
    if (!changed) continue;
    plans.push({
      path: filePath,
      text: sortImportBlocks(sourceFile.getFullText(), filePath),
    });
  }

  if (plans.length === 0) {
    console.log(
      `${CODEMOD_NAME} codemod: no expandable imports found for ${context.relativeBarrelPath}.`,
    );
    return;
  }
  writeOrPreviewFiles(CODEMOD_NAME, root, plans, dryRun);
  console.log(
    `${CODEMOD_NAME} codemod: expanded ${plans.length.toString()} file(s) for ${context.relativeBarrelPath}.`,
  );
}

function runAll(root: string, dryRun: boolean): void {
  for (const known of KNOWN_PACKAGE_BARRELS) {
    const context = contextForKnown(root, known);
    if (!existsSync(context.barrelPath)) {
      console.log(`${CODEMOD_NAME} codemod: skipped missing ${context.relativeBarrelPath}.`);
      continue;
    }
    runOne(context, root, dryRun);
  }
}

function runCheck(root: string): void {
  const project = createProject();
  let findings = 0;
  for (const filePath of discoverPackageFiles(root)) {
    const sourceFile = project.addSourceFileAtPath(filePath);
    for (const importDeclaration of sourceFile.getImportDeclarations()) {
      const source = moduleSource(importDeclaration);
      if (!specifierMatchesKnownBarrel(filePath, source, root)) continue;
      findings += 1;
      console.log(
        `${CODEMOD_NAME} codemod: ${path.relative(root, filePath)}:${String(
          importDeclaration.getStartLineNumber(),
        )} imports ${source}.`,
      );
    }
    for (const exportDeclaration of sourceFile.getExportDeclarations()) {
      const source = exportDeclaration.getModuleSpecifierValue();
      if (!source || !specifierMatchesKnownBarrel(filePath, source, root)) continue;
      findings += 1;
      console.log(
        `${CODEMOD_NAME} codemod: ${path.relative(root, filePath)}:${String(
          exportDeclaration.getStartLineNumber(),
        )} re-exports ${source}.`,
      );
    }
    for (const call of sourceFile.getDescendants().filter(Node.isCallExpression)) {
      const info = mockCallInfo(call);
      if (!info) continue;
      const specifier = staticString(call.getArguments()[0]);
      if (!specifier || !specifierMatchesKnownBarrel(filePath, specifier, root)) continue;
      findings += 1;
      console.log(
        `${CODEMOD_NAME} codemod: ${path.relative(root, filePath)}:${String(
          call.getStartLineNumber(),
        )} ${info.framework}.${info.method} references ${specifier}.`,
      );
    }
  }
  if (findings === 0) console.log(`${CODEMOD_NAME} codemod: no package barrel consumers found.`);
}

export function runExpandBarrelCodemod(argv: ExpandBarrelCodemodArgs, root = process.cwd()): void {
  const args = parseArgs(argv, root);
  if (args.mode === "check") {
    runCheck(root);
    return;
  }
  if (args.mode === "all") {
    runAll(root, args.dryRun);
    return;
  }
  runOne(args.context, root, args.dryRun);
}

export function runExpandBarrelCodemodCli(): void {
  try {
    runExpandBarrelCodemod(process.argv.slice(2));
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
  runExpandBarrelCodemodCli();
}
