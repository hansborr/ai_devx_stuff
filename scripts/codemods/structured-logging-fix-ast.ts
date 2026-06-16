import type { CallExpression } from "ts-morph";
import { Node, SyntaxKind } from "ts-morph";

const CONSOLE_LEVELS = new Set(["log", "info", "warn", "error", "debug", "trace"]);

export function consoleLevel(call: CallExpression): string | undefined {
  const expression = call.getExpression();
  if (Node.isPropertyAccessExpression(expression)) {
    if (expression.getExpression().getText() !== "console") return undefined;
    const level = expression.getName();
    return CONSOLE_LEVELS.has(level) ? level : undefined;
  }
  if (Node.isElementAccessExpression(expression)) {
    if (expression.getExpression().getText() !== "console") return undefined;
    const level = staticString(expression.getArgumentExpression());
    return level && CONSOLE_LEVELS.has(level) ? level : undefined;
  }
  return undefined;
}

export function staticString(node: Node | undefined): string | undefined {
  if (!node) return undefined;
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralText();
  }
  return undefined;
}

export function isStringConcat(node: Node): boolean {
  if (
    !Node.isBinaryExpression(node) ||
    node.getOperatorToken().getKind() !== SyntaxKind.PlusToken
  ) {
    return false;
  }
  const left = node.getLeft();
  const right = node.getRight();
  return (
    staticString(left) !== undefined ||
    staticString(right) !== undefined ||
    Node.isTemplateExpression(left) ||
    Node.isTemplateExpression(right) ||
    isStringConcat(left) ||
    isStringConcat(right)
  );
}

export function templateExpressionReason(args: Node[]): string | undefined {
  if (args.some(Node.isTemplateExpression)) return "template expressions need manual fields";
  if (args.some(isStringConcat)) return "string concatenation needs manual fields";
  return undefined;
}

export function objectLiteralHasProperty(node: Node, propertyName: string): boolean {
  if (!Node.isObjectLiteralExpression(node)) return false;
  return node.getProperties().some((property) => {
    if (!Node.isPropertyAssignment(property) && !Node.isShorthandPropertyAssignment(property)) {
      return false;
    }
    return property.getName() === propertyName;
  });
}

export function quoted(value: string): string {
  return JSON.stringify(value);
}
