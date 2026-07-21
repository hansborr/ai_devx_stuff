// ts-morph/TypeScript fingerprint extraction for near-duplicate functions. The
// normalization intentionally drops binding names and type annotations, while
// retaining property names so renamed variables do not hide a clone but unrelated
// domains are less likely to collide.

import { ts } from "ts-morph";

import { hashFeature } from "./feature-hash.js";
import type { NearDuplicateFunction } from "./near-duplicates.js";
import { EXACT_NEAR_DUPLICATE_MIN_LINES } from "./near-duplicates-exact-config.js";
import { toPosix } from "./path-util.js";
import { scriptKindFor } from "./ts-source-util.js";

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

type ExactTokenCollector = {
  readonly root: FunctionNode;
  readonly tokens: string[];
};

const EMPTY_EXACT_TOKENS: readonly string[] = [];

export function extractNearDuplicateFunctions(
  filePath: string,
  source: string,
  options: { readonly includeExactTokens?: boolean } = {},
): NearDuplicateFunction[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(filePath),
  );
  const functions: NearDuplicateFunction[] = [];
  if (options.includeExactTokens ?? true) {
    collectFunctionsAndExactTokens(toPosix(filePath), sourceFile, functions);
    return functions;
  }
  const visit = (node: ts.Node): void => {
    if (isReportableFunction(node)) {
      functions.push(functionFingerprint(toPosix(filePath), sourceFile, node, EMPTY_EXACT_TOKENS));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return functions;
}

function collectFunctionsAndExactTokens(
  filePath: string,
  sourceFile: ts.SourceFile,
  functions: NearDuplicateFunction[],
): void {
  const activeCollectors: ExactTokenCollector[] = [];
  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.JSDoc || node.kind === ts.SyntaxKind.EndOfFileToken) return;
    let collector: ExactTokenCollector | undefined;
    if (isReportableFunction(node)) {
      const exactTokens: string[] = [];
      const fingerprint = functionFingerprint(filePath, sourceFile, node, exactTokens);
      functions.push(fingerprint);
      if (fingerprint.lineCount >= EXACT_NEAR_DUPLICATE_MIN_LINES) {
        collector = { root: node, tokens: exactTokens };
        activeCollectors.push(collector);
      }
    }
    const children = node.getChildren(sourceFile);
    if (children.length === 0) collectTerminalToken(node, sourceFile, activeCollectors);
    else for (const child of children) visit(child);
    if (collector !== undefined) activeCollectors.pop();
  };
  visit(sourceFile);
}

function collectTerminalToken(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  collectors: readonly ExactTokenCollector[],
): void {
  if (collectors.length === 0) return;
  const text = node.getText(sourceFile);
  if (text.length === 0) return;
  let encoded: string | undefined;
  for (const collector of collectors) {
    if (isFunctionNameNode(node, collector.root)) continue;
    encoded ??= `${String(node.kind)}:${String(text.length)}:${text}`;
    collector.tokens.push(encoded);
  }
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
  exactTokens: readonly string[],
): NearDuplicateFunction {
  const startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
  const startOffset = node.getStart(sourceFile);
  const endOffset = node.getEnd();
  const features: string[] = [];
  signatureForNode(node, node, features);
  return {
    filePath,
    name: functionName(node),
    enclosingContext: enclosingDisplayContext(node),
    startOffset,
    endOffset,
    startLine,
    endLine,
    lineCount: endLine - startLine + 1,
    tokenCount: features.length,
    features,
    statementFeatures: statementFeaturesFor(node),
    exactTokens,
  };
}

function enclosingDisplayContext(node: FunctionNode): string {
  const segments: string[] = [];
  let parent: ts.Node = node.parent;
  while (!ts.isSourceFile(parent)) {
    const segment = contextSegment(parent);
    if (segment !== undefined) segments.push(segment);
    parent = parent.parent;
  }
  return segments.reverse().join(".");
}

function contextSegment(node: ts.Node): string | undefined {
  const className = classContextSegment(node);
  if (className !== undefined) return className;
  const functionName = functionContextSegment(node);
  if (functionName !== undefined) return functionName;
  const methodName = methodContextSegment(node);
  if (methodName !== undefined) return methodName;
  if (ts.isVariableDeclaration(node)) return nameText(node.name);
  if (ts.isPropertyAssignment(node)) return nameText(node.name);
  return undefined;
}

function classContextSegment(node: ts.Node): string | undefined {
  if (ts.isClassDeclaration(node)) return node.name?.text ?? "<class>";
  if (ts.isClassExpression(node)) return node.name?.text ?? "<class>";
  return undefined;
}

function functionContextSegment(node: ts.Node): string | undefined {
  if (ts.isFunctionDeclaration(node)) return node.name?.text ?? "<function>";
  if (ts.isFunctionExpression(node)) return node.name?.text ?? "<function>";
  return undefined;
}

function methodContextSegment(node: ts.Node): string | undefined {
  if (ts.isMethodDeclaration(node)) return nameText(node.name);
  if (ts.isGetAccessor(node)) return nameText(node.name);
  if (ts.isSetAccessor(node)) return nameText(node.name);
  return undefined;
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
