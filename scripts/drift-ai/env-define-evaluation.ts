import { ts } from "ts-morph";

import { readRefFromNode } from "./env-define-reads.js";
import type {
  EnvDefineAssumedValue,
  EnvDefineBranchPrediction,
  EnvDefineMatrix,
} from "./env-define-types.js";

type EvaluationValue =
  | { readonly state: "known"; readonly value: EnvDefineAssumedValue }
  | { readonly state: "unknown" };

type TruthinessEvaluation =
  | { readonly state: "known"; readonly truthy: boolean }
  | { readonly state: "unknown" };

export function predictedBranchFor(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  matrix: EnvDefineMatrix,
): EnvDefineBranchPrediction {
  const truthiness = evaluateTruthiness(expression, sourceFile, matrix);
  if (truthiness.state === "unknown") return "unknown";
  return truthiness.truthy ? "truthy" : "falsy";
}

function evaluateTruthiness(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  matrix: EnvDefineMatrix,
): TruthinessEvaluation {
  const unwrapped = unwrapParentheses(expression);
  if (isNotExpression(unwrapped)) {
    return negateTruthiness(evaluateTruthiness(unwrapped.operand, sourceFile, matrix));
  }
  if (ts.isBinaryExpression(unwrapped)) {
    return evaluateBinaryTruthiness(unwrapped, sourceFile, matrix);
  }

  const value = evaluateValue(unwrapped, sourceFile, matrix);
  if (value.state === "unknown") return value;
  return { state: "known", truthy: isTruthy(value.value) };
}

function evaluateBinaryTruthiness(
  expression: ts.BinaryExpression,
  sourceFile: ts.SourceFile,
  matrix: EnvDefineMatrix,
): TruthinessEvaluation {
  if (expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    return evaluateAndTruthiness(expression.left, expression.right, sourceFile, matrix);
  }
  if (expression.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
    return evaluateOrTruthiness(expression.left, expression.right, sourceFile, matrix);
  }
  const value = evaluateValue(expression, sourceFile, matrix);
  if (value.state === "unknown") return value;
  return { state: "known", truthy: isTruthy(value.value) };
}

function evaluateAndTruthiness(
  left: ts.Expression,
  right: ts.Expression,
  sourceFile: ts.SourceFile,
  matrix: EnvDefineMatrix,
): TruthinessEvaluation {
  const leftTruthiness = evaluateTruthiness(left, sourceFile, matrix);
  if (leftTruthiness.state === "known" && !leftTruthiness.truthy) {
    return { state: "known", truthy: false };
  }
  const rightTruthiness = evaluateTruthiness(right, sourceFile, matrix);
  if (rightTruthiness.state === "known" && !rightTruthiness.truthy) {
    return { state: "known", truthy: false };
  }
  if (leftTruthiness.state === "known" && rightTruthiness.state === "known") {
    return { state: "known", truthy: true };
  }
  return { state: "unknown" };
}

function evaluateOrTruthiness(
  left: ts.Expression,
  right: ts.Expression,
  sourceFile: ts.SourceFile,
  matrix: EnvDefineMatrix,
): TruthinessEvaluation {
  const leftTruthiness = evaluateTruthiness(left, sourceFile, matrix);
  if (leftTruthiness.state === "known" && leftTruthiness.truthy) {
    return { state: "known", truthy: true };
  }
  const rightTruthiness = evaluateTruthiness(right, sourceFile, matrix);
  if (rightTruthiness.state === "known" && rightTruthiness.truthy) {
    return { state: "known", truthy: true };
  }
  if (leftTruthiness.state === "known" && rightTruthiness.state === "known") {
    return { state: "known", truthy: false };
  }
  return { state: "unknown" };
}

function evaluateValue(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  matrix: EnvDefineMatrix,
): EvaluationValue {
  const unwrapped = unwrapParentheses(expression);
  const simple = evaluateSimpleValue(unwrapped, sourceFile, matrix);
  if (simple !== null) return simple;
  if (ts.isPrefixUnaryExpression(unwrapped)) {
    return evaluatePrefixValue(unwrapped, sourceFile, matrix);
  }
  if (ts.isBinaryExpression(unwrapped)) {
    return evaluateBinaryValue(unwrapped, sourceFile, matrix);
  }
  return { state: "unknown" };
}

function evaluateSimpleValue(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  matrix: EnvDefineMatrix,
): EvaluationValue | null {
  const read = readRefFromNode(expression, sourceFile, matrix);
  if (read !== null) {
    if (read.assumption === undefined) return { state: "unknown" };
    return { state: "known", value: read.assumption.value };
  }

  const literal = literalValue(expression);
  if (literal !== null) return literal;
  return null;
}

function evaluatePrefixValue(
  expression: ts.PrefixUnaryExpression,
  sourceFile: ts.SourceFile,
  matrix: EnvDefineMatrix,
): EvaluationValue {
  if (expression.operator === ts.SyntaxKind.ExclamationToken) {
    const truthiness = evaluateTruthiness(expression.operand, sourceFile, matrix);
    if (truthiness.state === "unknown") return truthiness;
    return { state: "known", value: !truthiness.truthy };
  }
  return signedNumericLiteralValue(expression);
}

function evaluateBinaryValue(
  expression: ts.BinaryExpression,
  sourceFile: ts.SourceFile,
  matrix: EnvDefineMatrix,
): EvaluationValue {
  if (isEqualityOperator(expression.operatorToken.kind)) {
    return evaluateEquality(expression, sourceFile, matrix);
  }
  return { state: "unknown" };
}

function evaluateEquality(
  expression: ts.BinaryExpression,
  sourceFile: ts.SourceFile,
  matrix: EnvDefineMatrix,
): EvaluationValue {
  const left = evaluateValue(expression.left, sourceFile, matrix);
  const right = evaluateValue(expression.right, sourceFile, matrix);
  if (left.state === "unknown") return left;
  if (right.state === "unknown") return right;

  const equal = equalityResult(expression.operatorToken.kind, left.value, right.value);
  const truthy = isInequalityOperator(expression.operatorToken.kind) ? !equal : equal;
  return { state: "known", value: truthy };
}

function equalityResult(
  operator: ts.SyntaxKind,
  left: EnvDefineAssumedValue,
  right: EnvDefineAssumedValue,
): boolean {
  if (
    operator === ts.SyntaxKind.EqualsEqualsToken ||
    operator === ts.SyntaxKind.ExclamationEqualsToken
  ) {
    return looseEqual(left, right);
  }
  return left === right;
}

function literalValue(expression: ts.Expression): EvaluationValue | null {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return { state: "known", value: expression.text };
  }
  if (ts.isNumericLiteral(expression)) return { state: "known", value: Number(expression.text) };
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return { state: "known", value: true };
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return { state: "known", value: false };
  if (expression.kind === ts.SyntaxKind.NullKeyword) return { state: "known", value: null };
  return null;
}

function signedNumericLiteralValue(expression: ts.PrefixUnaryExpression): EvaluationValue {
  if (!ts.isNumericLiteral(expression.operand)) return { state: "unknown" };
  const value = Number(expression.operand.text);
  if (expression.operator === ts.SyntaxKind.MinusToken) return { state: "known", value: -value };
  if (expression.operator === ts.SyntaxKind.PlusToken) return { state: "known", value };
  return { state: "unknown" };
}

function isNotExpression(expression: ts.Expression): expression is ts.PrefixUnaryExpression {
  return (
    ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.ExclamationToken
  );
}

function isEqualityOperator(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
    kind === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
    kind === ts.SyntaxKind.EqualsEqualsToken ||
    kind === ts.SyntaxKind.ExclamationEqualsToken
  );
}

function isInequalityOperator(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
    kind === ts.SyntaxKind.ExclamationEqualsToken
  );
}

function negateTruthiness(truthiness: TruthinessEvaluation): TruthinessEvaluation {
  if (truthiness.state === "unknown") return truthiness;
  return { state: "known", truthy: !truthiness.truthy };
}

function looseEqual(left: EnvDefineAssumedValue, right: EnvDefineAssumedValue): boolean {
  if (left === null || right === null) return left === right;
  const sameType = sameTypeEqual(left, right);
  if (sameType !== null) return sameType;
  const booleanNormalized = normalizeBooleanOperand(left, right);
  if (booleanNormalized !== null) return looseEqual(booleanNormalized[0], booleanNormalized[1]);
  return looseEqualNumberAndString(left, right);
}

function sameTypeEqual(
  left: Exclude<EnvDefineAssumedValue, null>,
  right: Exclude<EnvDefineAssumedValue, null>,
): boolean | null {
  if (typeof left !== typeof right) return null;
  return left === right;
}

function normalizeBooleanOperand(
  left: Exclude<EnvDefineAssumedValue, null>,
  right: Exclude<EnvDefineAssumedValue, null>,
): readonly [EnvDefineAssumedValue, EnvDefineAssumedValue] | null {
  if (typeof left === "boolean") return [left ? 1 : 0, right];
  if (typeof right === "boolean") return [left, right ? 1 : 0];
  return null;
}

function looseEqualNumberAndString(
  left: Exclude<EnvDefineAssumedValue, null>,
  right: Exclude<EnvDefineAssumedValue, null>,
): boolean {
  if (typeof left === "number" && typeof right === "string") {
    return numericEqual(left, Number(right));
  }
  if (typeof left === "string" && typeof right === "number") {
    return numericEqual(Number(left), right);
  }
  return false;
}

function numericEqual(left: number, right: number): boolean {
  return !Number.isNaN(left) && !Number.isNaN(right) && left === right;
}

function isTruthy(value: EnvDefineAssumedValue): boolean {
  if (value === null) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0 && !Number.isNaN(value);
  return value.length > 0;
}

function unwrapParentheses(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}
