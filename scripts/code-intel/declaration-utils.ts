import { type Expression, Node } from "ts-morph";

import type { ExportSpace } from "./types.js";

export function declarationSpace(declaration: Node): ExportSpace {
  if (
    Node.isInterfaceDeclaration(declaration) ||
    Node.isTypeAliasDeclaration(declaration) ||
    Node.isTypeParameterDeclaration(declaration)
  ) {
    return "type";
  }
  return "value";
}

// Peel transparent `as` / `!` / `( )` / `satisfies` wrappers off an expression
// so AST-overview passes reason about the call expression underneath.
export function unwrapExpression(expression: Expression): Expression {
  let current = expression;
  while (
    Node.isAsExpression(current) ||
    Node.isNonNullExpression(current) ||
    Node.isParenthesizedExpression(current) ||
    Node.isSatisfiesExpression(current)
  ) {
    current = current.getExpression();
  }
  return current;
}
