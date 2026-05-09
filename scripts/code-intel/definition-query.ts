import type { DefinitionInfo, Identifier, Project, SourceFile } from "ts-morph";
import { Node, SyntaxKind } from "ts-morph";

import { declarationSpace } from "./declaration-utils.js";
import { CodeIntelError } from "./errors.js";
import { formatLocation } from "./format.js";
import {
  getOptionalProjectSourceFile,
  getProjectSourceFile,
} from "./source-project.js";
import type {
  DefinitionNearMatch,
  DefinitionNearMatchHint,
  DefinitionResult,
  IntelResult,
  NamedDeclaration,
  SourceLocation,
} from "./types.js";
import { DEF_NAME_NEAR_MATCH_LIMIT } from "./types.js";
import type { WorkspaceResolver } from "./workspace-resolver.js";

export function queryDefinition(
  project: Project,
  resolver: WorkspaceResolver,
  location: SourceLocation,
): IntelResult[] {
  const sourceFile = getProjectSourceFile(project, resolver.mapFileToSource(location.file));
  const position = positionFromLineColumn(sourceFile, location);
  const node = sourceFile.getDescendantAtPos(position);
  if (!node) throw new CodeIntelError(`No node found at ${formatLocation(location)}.`);
  const identifier = identifierAtPosition(sourceFile, node, position);
  if (!identifier) throw new CodeIntelError(`No identifier found at ${formatLocation(location)}.`);

  return identifier
    .getDefinitions()
    .map((definition) => definitionResult(project, resolver, definition, identifier.getText()));
}

export function queryDefinitionsByName(
  resolver: WorkspaceResolver,
  sourceFiles: SourceFile[],
  name: string,
): DefinitionResult[] {
  const exportedResults = exportedDefinitionResults(
    resolver,
    sourceFiles,
    (candidateName) => candidateName === name,
  );
  if (exportedResults.length > 0) return exportedResults.sort(compareDefinitionResults);

  return topLevelDefinitionResults(
    resolver,
    sourceFiles,
    (candidateName) => candidateName === name,
  ).sort(compareDefinitionResults);
}

export function queryDefinitionNearMatches(
  resolver: WorkspaceResolver,
  sourceFiles: SourceFile[],
  prefix: string,
): DefinitionNearMatchHint {
  const matchesPrefix = (candidateName: string): boolean =>
    candidateName !== prefix && candidateName.startsWith(prefix);
  const exportedResults = exportedDefinitionResults(resolver, sourceFiles, matchesPrefix);
  const results =
    exportedResults.length > 0
      ? exportedResults.sort(compareDefinitionNearMatches)
      : topLevelDefinitionResults(resolver, sourceFiles, matchesPrefix).sort(
          compareDefinitionNearMatches,
        );

  return {
    results: results.slice(0, DEF_NAME_NEAR_MATCH_LIMIT).map(definitionNearMatch),
    total: results.length,
  };
}

function exportedDefinitionResults(
  resolver: WorkspaceResolver,
  sourceFiles: SourceFile[],
  matchesName: (name: string) => boolean,
): DefinitionResult[] {
  return uniqueDefinitionResults(
    sourceFiles.flatMap((sourceFile) =>
      [...sourceFile.getExportedDeclarations()]
        .filter(([name]) => matchesName(name))
        .flatMap(([name, declarations]) =>
          declarations.map((declaration) => definitionFromDeclaration(resolver, declaration, name)),
        ),
    ),
  );
}

function topLevelDefinitionResults(
  resolver: WorkspaceResolver,
  sourceFiles: SourceFile[],
  matchesName: (name: string) => boolean,
): DefinitionResult[] {
  return uniqueDefinitionResults(
    sourceFiles.flatMap((sourceFile) =>
      topLevelDeclarationEntries(sourceFile)
        .filter(({ name }) => matchesName(name))
        .map(({ declaration, name }) => definitionFromDeclaration(resolver, declaration, name)),
    ),
  );
}

function identifierAtPosition(
  sourceFile: SourceFile,
  node: Node,
  position: number,
): Identifier | undefined {
  const exact = identifierContainingPosition(node, position);
  return exact ?? nearestIdentifierOnLine(sourceFile, position);
}

function identifierContainingPosition(node: Node, position: number): Identifier | undefined {
  let current: Node | undefined = node;
  while (current) {
    if (Node.isIdentifier(current)) return current;
    current = current.getParent();
  }
  return node
    .getDescendantsOfKind(SyntaxKind.Identifier)
    .find((identifier) => identifier.getStart() <= position && position <= identifier.getEnd());
}

function nearestIdentifierOnLine(sourceFile: SourceFile, position: number): Identifier | undefined {
  const boundedPosition = Math.min(position, sourceFile.getFullText().length);
  const line = sourceFile.getLineAndColumnAtPos(boundedPosition).line;
  let nearest: Identifier | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const identifier of sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)) {
    const start = identifier.getStart();
    if (sourceFile.getLineAndColumnAtPos(start).line !== line) continue;
    const distance = distanceFromRange(position, start, identifier.getEnd());
    if (distance >= nearestDistance) continue;
    nearest = identifier;
    nearestDistance = distance;
  }

  return nearest;
}

function distanceFromRange(position: number, start: number, end: number): number {
  if (position < start) return start - position;
  if (position > end) return position - end;
  return 0;
}

function definitionResult(
  project: Project,
  resolver: WorkspaceResolver,
  definition: DefinitionInfo,
  fallbackName: string,
): DefinitionResult {
  const name = definition.getName() || fallbackName;
  const sourceFile = definition.getSourceFile();
  const mappedPath = resolver.mapFileToSource(sourceFile.getFilePath());
  const declaration = findDeclaration(project, mappedPath, name);
  if (declaration) return definitionFromDeclaration(resolver, declaration, name);
  const position = definition.getTextSpan().getStart();
  const lineColumn = sourceFile.getLineAndColumnAtPos(position);

  return {
    kind: "definition",
    name,
    file: resolver.relative(mappedPath),
    line: lineColumn.line,
    col: lineColumn.column,
    exportKind: definition.getKind(),
  };
}

function definitionFromDeclaration(
  resolver: WorkspaceResolver,
  declaration: Node,
  name: string,
): DefinitionResult {
  const position = declarationPosition(declaration, name);
  const sourceFile = declaration.getSourceFile();
  const lineColumn = sourceFile.getLineAndColumnAtPos(position);

  return {
    kind: "definition",
    name,
    file: resolver.relative(sourceFile.getFilePath()),
    line: lineColumn.line,
    col: lineColumn.column,
    exportKind: `${declarationSpace(declaration)} ${exportLabel(declaration, name)}`,
  };
}

function definitionNearMatch(result: DefinitionResult): DefinitionNearMatch {
  return {
    name: result.name,
    file: result.file,
    line: result.line,
    col: result.col,
    exportKind: result.exportKind,
  };
}

function findDeclaration(project: Project, file: string, name: string): Node | undefined {
  const sourceFile = getOptionalProjectSourceFile(project, file);
  if (!sourceFile) return undefined;
  const exportedDeclaration = sourceFile.getExportedDeclarations().get(name)?.[0];
  if (exportedDeclaration) return exportedDeclaration;
  return sourceFile
    .getDescendantsOfKind(SyntaxKind.Identifier)
    .find((identifier) => identifier.getText() === name);
}

function topLevelDeclarationEntries(sourceFile: SourceFile): NamedDeclaration[] {
  const results: NamedDeclaration[] = [];
  for (const statement of sourceFile.getStatements()) {
    const namedStatement = topLevelNamedStatement(statement);
    if (namedStatement) results.push(namedStatement);
    if (!Node.isVariableStatement(statement)) continue;
    for (const declaration of statement.getDeclarations()) {
      results.push({ declaration, name: declaration.getName() });
    }
  }
  return results;
}

function topLevelNamedStatement(statement: Node): NamedDeclaration | undefined {
  if (Node.isFunctionDeclaration(statement) || Node.isClassDeclaration(statement)) {
    const nameNode = statement.getNameNode();
    if (!nameNode) return undefined;
    return { declaration: statement, name: nameNode.getText() };
  }
  if (
    Node.isInterfaceDeclaration(statement) ||
    Node.isTypeAliasDeclaration(statement) ||
    Node.isEnumDeclaration(statement)
  ) {
    return { declaration: statement, name: statement.getNameNode().getText() };
  }
  return undefined;
}

function uniqueDefinitionResults(results: DefinitionResult[]): DefinitionResult[] {
  const unique = new Map<string, DefinitionResult>();
  for (const result of results) {
    const key = [
      result.file,
      String(result.line),
      String(result.col),
      result.name,
      result.exportKind,
    ].join("\0");
    unique.set(key, result);
  }
  return [...unique.values()];
}

function declarationPosition(declaration: Node, name: string): number {
  if (Node.isVariableDeclaration(declaration)) return declaration.getNameNode().getStart();

  const namedDeclarationPosition = nameNodePosition(declaration);
  if (namedDeclarationPosition !== undefined) return namedDeclarationPosition;

  const identifier = declaration
    .getDescendantsOfKind(SyntaxKind.Identifier)
    .find((candidate) => candidate.getText() === name);
  return identifier?.getStart() ?? declaration.getStart();
}

function nameNodePosition(declaration: Node): number | undefined {
  if (Node.isFunctionDeclaration(declaration)) return declaration.getNameNode()?.getStart();
  if (Node.isClassDeclaration(declaration)) return declaration.getNameNode()?.getStart();
  if (Node.isInterfaceDeclaration(declaration)) return declaration.getNameNode().getStart();
  if (Node.isTypeAliasDeclaration(declaration)) return declaration.getNameNode().getStart();
  if (Node.isEnumDeclaration(declaration)) return declaration.getNameNode().getStart();
  return undefined;
}

function exportLabel(declaration: Node, name: string): string {
  const sourceFile = declaration.getSourceFile();
  if (sourceFile.getExportedDeclarations().has(name)) return "export";
  return "local";
}

function positionFromLineColumn(sourceFile: SourceFile, location: SourceLocation): number {
  const text = sourceFile.getFullText();
  let line = 1;
  let position = 0;

  while (line < location.line && position < text.length) {
    if (text.charAt(position) === "\n") line += 1;
    position += 1;
  }

  if (line !== location.line) {
    throw new CodeIntelError(`Line ${String(location.line)} is outside ${location.file}.`);
  }

  return position + location.col - 1;
}

function compareDefinitionResults(left: DefinitionResult, right: DefinitionResult): number {
  const fileComparison = left.file.localeCompare(right.file, "en");
  if (fileComparison !== 0) return fileComparison;
  if (left.line !== right.line) return left.line - right.line;
  return left.col - right.col;
}

function compareDefinitionNearMatches(
  left: DefinitionResult,
  right: DefinitionResult,
): number {
  const nameComparison = left.name.localeCompare(right.name, "en");
  if (nameComparison !== 0) return nameComparison;
  return compareDefinitionResults(left, right);
}
