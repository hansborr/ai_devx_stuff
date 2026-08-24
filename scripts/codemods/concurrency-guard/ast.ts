import {
  type CallExpression,
  Node,
  type ObjectLiteralExpression,
  SyntaxKind,
  VariableDeclarationKind,
} from "ts-morph";

import { GATED_DELEGATES, GATED_MUTATORS } from "./constants.js";
import type { DelegateCall } from "./types.js";

function staticString(node: Node | undefined): string | undefined {
  if (!node) return undefined;
  return Node.isStringLiteral(node) ? node.getLiteralValue() : undefined;
}

function unwrapTransparent(node: Node | undefined): Node | undefined {
  let current = node;
  while (
    current !== undefined &&
    (Node.isAsExpression(current) ||
      Node.isSatisfiesExpression(current) ||
      Node.isNonNullExpression(current) ||
      Node.isParenthesizedExpression(current))
  ) {
    current = current.getExpression();
  }
  return current;
}

function staticMemberName(node: Node): { name: string; receiver: Node } | undefined {
  if (Node.isPropertyAccessExpression(node)) {
    return { name: node.getName(), receiver: node.getExpression() };
  }
  if (!Node.isElementAccessExpression(node)) return undefined;
  const name = staticString(node.getArgumentExpression());
  return name === undefined ? undefined : { name, receiver: node.getExpression() };
}

function isConstBinding(declaration: Node): boolean {
  for (const ancestor of declaration.getAncestors()) {
    if (Node.isVariableDeclarationList(ancestor)) {
      return ancestor.getDeclarationKind() === VariableDeclarationKind.Const;
    }
    if (Node.isFunctionLikeDeclaration(ancestor)) return false;
  }
  return false;
}

function destructuredDelegateName(declaration: Node): string | undefined {
  if (!Node.isBindingElement(declaration)) return undefined;
  if (!Node.isObjectBindingPattern(declaration.getParent())) return undefined;
  const nameNode = declaration.getPropertyNameNode() ?? declaration.getNameNode();
  const name = Node.isIdentifier(nameNode) ? nameNode.getText() : staticString(nameNode);
  return name !== undefined && GATED_DELEGATES.has(name) ? name : undefined;
}

function initializedDelegateName(declaration: Node): string | undefined {
  if (!Node.isVariableDeclaration(declaration)) return undefined;
  const initializer = unwrapTransparent(declaration.getInitializer());
  if (initializer === undefined) return undefined;
  const name = staticMemberName(initializer)?.name;
  return name !== undefined && GATED_DELEGATES.has(name) ? name : undefined;
}

function boundDelegateName(identifier: Node): string | undefined {
  const declaration = identifier.getSymbol()?.getValueDeclaration();
  if (declaration === undefined || !isConstBinding(declaration)) return undefined;
  return destructuredDelegateName(declaration) ?? initializedDelegateName(declaration);
}

function delegateName(node: Node): string | undefined {
  const receiver = unwrapTransparent(node);
  if (receiver === undefined) return undefined;
  if (Node.isIdentifier(receiver)) {
    const name = receiver.getText();
    return GATED_DELEGATES.has(name) ? name : boundDelegateName(receiver);
  }
  const name = staticMemberName(receiver)?.name;
  return name !== undefined && GATED_DELEGATES.has(name) ? name : undefined;
}

export function delegateCall(call: CallExpression): DelegateCall | undefined {
  const expression = staticMemberName(call.getExpression());
  if (expression === undefined || !GATED_MUTATORS.has(expression.name)) return undefined;
  const delegate = delegateName(expression.receiver);
  if (!delegate) return undefined;
  return { call, delegate, method: expression.name };
}

function objectPropertyValue(
  objectLiteral: ObjectLiteralExpression,
  propertyName: string,
): Node | undefined {
  for (const property of objectLiteral.getProperties()) {
    if (Node.isPropertyAssignment(property) && property.getName() === propertyName) {
      return property.getInitializer();
    }
  }
  return undefined;
}

function objectHasProperty(objectLiteral: ObjectLiteralExpression, propertyName: string): boolean {
  for (const property of objectLiteral.getProperties()) {
    if (
      (Node.isPropertyAssignment(property) || Node.isShorthandPropertyAssignment(property)) &&
      property.getName() === propertyName
    ) {
      return true;
    }
  }
  return false;
}

function objectPropertyObject(
  objectLiteral: ObjectLiteralExpression,
  propertyName: string,
): ObjectLiteralExpression | undefined {
  const value = objectPropertyValue(objectLiteral, propertyName);
  return value && Node.isObjectLiteralExpression(value) ? value : undefined;
}

function callOptions(call: CallExpression): ObjectLiteralExpression | undefined {
  const first = call.getArguments()[0];
  return first && Node.isObjectLiteralExpression(first) ? first : undefined;
}

export function hasWhereFields(call: CallExpression, fields: string[]): boolean {
  const options = callOptions(call);
  if (!options) return false;
  const where = objectPropertyObject(options, "where");
  if (!where) return false;
  return fields.every((field) => objectHasProperty(where, field));
}

export function hasVersionIncrement(call: CallExpression): boolean {
  const options = callOptions(call);
  if (!options) return false;
  const data = objectPropertyObject(options, "data");
  if (!data) return false;
  const version = objectPropertyObject(data, "version");
  return version ? objectHasProperty(version, "increment") : false;
}

export function hasDataFields(call: CallExpression, fields: string[]): boolean {
  const options = callOptions(call);
  if (!options) return false;
  const data = objectPropertyObject(options, "data");
  if (!data) return false;
  return fields.every((field) => objectHasProperty(data, field));
}

export function hasDataProperty(call: CallExpression): boolean {
  const options = callOptions(call);
  return options ? objectHasProperty(options, "data") : false;
}

export function hasUpsertCreateFields(call: CallExpression, fields: string[]): boolean {
  const options = callOptions(call);
  if (!options) return false;
  const create = objectPropertyObject(options, "create");
  if (!create) return false;
  return fields.every((field) => objectHasProperty(create, field));
}

export function hasUpsertUpdateFields(call: CallExpression, fields: string[]): boolean {
  const options = callOptions(call);
  if (!options) return false;
  const update = objectPropertyObject(options, "update");
  if (!update) return false;
  return fields.every((field) => objectHasProperty(update, field));
}

export function enclosingFunctionName(node: Node): string | undefined {
  for (const ancestor of node.getAncestors()) {
    if (Node.isFunctionDeclaration(ancestor)) return ancestor.getName();
    if (Node.isVariableDeclaration(ancestor)) {
      const initializer = ancestor.getInitializer();
      if (
        initializer &&
        (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))
      ) {
        return ancestor.getName();
      }
    }
    if (Node.isMethodDeclaration(ancestor)) return ancestor.getName();
  }
  return undefined;
}

function unwrapAwait(node: Node): Node {
  if (Node.isAwaitExpression(node)) return node.getExpression();
  return node;
}

function assignedVariableName(call: CallExpression): string | undefined {
  const parent = call.getParent();
  const initializer = parent && Node.isAwaitExpression(parent) ? parent : call;
  const container = initializer.getParent();
  if (!container || !Node.isVariableDeclaration(container)) return undefined;
  const variableInitializer = container.getInitializer();
  if (!variableInitializer) return undefined;
  if (unwrapAwait(variableInitializer) !== call) return undefined;
  return container.getName();
}

function nearestStatement(node: Node): Node | undefined {
  for (const ancestor of node.getAncestors()) {
    if (Node.isStatement(ancestor)) return ancestor;
  }
  return undefined;
}

function siblingStatementsAfter(node: Node): Node[] {
  const statement = nearestStatement(node);
  if (!statement) return [];
  const parent = statement.getParent();
  const statements =
    parent && (Node.isBlock(parent) || Node.isSourceFile(parent)) ? parent.getStatements() : [];
  const index = statements.findIndex((candidate) => candidate === statement);
  return index === -1 ? [] : statements.slice(index + 1);
}

function isZeroLiteral(node: Node): boolean {
  return Node.isNumericLiteral(node) && node.getLiteralText() === "0";
}

function isCountAccess(node: Node, resultName: string): boolean {
  if (!Node.isPropertyAccessExpression(node) || node.getName() !== "count") return false;
  return node.getExpression().getText() === resultName;
}

function isZeroCountCondition(node: Node, resultName: string): boolean {
  if (!Node.isBinaryExpression(node)) return false;
  const operatorKind = node.getOperatorToken().getKind();
  if (
    operatorKind !== SyntaxKind.EqualsEqualsEqualsToken &&
    operatorKind !== SyntaxKind.EqualsEqualsToken
  ) {
    return false;
  }
  const left = node.getLeft();
  const right = node.getRight();
  return (
    (isCountAccess(left, resultName) && isZeroLiteral(right)) ||
    (isZeroLiteral(left) && isCountAccess(right, resultName))
  );
}

function objectStringPropertyEquals(
  objectLiteral: ObjectLiteralExpression,
  propertyName: string,
  expectedValue: string,
): boolean {
  const value = objectPropertyValue(objectLiteral, propertyName);
  return staticString(value) === expectedValue;
}

function hasTrpcErrorThrow(node: Node, codes: string[]): boolean {
  for (const newExpression of node.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    if (newExpression.getExpression().getText() !== "TRPCError") continue;
    const firstArg = newExpression.getArguments()[0];
    if (!firstArg || !Node.isObjectLiteralExpression(firstArg)) continue;
    for (const code of codes) {
      if (objectStringPropertyEquals(firstArg, "code", code)) return true;
    }
  }
  return false;
}

export function hasZeroCountTrpcErrorHandling(call: CallExpression, codes: string[]): boolean {
  const resultName = assignedVariableName(call);
  if (!resultName) return false;
  for (const statement of siblingStatementsAfter(call)) {
    if (!Node.isIfStatement(statement)) continue;
    if (!isZeroCountCondition(statement.getExpression(), resultName)) continue;
    if (hasTrpcErrorThrow(statement.getThenStatement(), codes)) return true;
  }
  return false;
}

export function hasZeroCountConflictHandling(call: CallExpression): boolean {
  return hasZeroCountTrpcErrorHandling(call, ["CONFLICT"]);
}

export function hasZeroCountAnyHandling(call: CallExpression): boolean {
  return hasZeroCountTrpcErrorHandling(call, ["BAD_REQUEST", "CONFLICT", "FORBIDDEN", "NOT_FOUND"]);
}

export function hasReturnedCount(call: CallExpression): boolean {
  const resultName = assignedVariableName(call);
  if (!resultName) return false;
  for (const statement of siblingStatementsAfter(call)) {
    if (!Node.isReturnStatement(statement)) continue;
    const expression = statement.getExpression();
    if (expression && isCountAccess(expression, resultName)) return true;
  }
  return false;
}
