import { ts } from "ts-morph";

import { ENV_DEFINE_PROVIDERS } from "./env-define-provider-metadata.js";
import type {
  EnvDefineAssumption,
  EnvDefineConditionReadEvidence,
  EnvDefineMatrix,
  EnvDefineRange,
  EnvDefineReadEvidence,
  EnvDefineReadKind,
  EnvDefineReadRef,
} from "./env-define-types.js";

export function readEvidenceFromNode(
  filePath: string,
  sourceFile: ts.SourceFile,
  node: ts.Node,
  matrix: EnvDefineMatrix,
): EnvDefineReadEvidence | null {
  const read = readRefFromNode(node, sourceFile, matrix);
  if (read === null) return null;
  return {
    filePath,
    kind: read.kind,
    key: read.key,
    text: read.text,
    ...rangeFor(node, sourceFile),
    assumedValue: read.assumption?.value,
    valueSource: read.assumption?.source,
  };
}

export function readRefFromNode(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  matrix: EnvDefineMatrix,
): EnvDefineReadRef | null {
  const envRead = envReadFromNode(node, sourceFile);
  if (envRead !== null) {
    return { ...envRead, assumption: readEnvAssumption(matrix, envRead.kind, envRead.key) };
  }
  if (!ts.isIdentifier(node) || !isIdentifierRead(node)) return null;
  const assumption = readEnvAssumption(matrix, "define", node.text);
  if (assumption === undefined) return null;
  return {
    kind: "define",
    key: node.text,
    text: node.getText(sourceFile),
    assumption,
  };
}

export function collectReadsInExpression(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  matrix: EnvDefineMatrix,
): EnvDefineConditionReadEvidence[] {
  const reads: EnvDefineConditionReadEvidence[] = [];
  const seen = new Set<string>();
  const visit = (node: ts.Node): void => {
    const read = readRefFromNode(node, sourceFile, matrix);
    if (read !== null) pushConditionRead(reads, seen, read, node, sourceFile);
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return reads;
}

export function rangeFor(node: ts.Node, sourceFile: ts.SourceFile): EnvDefineRange {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
  return {
    startLine: start.line + 1,
    startColumn: start.character + 1,
    endLine: end.line + 1,
    endColumn: end.character + 1,
  };
}

function pushConditionRead(
  reads: EnvDefineConditionReadEvidence[],
  seen: Set<string>,
  read: EnvDefineReadRef,
  node: ts.Node,
  sourceFile: ts.SourceFile,
): void {
  const range = rangeFor(node, sourceFile);
  const seenKey = [
    range.startLine,
    range.startColumn,
    range.endLine,
    range.endColumn,
    read.kind,
    read.key,
  ].join(":");
  if (seen.has(seenKey)) return;
  seen.add(seenKey);
  reads.push({
    kind: read.kind,
    key: read.key,
    text: read.text,
    ...range,
    assumedValue: read.assumption?.value,
    valueSource: read.assumption?.source,
  });
}

function envReadFromNode(node: ts.Node, sourceFile: ts.SourceFile): EnvDefineReadRef | null {
  if (ts.isPropertyAccessExpression(node)) return envReadFromPropertyAccess(node, sourceFile);
  if (ts.isElementAccessExpression(node)) return envReadFromElementAccess(node, sourceFile);
  return null;
}

function envReadFromPropertyAccess(
  node: ts.PropertyAccessExpression,
  sourceFile: ts.SourceFile,
): EnvDefineReadRef | null {
  const kind = envObjectKind(node.expression);
  if (kind === null) return null;
  return {
    kind,
    key: node.name.text,
    text: node.getText(sourceFile),
    assumption: undefined,
  };
}

function envReadFromElementAccess(
  node: ts.ElementAccessExpression,
  sourceFile: ts.SourceFile,
): EnvDefineReadRef | null {
  const kind = envObjectKind(node.expression);
  const key = stringKeyFromElementAccess(node);
  if (kind === null || key === null) return null;
  return {
    kind,
    key,
    text: node.getText(sourceFile),
    assumption: undefined,
  };
}

function envObjectKind(expression: ts.Expression): EnvDefineReadKind | null {
  if (!ts.isPropertyAccessExpression(expression) || expression.name.text !== "env") return null;
  for (const provider of ENV_DEFINE_PROVIDERS) {
    if (matchesEnvObjectReadKind(expression.expression, provider.readKind)) {
      return provider.readKind;
    }
  }
  return null;
}

function matchesEnvObjectReadKind(expression: ts.Expression, kind: EnvDefineReadKind): boolean {
  switch (kind) {
    case "process.env":
      return isNamedIdentifier(expression, "process");
    case "import.meta.env":
      return isImportMeta(expression);
    case "Bun.env":
      return isNamedIdentifier(expression, "Bun");
    case "define":
      return false;
    default:
      return unhandledReadKind(kind);
  }
}

function unhandledReadKind(_kind: never): never {
  throw new Error("Unhandled env/define read kind.");
}

function isNamedIdentifier(expression: ts.Expression, text: string): boolean {
  return ts.isIdentifier(expression) && expression.text === text;
}

function isImportMeta(expression: ts.Expression): boolean {
  return (
    ts.isMetaProperty(expression) &&
    expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
    expression.name.text === "meta"
  );
}

function stringKeyFromElementAccess(expression: ts.ElementAccessExpression): string | null {
  const argument = expression.argumentExpression;
  if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
    return argument.text;
  }
  return null;
}

function isIdentifierRead(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (
    !isPropertyNamePosition(node, parent) &&
    !isDeclarationNamePosition(node, parent) &&
    !isImportExportPosition(parent) &&
    !isTypeNamePosition(node, parent)
  );
}

function isPropertyNamePosition(node: ts.Identifier, parent: ts.Node): boolean {
  if (ts.isPropertyAccessExpression(parent)) return parent.name === node;
  if (ts.isPropertyAssignment(parent)) return parent.name === node;
  return ts.isBindingElement(parent) && parent.name === node;
}

function isDeclarationNamePosition(node: ts.Identifier, parent: ts.Node): boolean {
  if (ts.isVariableDeclaration(parent)) return parent.name === node;
  if (ts.isParameter(parent)) return parent.name === node;
  if (ts.isFunctionDeclaration(parent)) return parent.name === node;
  if (ts.isClassDeclaration(parent)) return parent.name === node;
  if (ts.isInterfaceDeclaration(parent)) return parent.name === node;
  if (ts.isTypeAliasDeclaration(parent)) return parent.name === node;
  return ts.isEnumDeclaration(parent) && parent.name === node;
}

function isImportExportPosition(parent: ts.Node): boolean {
  return (
    ts.isImportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent) ||
    ts.isImportEqualsDeclaration(parent) ||
    ts.isExportSpecifier(parent)
  );
}

function isTypeNamePosition(node: ts.Identifier, parent: ts.Node): boolean {
  return ts.isTypeReferenceNode(parent) && parent.typeName === node;
}

function readEnvAssumption(
  matrix: EnvDefineMatrix,
  kind: EnvDefineReadKind,
  key: string,
): EnvDefineAssumption | undefined {
  const provider = ENV_DEFINE_PROVIDERS.find((candidate) => candidate.readKind === kind);
  if (provider === undefined) {
    throw new Error(`Missing env/define provider metadata for read kind: ${kind}`);
  }
  const providerAssumption = readAssumption(matrix[provider.configKey], key);
  if (providerAssumption !== undefined || !provider.sharedEnvFallback) return providerAssumption;
  return readAssumption(matrix.env, key);
}

function readAssumption(
  assumptions: Readonly<Record<string, EnvDefineAssumption>> | undefined,
  key: string,
): EnvDefineAssumption | undefined {
  if (assumptions === undefined || !hasOwnKey(assumptions, key)) return undefined;
  return assumptions[key];
}

function hasOwnKey(record: Readonly<Record<string, unknown>>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}
