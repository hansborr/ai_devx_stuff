// Reference-evidence collector for the class-construction model (task 48a).
// Walks one parsed source file and emits one event per reference to a known
// class name, classifying each into exactly one bucket so a single use is never
// double-counted. Matching is name-based (no type checker, per task scope), so
// a name shared across files is attributed to every same-named class; the
// facade discloses that via an `ambiguous-name-shared-evidence` caveat.

import { ts } from "ts-morph";

import { type ClassReferenceBucket, type ClassReferenceEvent } from "./class-construction-types.js";

export function collectClassReferenceEvents(
  sourceFile: ts.SourceFile,
  filePath: string,
  isTestFile: boolean,
  classNames: ReadonlySet<string>,
): ClassReferenceEvent[] {
  const events: ClassReferenceEvent[] = [];
  const push = (name: string, bucket: ClassReferenceBucket): void => {
    events.push({ name, bucket, filePath, isTestFile });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) classifyIdentifier(node, classNames, push);
    else if (ts.isStringLiteralLike(node) && classNames.has(node.text))
      push(node.text, "string-keyed");
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
  return events;
}

function classifyIdentifier(
  node: ts.Identifier,
  classNames: ReadonlySet<string>,
  push: (name: string, bucket: ClassReferenceBucket) => void,
): void {
  if (!classNames.has(node.text)) return;
  if (!isReferenceIdentifier(node)) return;
  push(node.text, identifierBucket(node));
}

// Excludes the identifiers that are not value/type references: declaration
// names, member/property names, and JSX closing tags (whose opening tag is
// already counted).
function isReferenceIdentifier(node: ts.Identifier): boolean {
  return !isDeclarationNameNode(node) && !isMemberNameNode(node) && !isJsxClosingTagName(node);
}

function identifierBucket(node: ts.Identifier): ClassReferenceBucket {
  if (isNewCallee(node)) return "new";
  if (isExtendsBase(node)) return "subclass";
  if (isCustomElementRegistration(node)) return "custom-element";
  if (isJsxTagName(node)) return "jsx";
  if (isInsideDecorator(node)) return "decorator";
  if (isTypePosition(node)) return "type";
  return "value";
}

function isDeclarationNameNode(node: ts.Identifier): boolean {
  return namedDeclarationHasName(node) || bindingDeclarationHasName(node);
}

function namedDeclarationHasName(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isClassLike(parent)) return parent.name === node;
  if (ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent))
    return parent.name === node;
  if (ts.isInterfaceDeclaration(parent) || ts.isTypeAliasDeclaration(parent)) {
    return parent.name === node;
  }
  if (ts.isEnumDeclaration(parent) || ts.isModuleDeclaration(parent)) return parent.name === node;
  return false;
}

function bindingDeclarationHasName(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isBindingElement(parent)) {
    return parent.name === node;
  }
  if (ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent))
    return parent.name === node;
  return isImportExportName(node);
}

// Import/export binding names are not class references: a namespace binding
// (`import * as Foo`) is an unrelated module alias, and a specifier's own name
// and source `propertyName` (`export { Foo as Bar }`) are module wiring, not a
// value/type use of the class.
function isImportExportName(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isImportClause(parent)) return parent.name === node;
  if (ts.isNamespaceImport(parent) || ts.isNamespaceExport(parent)) return parent.name === node;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) {
    return parent.name === node || parent.propertyName === node;
  }
  return false;
}

function isMemberNameNode(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent)) return parent.name === node;
  if (ts.isQualifiedName(parent)) return parent.right === node;
  if (ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent))
    return parent.name === node;
  if (ts.isEnumMember(parent)) return parent.name === node;
  if (ts.isJsxAttribute(parent)) return parent.name === node;
  return false;
}

function isJsxClosingTagName(node: ts.Identifier): boolean {
  const outer = outermostName(node);
  return ts.isJsxClosingElement(outer.parent) && outer.parent.tagName === outer;
}

function isNewCallee(node: ts.Identifier): boolean {
  const outer = outermostName(node);
  return ts.isNewExpression(outer.parent) && outer.parent.expression === outer;
}

function isExtendsBase(node: ts.Identifier): boolean {
  const clause = heritageClauseFor(node);
  return (
    clause !== undefined &&
    clause.token === ts.SyntaxKind.ExtendsKeyword &&
    ts.isClassLike(clause.parent)
  );
}

function isCustomElementRegistration(node: ts.Identifier): boolean {
  const outer = outermostName(node);
  const call = outer.parent;
  if (!ts.isCallExpression(call) || !call.arguments.some((arg) => arg === outer)) return false;
  return isCustomElementsDefine(call.expression);
}

// Matches `customElements.define(...)` and `window.customElements.define(...)`
// by checking the `.define` tail and the immediate `customElements` object.
function isCustomElementsDefine(expression: ts.Expression): boolean {
  if (!ts.isPropertyAccessExpression(expression) || expression.name.text !== "define") return false;
  return objectTailName(expression.expression) === "customElements";
}

function objectTailName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return undefined;
}

function isJsxTagName(node: ts.Identifier): boolean {
  const outer = outermostName(node);
  const parent = outer.parent;
  return (
    (ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent)) &&
    parent.tagName === outer
  );
}

function isInsideDecorator(node: ts.Identifier): boolean {
  // `Node.parent` is typed non-nullable, so stop at the SourceFile root rather
  // than walking to `undefined`.
  let cursor: ts.Node = node.parent;
  while (!ts.isSourceFile(cursor)) {
    if (ts.isDecorator(cursor)) return true;
    cursor = cursor.parent;
  }
  return false;
}

// `typeof Foo` reads `Foo` as a value, so a TypeQuery parent is intentionally a
// value reference. Otherwise a type-reference name or an implements/interface
// heritage position is type-only.
function isTypePosition(node: ts.Identifier): boolean {
  const outer = outermostName(node);
  const parent = outer.parent;
  if (ts.isTypeQueryNode(parent)) return false;
  if (ts.isTypeReferenceNode(parent) && parent.typeName === outer) return true;
  const clause = heritageClauseFor(node);
  if (clause === undefined) return false;
  if (clause.token === ts.SyntaxKind.ImplementsKeyword) return true;
  return ts.isInterfaceDeclaration(clause.parent);
}

function heritageClauseFor(node: ts.Identifier): ts.HeritageClause | undefined {
  const outer = outermostName(node);
  const expr = outer.parent;
  if (!ts.isExpressionWithTypeArguments(expr) || expr.expression !== outer) return undefined;
  return ts.isHeritageClause(expr.parent) ? expr.parent : undefined;
}

// Climbs a property-access chain to the full entity expression so `new a.b.Foo()`
// and `<a.Foo/>` resolve their outermost name for parent inspection.
function outermostName(node: ts.Node): ts.Node {
  let cursor = node;
  while (ts.isPropertyAccessExpression(cursor.parent) && cursor.parent.name === cursor) {
    cursor = cursor.parent;
  }
  return cursor;
}
