import type { Identifier, Node, Project, ReferencedSymbol } from "ts-morph";
import { Node as NodeApi, SyntaxKind } from "ts-morph";

import { CodeIntelError } from "./errors.js";
import { formatLocation } from "./format.js";
import { identifierAtPosition, positionFromLineColumn } from "./identifier-location.js";
import { getProjectSourceFile } from "./source-project.js";
import type { IntelResult, ReferenceKind, SourceLocation } from "./types.js";
import type { WorkspaceResolver } from "./workspace-resolver.js";

type ReferenceResult = Extract<IntelResult, { kind: "reference" }>;

type ReferenceCollectionContext = {
  declarationLocations: Set<string>;
  fallbackName: string;
  resolver: WorkspaceResolver;
  results: Map<string, ReferenceResult>;
};

export type ReferencesQueryResult = {
  name: string;
  results: IntelResult[];
};

export function queryReferences(
  project: Project,
  resolver: WorkspaceResolver,
  location: SourceLocation,
): ReferencesQueryResult {
  const sourceFile = getProjectSourceFile(project, resolver.mapFileToSource(location.file));
  const position = positionFromLineColumn(sourceFile, location);
  const node = sourceFile.getDescendantAtPos(position);
  if (!node) throw new CodeIntelError(`No node found at ${formatLocation(location)}.`);
  const identifier = identifierAtPosition(sourceFile, node, position);
  if (!identifier) throw new CodeIntelError(`No identifier found at ${formatLocation(location)}.`);

  const context: ReferenceCollectionContext = {
    declarationLocations: collectDeclarationLocations(identifier, resolver),
    fallbackName: identifier.getText(),
    resolver,
    results: new Map<string, ReferenceResult>(),
  };

  for (const referencedSymbol of identifier.findReferences()) {
    addReferences(referencedSymbol, context);
  }

  return {
    name: identifier.getText(),
    results: [...context.results.values()].sort(compareReferenceResults),
  };
}

function addReferences(
  referencedSymbol: ReferencedSymbol,
  context: ReferenceCollectionContext,
): void {
  for (const reference of referencedSymbol.getReferences()) {
    if (reference.isDefinition()) continue;
    const referenceNode = reference.getNode();
    const referenceSourceFile = referenceNode.getSourceFile();
    const referenceFilePath = referenceSourceFile.getFilePath();
    if (referenceFilePath.endsWith(".d.ts")) continue;
    const start = referenceNode.getStart();
    const lineColumn = referenceSourceFile.getLineAndColumnAtPos(start);
    const relativeFile = context.resolver.relative(referenceFilePath);
    const key = referenceKey(relativeFile, lineColumn.line, lineColumn.column);
    if (context.declarationLocations.has(key)) continue;
    if (context.results.has(key)) continue;
    context.results.set(key, {
      kind: "reference",
      name: referenceNode.getText() || context.fallbackName,
      file: relativeFile,
      line: lineColumn.line,
      col: lineColumn.column,
      referenceKind: classifyReference(referenceNode),
    });
  }
}

function collectDeclarationLocations(
  identifier: Identifier,
  resolver: WorkspaceResolver,
): Set<string> {
  const locations = new Set<string>();
  for (const definition of identifier.getDefinitions()) {
    const declarationNode = definition.getDeclarationNode();
    if (!declarationNode) continue;
    const nameNode = declarationNameNode(declarationNode) ?? declarationNode;
    const sourceFile = nameNode.getSourceFile();
    const start = nameNode.getStart();
    const lineColumn = sourceFile.getLineAndColumnAtPos(start);
    locations.add(
      referenceKey(resolver.relative(sourceFile.getFilePath()), lineColumn.line, lineColumn.column),
    );
  }
  return locations;
}

function declarationNameNode(declaration: Node): Node | undefined {
  if (NodeApi.isImportClause(declaration)) return declaration.getDefaultImport();
  return topLevelDeclarationName(declaration) ?? memberDeclarationName(declaration);
}

function topLevelDeclarationName(declaration: Node): Node | undefined {
  if (NodeApi.isFunctionDeclaration(declaration)) return declaration.getNameNode();
  if (NodeApi.isClassDeclaration(declaration)) return declaration.getNameNode();
  if (NodeApi.isVariableDeclaration(declaration)) return declaration.getNameNode();
  if (NodeApi.isInterfaceDeclaration(declaration)) return declaration.getNameNode();
  if (NodeApi.isTypeAliasDeclaration(declaration)) return declaration.getNameNode();
  if (NodeApi.isEnumDeclaration(declaration)) return declaration.getNameNode();
  return undefined;
}

function memberDeclarationName(declaration: Node): Node | undefined {
  if (NodeApi.isImportSpecifier(declaration)) return declaration.getNameNode();
  if (NodeApi.isNamespaceImport(declaration)) return declaration.getNameNode();
  if (NodeApi.isExportSpecifier(declaration)) return declaration.getNameNode();
  if (NodeApi.isPropertySignature(declaration)) return declaration.getNameNode();
  if (NodeApi.isPropertyDeclaration(declaration)) return declaration.getNameNode();
  if (NodeApi.isMethodDeclaration(declaration)) return declaration.getNameNode();
  if (NodeApi.isMethodSignature(declaration)) return declaration.getNameNode();
  if (NodeApi.isParameterDeclaration(declaration)) return declaration.getNameNode();
  return undefined;
}

function classifyReference(node: Node): ReferenceKind {
  let current: Node | undefined = node;
  while (current) {
    if (isImportContext(current)) return "import";
    if (isTypeContext(current)) return "type";
    current = current.getParent();
  }
  return "value";
}

function isImportContext(node: Node): boolean {
  return (
    NodeApi.isImportSpecifier(node) ||
    NodeApi.isImportClause(node) ||
    NodeApi.isNamespaceImport(node) ||
    NodeApi.isImportEqualsDeclaration(node) ||
    NodeApi.isExportSpecifier(node)
  );
}

function isTypeContext(node: Node): boolean {
  return (
    NodeApi.isTypeReference(node) ||
    NodeApi.isTypeQuery(node) ||
    isTypeOnlyExpressionWithTypeArguments(node) ||
    node.getKind() === SyntaxKind.TypeAliasDeclaration
  );
}

function isTypeOnlyExpressionWithTypeArguments(node: Node): boolean {
  if (!NodeApi.isExpressionWithTypeArguments(node)) return false;
  const parent = node.getParent();
  if (!NodeApi.isHeritageClause(parent)) return true;
  if (parent.getToken() === SyntaxKind.ImplementsKeyword) return true;
  const declaration = parent.getParent();
  return !NodeApi.isClassDeclaration(declaration) && !NodeApi.isClassExpression(declaration);
}

function referenceKey(file: string, line: number, col: number): string {
  return `${file}\0${String(line)}\0${String(col)}`;
}

function compareReferenceResults(left: ReferenceResult, right: ReferenceResult): number {
  const fileComparison = left.file.localeCompare(right.file, "en");
  if (fileComparison !== 0) return fileComparison;
  if (left.line !== right.line) return left.line - right.line;
  return left.col - right.col;
}
