import { type ImportDeclaration, type ImportSpecifier, type SourceFile } from "ts-morph";

import { fail } from "./codemod-errors.js";
import { ensureNamedImport, type ImportSpecifierInfo, moduleSource } from "./codemod-imports.js";
import { referencedIdentifiers, targetHasIdentifier } from "./trpc-shared-schema-identifiers.js";
import {
  type ImportBinding,
  type SharedSchemaCodemodCandidate,
  type TargetIdentifiers,
} from "./trpc-shared-schema-types.js";

function removeImportDeclarationIfEmpty(importDeclaration: ImportDeclaration): void {
  if (importDeclaration.getNamedImports().length > 0) return;
  if (importDeclaration.getDefaultImport()) return;
  importDeclaration.remove();
}

function namedImportMatchesSpecifier(
  namedImport: ImportSpecifier,
  specifier: ImportSpecifierInfo,
): boolean {
  const imported = namedImport.getName();
  const local = namedImport.getAliasNode()?.getText() ?? imported;
  return imported === specifier.imported && local === specifier.local;
}

function namedImportIsTypeOnly(
  importDeclaration: ImportDeclaration,
  namedImport: ImportSpecifier,
): boolean {
  return importDeclaration.isTypeOnly() || namedImport.isTypeOnly();
}

function removeMatchingTypeOnlyNamedImport(
  sourceFile: SourceFile,
  source: string,
  specifier: ImportSpecifierInfo,
): void {
  for (const importDeclaration of sourceFile.getImportDeclarations()) {
    if (moduleSource(importDeclaration) !== source) continue;
    for (const namedImport of importDeclaration.getNamedImports()) {
      if (!namedImportMatchesSpecifier(namedImport, specifier)) continue;
      if (!namedImportIsTypeOnly(importDeclaration, namedImport)) continue;
      namedImport.remove();
      removeImportDeclarationIfEmpty(importDeclaration);
      return;
    }
  }
}

function typeOnlyDefaultOrNamespaceMatches(
  importDeclaration: ImportDeclaration,
  localName: string,
): boolean {
  if (!importDeclaration.isTypeOnly()) return false;
  const defaultImport = importDeclaration.getDefaultImport();
  if (defaultImport?.getText() === localName) return true;
  const namespaceImport = importDeclaration.getNamespaceImport();
  return namespaceImport?.getText() === localName;
}

function typeOnlyNamedImportMatches(
  importDeclaration: ImportDeclaration,
  namedImport: ImportSpecifier,
  localName: string,
): boolean {
  if (!namedImportIsTypeOnly(importDeclaration, namedImport)) return false;
  const local = namedImport.getAliasNode()?.getText() ?? namedImport.getName();
  return local === localName;
}

function hasTypeOnlyImport(sourceFile: SourceFile, localName: string): boolean {
  for (const importDeclaration of sourceFile.getImportDeclarations()) {
    if (typeOnlyDefaultOrNamespaceMatches(importDeclaration, localName)) return true;
    for (const namedImport of importDeclaration.getNamedImports()) {
      if (typeOnlyNamedImportMatches(importDeclaration, namedImport, localName)) return true;
    }
  }
  return false;
}

function ensureValueImportAvailable(
  codemodName: string,
  sourceFile: SourceFile,
  source: string,
  specifier: ImportSpecifierInfo,
): void {
  removeMatchingTypeOnlyNamedImport(sourceFile, source, specifier);
  if (hasTypeOnlyImport(sourceFile, specifier.local)) {
    fail(
      codemodName,
      `${specifier.local} is already imported type-only in the target shared schema file.`,
    );
  }
}

function validateCandidateSchemaName(
  candidate: SharedSchemaCodemodCandidate,
  codemodName: string,
  seen: Set<string>,
  targetIdentifiers: TargetIdentifiers,
): void {
  if (seen.has(candidate.schemaName)) {
    fail(codemodName, `${candidate.schemaName} is generated more than once in this file.`);
  }
  seen.add(candidate.schemaName);
  if (targetHasIdentifier(targetIdentifiers, candidate.schemaName)) {
    fail(codemodName, `${candidate.schemaName} already exists in the target shared schema file.`);
  }
}

function validateCandidateTypeName(
  candidate: SharedSchemaCodemodCandidate,
  codemodName: string,
  seenTypeNames: Set<string>,
  targetIdentifiers: TargetIdentifiers,
  typeNameForSchema: (schemaName: string) => string,
): void {
  const typeName = typeNameForSchema(candidate.schemaName);
  if (seenTypeNames.has(typeName)) {
    fail(codemodName, `${typeName} is generated more than once in this file.`);
  }
  seenTypeNames.add(typeName);
  if (targetHasIdentifier(targetIdentifiers, typeName)) {
    fail(codemodName, `${typeName} already exists in the target shared schema file.`);
  }
}

function bindingAllowed(
  binding: ImportBinding | undefined,
  identifier: string,
  isImportBindingAllowed: ((binding: ImportBinding, identifier: string) => boolean) | undefined,
): binding is ImportBinding {
  return Boolean(binding && (isImportBindingAllowed?.(binding, identifier) ?? true));
}

function addNeededImportsForCandidate(
  candidate: SharedSchemaCodemodCandidate,
  codemodName: string,
  allowlistedImports: Map<string, ImportBinding>,
  neededImports: Map<string, ImportBinding>,
  targetIdentifiers: TargetIdentifiers,
  isImportBindingAllowed: ((binding: ImportBinding, identifier: string) => boolean) | undefined,
): void {
  for (const identifier of referencedIdentifiers(candidate.schemaExpression)) {
    if (identifier === "z") continue;
    if (targetIdentifiers.value.has(identifier)) continue;
    const binding = allowlistedImports.get(identifier);
    if (bindingAllowed(binding, identifier, isImportBindingAllowed)) {
      neededImports.set(identifier, binding);
      continue;
    }
    fail(
      codemodName,
      `${identifier} is not available in the target shared schema file; import it from a supported shared module or move this schema manually.`,
    );
  }
}

export function validateSharedSchemaCandidates<TCandidate extends SharedSchemaCodemodCandidate>({
  allowlistedImports,
  assertConstSchemaIsOnlyCallReference,
  candidates,
  codemodName,
  isImportBindingAllowed,
  sourceFile,
  targetIdentifiers,
  typeNameForSchema,
}: {
  allowlistedImports: Map<string, ImportBinding>;
  assertConstSchemaIsOnlyCallReference: (candidate: TCandidate, sourceFile: SourceFile) => void;
  candidates: TCandidate[];
  codemodName: string;
  isImportBindingAllowed?: (binding: ImportBinding, identifier: string) => boolean;
  sourceFile: SourceFile;
  targetIdentifiers: TargetIdentifiers;
  typeNameForSchema: (schemaName: string) => string;
}): Map<string, ImportBinding> {
  const seen = new Set<string>();
  const seenTypeNames = new Set<string>();
  const neededImports = new Map<string, ImportBinding>();
  for (const candidate of candidates) {
    validateCandidateSchemaName(candidate, codemodName, seen, targetIdentifiers);
    validateCandidateTypeName(
      candidate,
      codemodName,
      seenTypeNames,
      targetIdentifiers,
      typeNameForSchema,
    );
    assertConstSchemaIsOnlyCallReference(candidate, sourceFile);
    addNeededImportsForCandidate(
      candidate,
      codemodName,
      allowlistedImports,
      neededImports,
      targetIdentifiers,
      isImportBindingAllowed,
    );
  }
  return neededImports;
}

export function ensureSharedSchemaImports(
  codemodName: string,
  targetFile: SourceFile,
  neededImports: Map<string, ImportBinding>,
  targetIdentifiers: TargetIdentifiers,
): void {
  if (!targetIdentifiers.value.has("z")) {
    ensureValueImportAvailable(codemodName, targetFile, "zod", { imported: "z", local: "z" });
    ensureNamedImport(targetFile, "zod", [{ imported: "z", local: "z" }]);
  }
  const grouped = new Map<string, ImportSpecifierInfo[]>();
  for (const binding of neededImports.values()) {
    ensureValueImportAvailable(codemodName, targetFile, binding.targetSource, binding);
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
