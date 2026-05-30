// ts-morph/TypeScript fingerprint extraction for near-duplicate functions. The
// normalization intentionally drops binding names and type annotations, while
// retaining property names so renamed variables do not hide a clone but unrelated
// domains are less likely to collide.

import { ts } from "ts-morph";

import type { NearDuplicateFunction } from "./near-duplicates.js";
import { toPosix } from "./path-util.js";

type BlockFunctionNode =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.MethodDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration;

type FunctionNode = BlockFunctionNode | ts.ArrowFunction;

type PropertyNameOwner =
  | ts.PropertyAccessExpression
  | ts.PropertyAssignment
  | ts.PropertyDeclaration
  | ts.MethodDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration;

export function extractNearDuplicateFunctions(
  filePath: string,
  source: string,
): NearDuplicateFunction[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(filePath),
  );
  const functions: NearDuplicateFunction[] = [];
  const visit = (node: ts.Node): void => {
    if (isReportableFunction(node)) {
      functions.push(functionFingerprint(toPosix(filePath), sourceFile, node));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return functions;
}

function scriptKindFor(filePath: string): ts.ScriptKind {
  if (filePath.endsWith(".tsx") || filePath.endsWith(".jsx")) return ts.ScriptKind.TSX;
  return ts.ScriptKind.TS;
}

function isFunctionLikeWithBody(node: ts.Node): node is FunctionNode {
  if (ts.isArrowFunction(node)) return true;
  if (!isBlockFunction(node)) return false;
  return node.body !== undefined;
}

function isReportableFunction(node: ts.Node): node is FunctionNode {
  if (!isFunctionLikeWithBody(node)) return false;
  return hasReportableName(node);
}

function isBlockFunction(node: ts.Node): node is BlockFunctionNode {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessor(node) ||
    ts.isSetAccessor(node)
  );
}

function functionFingerprint(
  filePath: string,
  sourceFile: ts.SourceFile,
  node: FunctionNode,
): NearDuplicateFunction {
  const startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
  const features: string[] = [];
  signatureForNode(node, node, features);
  return {
    filePath,
    name: functionName(node),
    startLine,
    endLine,
    lineCount: endLine - startLine + 1,
    tokenCount: features.length,
    features,
    statementFeatures: statementFeaturesFor(node),
  };
}

function functionName(node: FunctionNode): string {
  const named = nameFromOwnNode(node);
  if (named !== undefined) return named;
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent)) return nameText(parent.name);
  if (ts.isPropertyAssignment(parent)) return nameText(parent.name);
  return "<anonymous>";
}

function hasReportableName(node: FunctionNode): boolean {
  if (nameFromOwnNode(node) !== undefined) return true;
  const parent = node.parent;
  return ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent);
}

function nameFromOwnNode(node: FunctionNode): string | undefined {
  if (ts.isArrowFunction(node)) return undefined;
  if (node.name === undefined) return undefined;
  return nameText(node.name);
}

function nameText(name: ts.BindingName | ts.PropertyName): string {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return "[computed]";
}

function statementFeaturesFor(node: FunctionNode): string[] {
  const body = node.body;
  if (body === undefined) return [];
  if (!ts.isBlock(body)) return [hashFeature(signatureForNode(body, node, []))];
  return body.statements.map((statement) => hashFeature(signatureForNode(statement, node, [])));
}

function signatureForNode(node: ts.Node, root: FunctionNode, features: string[]): string {
  if (node !== root && isFunctionLikeWithBody(node)) {
    features.push("NestedFunction");
    return "NestedFunction";
  }
  if (shouldSkipNode(node, root)) return "";
  return signatureFromChildren(node, root, features);
}

function signatureFromChildren(node: ts.Node, root: FunctionNode, features: string[]): string {
  const childSignatures: string[] = [];
  ts.forEachChild(node, (child) => {
    const signature = signatureForNode(child, root, features);
    if (signature.length > 0) childSignatures.push(signature);
  });
  const kind = featureKind(node);
  const signature = childSignatures.length === 0 ? kind : `${kind}(${childSignatures.join(",")})`;
  features.push(hashFeature(signature));
  return signature;
}

function shouldSkipNode(node: ts.Node, root: FunctionNode): boolean {
  if (isFunctionNameNode(node, root)) return true;
  if (ts.isTypeNode(node)) return true;
  return node.kind === ts.SyntaxKind.JSDoc;
}

function isFunctionNameNode(node: ts.Node, root: FunctionNode): boolean {
  if (ts.isArrowFunction(root)) return false;
  return root.name === node;
}

function featureKind(node: ts.Node): string {
  if (ts.isIdentifier(node)) return identifierFeature(node);
  if (ts.isPrivateIdentifier(node)) return "PrivateIdentifier";
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return "StringLiteral";
  if (ts.isNumericLiteral(node)) return "NumericLiteral";
  if (node.kind === ts.SyntaxKind.BigIntLiteral) return "BigIntLiteral";
  if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) return "RegularExpressionLiteral";
  return ts.SyntaxKind[node.kind];
}

function identifierFeature(node: ts.Identifier): string {
  if (isPropertyNameIdentifier(node)) return `Property:${node.text}`;
  return "Identifier";
}

function isPropertyNameIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (isPropertyNameOwner(parent)) return parent.name === node;
  if (ts.isBindingElement(parent)) return parent.propertyName === node;
  return false;
}

function isPropertyNameOwner(node: ts.Node): node is PropertyNameOwner {
  return (
    ts.isPropertyAccessExpression(node) ||
    ts.isPropertyAssignment(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessor(node) ||
    ts.isSetAccessor(node)
  );
}

function hashFeature(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}
