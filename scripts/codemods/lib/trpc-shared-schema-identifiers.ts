import {
  type ImportDeclaration,
  type ImportSpecifier,
  Node,
  type SourceFile,
  SyntaxKind,
} from "ts-morph";

import type { TargetIdentifiers } from "./trpc-shared-schema-types.js";

function addIfNamedIdentifier(target: Set<string>, node: Node): void {
  if (Node.isIdentifier(node)) target.add(node.getText());
}

function exportedVariableNames(statement: Node): string[] {
  if (!Node.isVariableStatement(statement) || !statement.isExported()) return [];
  const names: string[] = [];
  for (const declaration of statement.getDeclarations()) {
    const nameNode = declaration.getNameNode();
    if (Node.isIdentifier(nameNode)) names.push(nameNode.getText());
  }
  return names;
}

function namedExportDeclarationName(statement: Node): string | undefined {
  if (
    !Node.isFunctionDeclaration(statement) &&
    !Node.isClassDeclaration(statement) &&
    !Node.isInterfaceDeclaration(statement) &&
    !Node.isTypeAliasDeclaration(statement) &&
    !Node.isEnumDeclaration(statement)
  ) {
    return undefined;
  }
  return statement.isExported() ? statement.getName() : undefined;
}

export function collectExportedTopLevelIdentifiers(sourceFile: SourceFile): Set<string> {
  const identifiers = new Set<string>();
  for (const statement of sourceFile.getStatements()) {
    for (const name of exportedVariableNames(statement)) identifiers.add(name);
    const exportedName = namedExportDeclarationName(statement);
    if (exportedName) identifiers.add(exportedName);
  }
  return identifiers;
}

function addImportSpecifierIdentifier(
  identifiers: TargetIdentifiers,
  importIsTypeOnly: boolean,
  specifier: ImportSpecifier,
): void {
  const local = specifier.getAliasNode()?.getText() ?? specifier.getName();
  const target = importIsTypeOnly || specifier.isTypeOnly() ? identifiers.type : identifiers.value;
  target.add(local);
}

function addImportDeclarationIdentifiers(
  identifiers: TargetIdentifiers,
  importDeclaration: ImportDeclaration,
): void {
  const importSpace = importDeclaration.isTypeOnly() ? identifiers.type : identifiers.value;
  for (const specifier of importDeclaration.getNamedImports()) {
    addImportSpecifierIdentifier(identifiers, importDeclaration.isTypeOnly(), specifier);
  }
  const defaultImport = importDeclaration.getDefaultImport();
  if (defaultImport) importSpace.add(defaultImport.getText());
  const namespaceImport = importDeclaration.getNamespaceImport();
  if (namespaceImport) importSpace.add(namespaceImport.getText());
}

function addVariableStatementIdentifiers(identifiers: TargetIdentifiers, statement: Node): boolean {
  if (!Node.isVariableStatement(statement)) return false;
  for (const declaration of statement.getDeclarations()) {
    addIfNamedIdentifier(identifiers.value, declaration.getNameNode());
  }
  return true;
}

function statementValueName(statement: Node): string | undefined {
  if (!Node.isFunctionDeclaration(statement) && !Node.isClassDeclaration(statement)) {
    return undefined;
  }
  return statement.getName();
}

function statementTypeName(statement: Node): string | undefined {
  if (!Node.isInterfaceDeclaration(statement) && !Node.isTypeAliasDeclaration(statement)) {
    return undefined;
  }
  return statement.getName();
}

function addStatementIdentifiers(identifiers: TargetIdentifiers, statement: Node): void {
  if (addVariableStatementIdentifiers(identifiers, statement)) return;
  const valueName = statementValueName(statement);
  if (valueName) identifiers.value.add(valueName);
  const typeName = statementTypeName(statement);
  if (typeName) identifiers.type.add(typeName);
  if (Node.isEnumDeclaration(statement)) {
    const enumName = statement.getName();
    if (enumName) {
      identifiers.type.add(enumName);
      identifiers.value.add(enumName);
    }
  }
}

export function collectTargetIdentifiers(sourceFile: SourceFile): TargetIdentifiers {
  const identifiers: TargetIdentifiers = { type: new Set<string>(), value: new Set<string>() };
  for (const importDeclaration of sourceFile.getImportDeclarations()) {
    addImportDeclarationIdentifiers(identifiers, importDeclaration);
  }
  for (const statement of sourceFile.getStatements())
    addStatementIdentifiers(identifiers, statement);
  return identifiers;
}

export function targetHasIdentifier(targetIdentifiers: TargetIdentifiers, name: string): boolean {
  return targetIdentifiers.value.has(name) || targetIdentifiers.type.has(name);
}

function isPropertyAccessName(parent: Node, identifier: Node): boolean {
  return Node.isPropertyAccessExpression(parent) && parent.getNameNode() === identifier;
}

function isPropertyAssignmentName(parent: Node, identifier: Node): boolean {
  return Node.isPropertyAssignment(parent) && parent.getNameNode() === identifier;
}

function isMethodDeclarationName(parent: Node, identifier: Node): boolean {
  return Node.isMethodDeclaration(parent) && parent.getNameNode() === identifier;
}

function isBindingElementName(parent: Node, identifier: Node): boolean {
  return Node.isBindingElement(parent) && parent.getNameNode() === identifier;
}

function isVariableDeclarationName(parent: Node, identifier: Node): boolean {
  return Node.isVariableDeclaration(parent) && parent.getNameNode() === identifier;
}

function isImportSpecifierName(parent: Node, identifier: Node): boolean {
  return Node.isImportSpecifier(parent) && parent.getNameNode() === identifier;
}

function isImportSpecifierAlias(parent: Node, identifier: Node): boolean {
  return Node.isImportSpecifier(parent) && parent.getAliasNode() === identifier;
}

function isDefaultImport(parent: Node, identifier: Node): boolean {
  return Node.isImportClause(parent) && parent.getDefaultImport() === identifier;
}

const nonReferenceIdentifierParents = [
  isPropertyAccessName,
  isPropertyAssignmentName,
  isMethodDeclarationName,
  isBindingElementName,
  isVariableDeclarationName,
  isImportSpecifierName,
  isImportSpecifierAlias,
  isDefaultImport,
];

export function isReferenceIdentifier(identifier: Node): boolean {
  const parent = identifier.getParent();
  if (!parent) return true;
  return !nonReferenceIdentifierParents.some((isNonReference) =>
    isNonReference(parent, identifier),
  );
}

export function referencedIdentifiers(node: Node): Set<string> {
  const identifiers = new Set<string>();
  const candidates = [node, ...node.getDescendantsOfKind(SyntaxKind.Identifier)];
  for (const current of candidates) {
    if (!Node.isIdentifier(current) || !isReferenceIdentifier(current)) continue;
    identifiers.add(current.getText());
  }
  return identifiers;
}
