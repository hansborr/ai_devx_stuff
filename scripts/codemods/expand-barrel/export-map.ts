import path from "node:path";

import { type Project, type SourceFile } from "ts-morph";

import { fail } from "./errors.js";
import {
  addSymbol,
  barrelLocalExportBinding,
  collectLocalImportBindings,
  collectNamedTopLevelExports,
  directLocalExportBinding,
  exportedNameOfSpecifier,
} from "./export-bindings.js";
import { resolveExportModulePath } from "./paths.js";
import type {
  BarrelContext,
  DirectExportBinding,
  ExportBinding,
  ExportMap,
} from "./types.js";

type NamedExportSpecifiers = ReturnType<
  ReturnType<SourceFile["getExportDeclarations"]>[number]["getNamedExports"]
>;

function addTopLevelDirectExports(symbols: ExportMap, sourceFile: SourceFile): void {
  for (const identifier of collectNamedTopLevelExports(sourceFile)) {
    addSymbol(symbols, identifier, {
      kind: "named",
      importedName: identifier,
      sourcePath: sourceFile.getFilePath(),
    });
  }
}

function addLocalExportDeclarationSymbols(
  symbols: ExportMap,
  sourcePath: string,
  localImports: ReadonlyMap<string, DirectExportBinding>,
  namedExports: NamedExportSpecifiers,
): void {
  for (const namedExport of namedExports) {
    const exportedName = exportedNameOfSpecifier(namedExport);
    addSymbol(
      symbols,
      exportedName,
      directLocalExportBinding(sourcePath, exportedName, namedExport.getName(), localImports),
    );
  }
}

function addStarExportSymbols(
  project: Project,
  symbols: ExportMap,
  targetPath: string,
  nextStack: ReadonlySet<string>,
): void {
  for (const [name, binding] of collectExportMap(project, targetPath, nextStack).entries()) {
    addSymbol(symbols, name, binding);
  }
}

function addNamedReExportSymbols(
  project: Project,
  symbols: ExportMap,
  targetPath: string,
  namedExports: NamedExportSpecifiers,
): void {
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

function addExportDeclarationSymbols(
  project: Project,
  sourceFile: SourceFile,
  sourcePath: string,
  nextStack: ReadonlySet<string>,
  symbols: ExportMap,
  localImports: ReadonlyMap<string, DirectExportBinding>,
): void {
  for (const exportDeclaration of sourceFile.getExportDeclarations()) {
    const specifier = exportDeclaration.getModuleSpecifierValue();
    const namedExports = exportDeclaration.getNamedExports();
    if (!specifier) {
      addLocalExportDeclarationSymbols(symbols, sourcePath, localImports, namedExports);
      continue;
    }

    const targetPath = resolveExportModulePath(sourceFile, specifier);
    const namespaceExport = exportDeclaration.getNamespaceExport();
    if (namespaceExport) {
      addSymbol(symbols, namespaceExport.getName(), { kind: "namespace", sourcePath: targetPath });
      continue;
    }
    if (namedExports.length === 0) {
      addStarExportSymbols(project, symbols, targetPath, nextStack);
      continue;
    }
    addNamedReExportSymbols(project, symbols, targetPath, namedExports);
  }
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
  addTopLevelDirectExports(symbols, sourceFile);
  addExportDeclarationSymbols(project, sourceFile, sourcePath, nextStack, symbols, localImports);
  return symbols;
}

function directExportedBinding(
  sourceFile: SourceFile,
  sourcePath: string,
  symbolName: string,
): ExportBinding | undefined {
  if (symbolName === "default" && sourceFile.getDefaultExportSymbol()) {
    return { kind: "default", sourcePath };
  }
  if (collectNamedTopLevelExports(sourceFile).has(symbolName)) {
    return { kind: "named", importedName: symbolName, sourcePath };
  }
  return undefined;
}

function localExportedBinding(
  sourcePath: string,
  symbolName: string,
  localImports: ReadonlyMap<string, DirectExportBinding>,
  namedExports: NamedExportSpecifiers,
): DirectExportBinding | undefined {
  for (const namedExport of namedExports) {
    if (exportedNameOfSpecifier(namedExport) !== symbolName) continue;
    return directLocalExportBinding(sourcePath, symbolName, namedExport.getName(), localImports);
  }
  return undefined;
}

function namedReExportedBinding(
  project: Project,
  targetPath: string,
  symbolName: string,
  nextSeen: ReadonlySet<string>,
  namedExports: NamedExportSpecifiers,
): ExportBinding | undefined {
  for (const namedExport of namedExports) {
    if (exportedNameOfSpecifier(namedExport) !== symbolName) continue;
    return resolveExportedBinding(project, targetPath, namedExport.getName(), nextSeen);
  }
  return undefined;
}

function reExportedBinding(
  project: Project,
  sourceFile: SourceFile,
  sourcePath: string,
  symbolName: string,
  localImports: ReadonlyMap<string, DirectExportBinding>,
  nextSeen: ReadonlySet<string>,
): ExportBinding | undefined {
  for (const exportDeclaration of sourceFile.getExportDeclarations()) {
    const specifier = exportDeclaration.getModuleSpecifierValue();
    const namedExports = exportDeclaration.getNamedExports();
    if (!specifier) {
      const binding = localExportedBinding(sourcePath, symbolName, localImports, namedExports);
      if (binding) return binding;
      continue;
    }

    const targetPath = resolveExportModulePath(sourceFile, specifier);
    const namespaceExport = exportDeclaration.getNamespaceExport();
    if (namespaceExport?.getName() === symbolName) {
      return { kind: "namespace", sourcePath: targetPath };
    }
    const namedBinding = namedReExportedBinding(project, targetPath, symbolName, nextSeen, namedExports);
    if (namedBinding) return namedBinding;
    if (namedExports.length === 0) {
      const binding = collectExportMap(project, targetPath, new Set()).get(symbolName);
      if (binding) return binding;
    }
  }
  return undefined;
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
  const directBinding = directExportedBinding(sourceFile, sourcePath, symbolName);
  if (directBinding) return directBinding;
  const localImports = collectLocalImportBindings(sourceFile);
  return reExportedBinding(project, sourceFile, sourcePath, symbolName, localImports, nextSeen);
}

function addBarrelTopLevelExports(symbols: ExportMap, sourceFile: SourceFile): void {
  for (const identifier of collectNamedTopLevelExports(sourceFile)) {
    addSymbol(symbols, identifier, { kind: "barrel-local", exportedName: identifier });
  }
}

function addLocalBarrelExportSymbols(
  symbols: ExportMap,
  localImports: ReadonlyMap<string, DirectExportBinding>,
  namedExports: NamedExportSpecifiers,
): void {
  for (const namedExport of namedExports) {
    const exportedName = exportedNameOfSpecifier(namedExport);
    addSymbol(
      symbols,
      exportedName,
      barrelLocalExportBinding(exportedName, namedExport.getName(), localImports),
    );
  }
}

function addNamedBarrelReExportSymbols(
  project: Project,
  symbols: ExportMap,
  targetPath: string,
  specifier: string,
  namedExports: NamedExportSpecifiers,
): void {
  for (const namedExport of namedExports) {
    const exportedName = exportedNameOfSpecifier(namedExport);
    const binding = resolveExportedBinding(project, targetPath, namedExport.getName(), new Set());
    if (!binding) fail(`Could not resolve ${exportedName} from ${specifier}.`);
    addSymbol(symbols, exportedName, binding);
  }
}

function addBarrelExportDeclarationSymbols(
  project: Project,
  sourceFile: SourceFile,
  symbols: ExportMap,
  localImports: ReadonlyMap<string, DirectExportBinding>,
): void {
  for (const exportDeclaration of sourceFile.getExportDeclarations()) {
    const specifier = exportDeclaration.getModuleSpecifierValue();
    const namedExports = exportDeclaration.getNamedExports();
    if (!specifier) {
      addLocalBarrelExportSymbols(symbols, localImports, namedExports);
      continue;
    }
    const targetPath = resolveExportModulePath(sourceFile, specifier);
    const namespaceExport = exportDeclaration.getNamespaceExport();
    if (namespaceExport) {
      addSymbol(symbols, namespaceExport.getName(), { kind: "namespace", sourcePath: targetPath });
      continue;
    }
    if (namedExports.length === 0) {
      addStarExportSymbols(project, symbols, targetPath, new Set());
      continue;
    }
    addNamedBarrelReExportSymbols(project, symbols, targetPath, specifier, namedExports);
  }
}

export function buildSymbolMap(project: Project, context: BarrelContext): ExportMap {
  const sourceFile =
    project.getSourceFile(context.barrelPath) ?? project.addSourceFileAtPath(context.barrelPath);
  const symbols: ExportMap = new Map();
  const localImports = collectLocalImportBindings(sourceFile);
  addBarrelTopLevelExports(symbols, sourceFile);
  addBarrelExportDeclarationSymbols(project, sourceFile, symbols, localImports);
  if (symbols.size === 0) fail(`${context.relativeBarrelPath} has no re-exported symbols.`);
  return symbols;
}
