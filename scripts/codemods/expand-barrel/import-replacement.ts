import path from "node:path";

import { type ImportDeclaration, type SourceFile } from "ts-morph";

import { type ImportSpecifierInfo, moduleSource } from "../lib/codemod-imports.js";
import { fail } from "./errors.js";
import {
  formatImportGroup,
  groupDefaultImport,
  groupImportSpecifier,
  groupNamespaceImport,
  importGroupSortKey,
} from "./import-groups.js";
import { transformMockStringReferences, warningPrefix } from "./mocks.js";
import { outputSpecifier, specifierMatchesContext } from "./paths.js";
import type {
  BarrelContext,
  ExportBinding,
  ExportMap,
  ImportGroup,
  ImportReplacement,
} from "./types.js";

type ImportReplacementState = {
  readonly groups: Map<string, ImportGroup>;
  readonly directSources: Set<string>;
  hasDirectBinding: boolean;
};

function importSpecifiers(importDeclaration: ImportDeclaration): ImportSpecifierInfo[] {
  const declarationTypeOnly = importDeclaration.isTypeOnly();
  return importDeclaration.getNamedImports().map((specifier) => ({
    imported: specifier.getName(),
    isTypeOnly: declarationTypeOnly ? false : specifier.isTypeOnly(),
    local: specifier.getAliasNode()?.getText() ?? specifier.getName(),
  }));
}

function failOnDefaultImport(
  sourceFile: SourceFile,
  importDeclaration: ImportDeclaration,
  source: string,
  root: string,
): void {
  const defaultImport = importDeclaration.getDefaultImport();
  if (!defaultImport) return;
  fail(
    `${path.relative(root, sourceFile.getFilePath())}:${String(
      importDeclaration.getStartLineNumber(),
    )} default imports from barrel ${source} are not supported.`,
  );
}

function warnNamespaceImport(
  sourceFile: SourceFile,
  importDeclaration: ImportDeclaration,
  source: string,
  root: string,
): boolean {
  const namespaceImport = importDeclaration.getNamespaceImport();
  if (!namespaceImport) return false;
  console.log(
    `${warningPrefix(
      root,
      sourceFile.getFilePath(),
      importDeclaration.getStartLineNumber(),
    )} namespace import from ${source} left unchanged.`,
  );
  return true;
}

function warnSideEffectImport(
  sourceFile: SourceFile,
  importDeclaration: ImportDeclaration,
  source: string,
  root: string,
): void {
  console.log(
    `${warningPrefix(
      root,
      sourceFile.getFilePath(),
      importDeclaration.getStartLineNumber(),
    )} side-effect import from ${source} left unchanged.`,
  );
}

function bindingForSpecifier(
  symbolMap: ExportMap,
  context: BarrelContext,
  sourceFile: SourceFile,
  importDeclaration: ImportDeclaration,
  specifier: ImportSpecifierInfo,
  root: string,
): ExportBinding {
  const binding = symbolMap.get(specifier.imported);
  if (binding) return binding;
  fail(
    `${path.relative(root, sourceFile.getFilePath())}:${String(
      importDeclaration.getStartLineNumber(),
    )} ${specifier.imported} is not exported by ${context.relativeBarrelPath}.`,
  );
}

function addDirectBindingImport(
  state: ImportReplacementState,
  binding: Exclude<ExportBinding, { readonly kind: "barrel-local" }>,
  specifier: ImportSpecifierInfo,
  importDeclaration: ImportDeclaration,
  directSource: string,
  sourceFile: SourceFile,
  root: string,
): void {
  state.hasDirectBinding = true;
  state.directSources.add(directSource);
  if (binding.kind === "named") {
    groupImportSpecifier(state.groups, directSource, importDeclaration.isTypeOnly(), {
      ...specifier,
      imported: binding.importedName,
    });
    return;
  }
  const declarationTypeOnly = importDeclaration.isTypeOnly() || Boolean(specifier.isTypeOnly);
  if (binding.kind === "default") {
    groupDefaultImport(
      state.groups,
      directSource,
      declarationTypeOnly,
      specifier.local,
      sourceFile.getFilePath(),
      importDeclaration.getStartLineNumber(),
      root,
    );
    return;
  }
  groupNamespaceImport(state.groups, directSource, declarationTypeOnly, specifier.local);
}

function addReplacementSpecifier(
  state: ImportReplacementState,
  context: BarrelContext,
  sourceFile: SourceFile,
  importDeclaration: ImportDeclaration,
  source: string,
  root: string,
  binding: ExportBinding,
  specifier: ImportSpecifierInfo,
): void {
  if (binding.kind === "barrel-local") {
    groupImportSpecifier(state.groups, source, importDeclaration.isTypeOnly(), {
      ...specifier,
      imported: binding.exportedName,
    });
    return;
  }

  const directSource = outputSpecifier(
    context,
    sourceFile.getFilePath(),
    binding.sourcePath,
    root,
    source,
  );
  addDirectBindingImport(
    state,
    binding,
    specifier,
    importDeclaration,
    directSource,
    sourceFile,
    root,
  );
}

function buildImportReplacement(state: ImportReplacementState): ImportReplacement {
  return {
    text: [...state.groups.values()]
      .sort((left, right) =>
        importGroupSortKey(left).localeCompare(importGroupSortKey(right), "en"),
      )
      .map(formatImportGroup)
      .join("\n"),
    directSources: [...state.directSources].sort((left, right) => left.localeCompare(right, "en")),
  };
}

function createReplacementState(): ImportReplacementState {
  return {
    groups: new Map<string, ImportGroup>(),
    directSources: new Set<string>(),
    hasDirectBinding: false,
  };
}

function replacementForImport(
  context: BarrelContext,
  symbolMap: ExportMap,
  sourceFile: SourceFile,
  importDeclaration: ImportDeclaration,
  root: string,
): ImportReplacement | undefined {
  const source = moduleSource(importDeclaration);
  failOnDefaultImport(sourceFile, importDeclaration, source, root);
  if (warnNamespaceImport(sourceFile, importDeclaration, source, root)) return undefined;

  const specifiers = importSpecifiers(importDeclaration);
  if (specifiers.length === 0) {
    warnSideEffectImport(sourceFile, importDeclaration, source, root);
    return undefined;
  }

  const state = createReplacementState();
  for (const specifier of specifiers) {
    const binding = bindingForSpecifier(
      symbolMap,
      context,
      sourceFile,
      importDeclaration,
      specifier,
      root,
    );
    addReplacementSpecifier(
      state,
      context,
      sourceFile,
      importDeclaration,
      source,
      root,
      binding,
      specifier,
    );
  }

  if (!state.hasDirectBinding) return undefined;
  return buildImportReplacement(state);
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

export function transformSourceFile(
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
