import { Node, Project, type ImportDeclaration, type SourceFile } from "ts-morph";

import { rewriteAllowedSharedImportSource } from "./trpc-shared-schema-paths.js";
import {
  SHARED_SCHEMA_PREFIX,
  type ImportBinding,
  type ImportSpecifierInfo,
} from "./trpc-shared-schema-types.js";

export function moduleSource(importDeclaration: ImportDeclaration): string {
  return importDeclaration.getModuleSpecifierValue();
}

function namedImportSpecifiers(importDeclaration: ImportDeclaration): ImportSpecifierInfo[] {
  return importDeclaration.getNamedImports().map((specifier) => ({
    imported: specifier.getName(),
    isTypeOnly: !importDeclaration.isTypeOnly() && specifier.isTypeOnly(),
    local: specifier.getAliasNode()?.getText() ?? specifier.getName(),
  }));
}

export function collectSharedSchemaValueImports(
  sourceFile: SourceFile,
  sourcePrefix = SHARED_SCHEMA_PREFIX,
): Set<string> {
  const imports = new Set<string>();
  for (const importDeclaration of sourceFile.getImportDeclarations()) {
    const source = moduleSource(importDeclaration);
    if (importDeclaration.isTypeOnly()) continue;
    if (!source.startsWith(sourcePrefix)) continue;
    for (const specifier of namedImportSpecifiers(importDeclaration)) imports.add(specifier.local);
  }
  return imports;
}

export function collectAllowlistedRouterImports(
  codemodName: string,
  sourceFile: SourceFile,
  targetSource: string,
): Map<string, ImportBinding> {
  const bindings = new Map<string, ImportBinding>();
  for (const importDeclaration of sourceFile.getImportDeclarations()) {
    if (importDeclaration.isTypeOnly()) continue;
    const dependencySource = rewriteAllowedSharedImportSource(
      codemodName,
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

function specifierText(specifier: ImportSpecifierInfo): string {
  const typePrefix = specifier.isTypeOnly ? "type " : "";
  if (specifier.imported === specifier.local) return `${typePrefix}${specifier.local}`;
  return `${typePrefix}${specifier.imported} as ${specifier.local}`;
}

function namedImportList(namedImports: ImportSpecifierInfo[]): string | undefined {
  if (namedImports.length === 0) return undefined;
  return namedImports.map(specifierText).join(", ");
}

function importClause(
  defaultImport: string | undefined,
  namespaceImport: string | undefined,
  namedImports: ImportSpecifierInfo[],
): string | undefined {
  const namedList = namedImportList(namedImports);
  if (namespaceImport && defaultImport) return `${defaultImport}, * as ${namespaceImport}`;
  if (namespaceImport) return `* as ${namespaceImport}`;
  if (defaultImport && namedList) return `${defaultImport}, { ${namedList} }`;
  if (defaultImport) return defaultImport;
  if (namedList) return `{ ${namedList} }`;
  return undefined;
}

function normalizedImportText(importDeclaration: ImportDeclaration): string {
  const source = moduleSource(importDeclaration);
  const namedImports = namedImportSpecifiers(importDeclaration).sort((left, right) =>
    left.local.localeCompare(right.local, "en"),
  );
  const defaultImport = importDeclaration.getDefaultImport()?.getText();
  const namespaceImport = importDeclaration.getNamespaceImport()?.getText();
  const typePrefix = importDeclaration.isTypeOnly() ? "type " : "";
  const clause = importClause(defaultImport, namespaceImport, namedImports);
  return clause ? `import ${typePrefix}${clause} from "${source}";` : importDeclaration.getText();
}

function importSortKey(importDeclaration: ImportDeclaration): string {
  const source = moduleSource(importDeclaration);
  const sortableSource = source.replace(/\.[cm]?js$/u, "");
  if (source.startsWith(".")) return `3:${sortableSource}`;
  if (source.startsWith("node:")) return `1:${sortableSource}`;
  return `2:${sortableSource}`;
}

function importSortGroup(importDeclaration: ImportDeclaration): string {
  return importSortKey(importDeclaration).slice(0, 1);
}

function sortedImportGroups(block: ImportDeclaration[]): string[][] {
  const sorted = [...block].sort((left, right) =>
    importSortKey(left).localeCompare(importSortKey(right), "en"),
  );
  return sorted.reduce<string[][]>((groups, importDeclaration, index) => {
    const previous = sorted[index - 1];
    if (!previous || importSortGroup(previous) !== importSortGroup(importDeclaration)) {
      groups.push([]);
    }
    const group = groups[groups.length - 1];
    if (!group) throw new Error("Internal error while grouping imports.");
    group.push(normalizedImportText(importDeclaration));
    return groups;
  }, []);
}

export function sortImportBlocks(source: string, filePath: string): string {
  const project = new Project({ skipAddingFilesFromTsConfig: true });
  const sourceFile = project.createSourceFile(filePath, source, { overwrite: true });
  const statements = sourceFile.getStatements();
  const replacements: { start: number; end: number; text: string }[] = [];
  let block: ImportDeclaration[] = [];

  const flushBlock = (): void => {
    if (block.length < 2) {
      block = [];
      return;
    }
    const first = block[0];
    const last = block[block.length - 1];
    if (!first || !last) {
      block = [];
      return;
    }
    replacements.push({
      start: first.getStart(),
      end: last.getEnd(),
      text: sortedImportGroups(block)
        .map((group) => group.join("\n"))
        .join("\n\n"),
    });
    block = [];
  };

  for (const statement of statements) {
    if (Node.isImportDeclaration(statement)) {
      block.push(statement);
      continue;
    }
    flushBlock();
  }
  flushBlock();

  let nextSource = source;
  for (const replacement of [...replacements].reverse()) {
    nextSource =
      nextSource.slice(0, replacement.start) + replacement.text + nextSource.slice(replacement.end);
  }
  return nextSource;
}

export function ensureNamedImport(
  sourceFile: SourceFile,
  source: string,
  specifiers: ImportSpecifierInfo[],
): void {
  const existing = sourceFile
    .getImportDeclarations()
    .find((declaration) => !declaration.isTypeOnly() && moduleSource(declaration) === source);
  if (existing) {
    const existingLocals = new Set(
      namedImportSpecifiers(existing).map((specifier) => specifier.local),
    );
    for (const specifier of specifiers) {
      if (existingLocals.has(specifier.local)) continue;
      existing.addNamedImport(specifierText(specifier));
    }
    return;
  }
  sourceFile.addImportDeclaration({
    moduleSpecifier: source,
    namedImports: specifiers.map(specifierText),
  });
}
