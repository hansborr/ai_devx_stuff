import path from "node:path";

import { Node, type SourceFile } from "ts-morph";

import { moduleSource } from "../lib/trpc-shared-schema.js";
import { fail } from "./errors.js";
import { resolveExportModulePath } from "./paths.js";
import type { DirectExportBinding, ExportBinding, ExportMap } from "./types.js";

function variableExportNames(statement: Node): string[] | undefined {
  if (!Node.isVariableStatement(statement)) return undefined;
  if (!statement.isExported()) return [];
  return statement
    .getDeclarations()
    .map((declaration) => declaration.getNameNode())
    .filter(Node.isIdentifier)
    .map((nameNode) => nameNode.getText());
}

function valueDeclarationExportName(statement: Node): string | undefined {
  if (!Node.isFunctionDeclaration(statement) && !Node.isClassDeclaration(statement)) {
    return undefined;
  }
  if (!statement.isExported() || statement.isDefaultExport()) return undefined;
  return statement.getName();
}

function typeDeclarationExportName(statement: Node): string | undefined {
  if (
    !Node.isInterfaceDeclaration(statement) &&
    !Node.isTypeAliasDeclaration(statement) &&
    !Node.isEnumDeclaration(statement)
  ) {
    return undefined;
  }
  if (!statement.isExported()) return undefined;
  return statement.getName();
}

function topLevelExportNames(statement: Node): string[] {
  const variableNames = variableExportNames(statement);
  if (variableNames) return variableNames;
  const valueName = valueDeclarationExportName(statement);
  if (valueName) return [valueName];
  const typeName = typeDeclarationExportName(statement);
  return typeName ? [typeName] : [];
}

export function collectNamedTopLevelExports(sourceFile: SourceFile): Set<string> {
  const identifiers = new Set<string>();
  for (const statement of sourceFile.getStatements()) {
    for (const name of topLevelExportNames(statement)) identifiers.add(name);
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

export function addSymbol(symbols: ExportMap, symbolName: string, binding: ExportBinding): void {
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

export function exportedNameOfSpecifier(specifier: {
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

export function collectLocalImportBindings(
  sourceFile: SourceFile,
): Map<string, DirectExportBinding> {
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

export function directLocalExportBinding(
  sourcePath: string,
  exportedName: string,
  localName: string,
  localImports: ReadonlyMap<string, DirectExportBinding>,
): DirectExportBinding {
  return localImports.get(localName) ?? { kind: "named", importedName: exportedName, sourcePath };
}

export function barrelLocalExportBinding(
  exportedName: string,
  localName: string,
  localImports: ReadonlyMap<string, DirectExportBinding>,
): ExportBinding {
  return localImports.get(localName) ?? { kind: "barrel-local", exportedName };
}
