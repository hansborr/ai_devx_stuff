import { type SourceFile, SyntaxKind } from "ts-morph";

import { fail } from "./codemod-errors.js";
import { ensureNamedImport } from "./codemod-imports.js";
import { propertyCallMethod } from "./trpc-shared-schema-candidates.js";
import { isReferenceIdentifier } from "./trpc-shared-schema-identifiers.js";
import { type SharedSchemaCodemodCandidate } from "./trpc-shared-schema-types.js";

export function appendSharedSchemaExports(
  targetFile: SourceFile,
  candidates: SharedSchemaCodemodCandidate[],
  typeNameForSchema: (schemaName: string) => string,
): void {
  const statements = candidates.map((candidate) => {
    const typeName = typeNameForSchema(candidate.schemaName);
    return `export const ${candidate.schemaName} = ${candidate.schemaText};\n\nexport type ${typeName} = z.infer<typeof ${candidate.schemaName}>;`;
  });
  targetFile.addStatements(`\n${statements.join("\n\n")}`);
}

function replaceInlineSchemaReference(
  candidate: SharedSchemaCodemodCandidate,
  codemodName: string,
): void {
  if (candidate.kind !== "inline") return;
  const argument = candidate.schemaCall.getArguments()[0];
  if (!argument) {
    const method = propertyCallMethod(candidate.schemaCall) ?? "schema";
    fail(codemodName, `.${method}(...) call has no argument.`);
  }
  argument.replaceWithText(candidate.schemaName);
}

function removeConstSchemaStatement(candidate: SharedSchemaCodemodCandidate): void {
  if (candidate.constStatement) candidate.constStatement.remove();
}

function addMovedSchemaImport(
  routerFile: SourceFile,
  targetSource: string,
  candidates: SharedSchemaCodemodCandidate[],
): void {
  ensureNamedImport(
    routerFile,
    targetSource,
    candidates.map((candidate) => ({
      imported: candidate.schemaName,
      local: candidate.schemaName,
    })),
  );
}

export function rewriteRouterSharedSchemaReferences({
  candidates,
  codemodName,
  removeLocalNames,
  routerFile,
  targetSource,
}: {
  candidates: SharedSchemaCodemodCandidate[];
  codemodName: string;
  removeLocalNames: Iterable<string>;
  routerFile: SourceFile;
  targetSource: string;
}): void {
  for (const candidate of candidates) replaceInlineSchemaReference(candidate, codemodName);
  for (const candidate of candidates) removeConstSchemaStatement(candidate);
  addMovedSchemaImport(routerFile, targetSource, candidates);
  for (const localName of new Set(removeLocalNames)) removeUnusedNamedImport(routerFile, localName);
  removeUnusedNamedImport(routerFile, "z");
}

function hasReference(sourceFile: SourceFile, name: string): boolean {
  for (const identifier of sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)) {
    if (identifier.getText() === name && isReferenceIdentifier(identifier)) return true;
  }
  return false;
}

function removeImportDeclarationIfEmpty(
  importDeclaration: ReturnType<SourceFile["getImportDeclarations"]>[number],
): void {
  if (importDeclaration.getNamedImports().length > 0) return;
  if (importDeclaration.getDefaultImport()) return;
  importDeclaration.remove();
}

function removeUnusedNamedImport(sourceFile: SourceFile, localName: string): void {
  if (hasReference(sourceFile, localName)) return;
  for (const importDeclaration of sourceFile.getImportDeclarations()) {
    for (const specifier of importDeclaration.getNamedImports()) {
      const local = specifier.getAliasNode()?.getText() ?? specifier.getName();
      if (local !== localName) continue;
      specifier.remove();
      removeImportDeclarationIfEmpty(importDeclaration);
      return;
    }
  }
}
