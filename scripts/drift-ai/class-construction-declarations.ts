// Class declaration / class expression inventory for the class-construction
// evidence model (task 48a). Walks one parsed source file and records the static
// shape of every class -- name, kind, export status, range, decorators,
// heritage, and static factory methods -- without any reference evidence.

import { ts } from "ts-morph";

import {
  type ClassDeclarationInfo,
  type ClassExportStatus,
  type ClassHeritage,
  classRecordId,
} from "./class-construction-types.js";
import { toPosix } from "./path-util.js";
import { hasModifier } from "./ts-source-util.js";

type ClassLike = ts.ClassDeclaration | ts.ClassExpression;

export function collectClassDeclarations(
  sourceFile: ts.SourceFile,
  filePath: string,
  factoryMethodNames: ReadonlySet<string>,
): ClassDeclarationInfo[] {
  const posix = toPosix(filePath);
  const infos: ClassDeclarationInfo[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      infos.push(buildClassInfo(node, sourceFile, posix, factoryMethodNames));
    }
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
  return infos;
}

function buildClassInfo(
  node: ClassLike,
  sourceFile: ts.SourceFile,
  filePath: string,
  factoryMethodNames: ReadonlySet<string>,
): ClassDeclarationInfo {
  const startLine = lineOf(sourceFile, node.getStart(sourceFile));
  const name = className(node);
  const exportStatus = exportStatusOf(node);
  const displayName = name ?? (exportStatus === "default" ? "default" : `class@L${startLine}`);
  return {
    id: classRecordId(filePath, displayName),
    filePath,
    name,
    displayName,
    kind: ts.isClassDeclaration(node) ? "declaration" : "expression",
    exportStatus,
    startLine,
    endLine: lineOf(sourceFile, node.getEnd()),
    decorators: classDecoratorNames(node),
    heritage: heritageOf(node),
    staticFactoryMethods: staticFactoryMethods(node, factoryMethodNames, name),
  };
}

function className(node: ClassLike): string | undefined {
  // For a class expression the binding name is what other files reference
  // (`const Outer = class Inner {}` is only reachable as `Outer`), so it takes
  // precedence over the expression's own name for cross-file attribution.
  if (ts.isClassExpression(node)) return classExpressionBindingName(node) ?? node.name?.text;
  return node.name?.text;
}

function classExpressionBindingName(node: ts.ClassExpression): string | undefined {
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if (ts.isBinaryExpression(parent) && ts.isIdentifier(parent.left)) return parent.left.text;
  return undefined;
}

function exportStatusOf(node: ClassLike): ClassExportStatus {
  if (ts.isClassDeclaration(node)) {
    if (hasModifier(node, ts.SyntaxKind.DefaultKeyword)) return "default";
    if (hasModifier(node, ts.SyntaxKind.ExportKeyword)) return "named";
    return "internal";
  }
  return classExpressionExportStatus(node);
}

function classExpressionExportStatus(node: ts.ClassExpression): ClassExportStatus {
  const parent = node.parent;
  if (ts.isExportAssignment(parent) && parent.isExportEquals !== true) return "default";
  if (ts.isVariableDeclaration(parent)) {
    const statement = parent.parent.parent;
    if (ts.isVariableStatement(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      return "named";
    }
  }
  return "internal";
}

function classDecoratorNames(node: ClassLike): string[] {
  const decorators = ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];
  const names: string[] = [];
  for (const decorator of decorators) {
    const name = entityName(decoratorTarget(decorator.expression));
    if (name !== undefined) names.push(name);
  }
  return names;
}

function decoratorTarget(expression: ts.Expression): ts.Expression {
  return ts.isCallExpression(expression) ? expression.expression : expression;
}

function heritageOf(node: ClassLike): ClassHeritage {
  const extendsNames: string[] = [];
  const implementsNames: string[] = [];
  for (const clause of node.heritageClauses ?? []) {
    const target = clause.token === ts.SyntaxKind.ExtendsKeyword ? extendsNames : implementsNames;
    for (const type of clause.types) {
      const name = entityName(type.expression);
      if (name !== undefined) target.push(name);
    }
  }
  return { extends: extendsNames, implements: implementsNames };
}

function staticFactoryMethods(
  node: ClassLike,
  factoryMethodNames: ReadonlySet<string>,
  ownName: string | undefined,
): string[] {
  const names: string[] = [];
  for (const member of node.members) {
    if (!ts.isMethodDeclaration(member)) continue;
    if (!hasModifier(member, ts.SyntaxKind.StaticKeyword)) continue;
    const name = memberName(member);
    if (name === undefined) continue;
    if (factoryMethodNames.has(name) || returnsClassOrThis(member, ownName)) names.push(name);
  }
  return names;
}

function returnsClassOrThis(member: ts.MethodDeclaration, ownName: string | undefined): boolean {
  const type = member.type;
  if (type === undefined) return false;
  if (type.kind === ts.SyntaxKind.ThisType) return true;
  return (
    ownName !== undefined && ts.isTypeReferenceNode(type) && entityName(type.typeName) === ownName
  );
}

function memberName(member: ts.MethodDeclaration): string | undefined {
  const name = member.name;
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name)) return name.text;
  return undefined;
}

function entityName(node: ts.Node): string | undefined {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isQualifiedName(node)) return node.right.text;
  return undefined;
}

function lineOf(sourceFile: ts.SourceFile, position: number): number {
  return sourceFile.getLineAndCharacterOfPosition(position).line + 1;
}
