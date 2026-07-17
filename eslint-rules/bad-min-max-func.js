// @ts-check

import { staticPropertyName } from "./ast-helpers.js";
import { resolveIdentifierBinding } from "./binding-resolution.js";

const CLAMP_ARGUMENT_COUNT = 2;

/**
 * @param {import('estree').CallExpression} node
 * @param {import('eslint').SourceCode} sourceCode
 */
function mathMethodName(node, sourceCode) {
  if (node.callee.type !== "MemberExpression") return undefined;
  if (node.callee.object.type !== "Identifier" || node.callee.object.name !== "Math") {
    return undefined;
  }
  const binding = resolveIdentifierBinding(sourceCode, node.callee.object);
  if (binding !== undefined && binding.defs.length > 0) return undefined;
  const methodName = staticPropertyName(node.callee);
  return methodName === "min" || methodName === "max" ? methodName : undefined;
}

/** @param {import('estree').Node} node */
function numericLiteralValue(node) {
  if (node.type === "Literal" && typeof node.value === "number") return node.value;
  if (
    node.type === "UnaryExpression" &&
    node.operator === "-" &&
    node.argument.type === "Literal" &&
    typeof node.argument.value === "number"
  ) {
    return -node.argument.value;
  }
  return undefined;
}

/** @param {Array<import('estree').Expression | import('estree').SpreadElement>} arguments_ */
function singleNumericLiteral(arguments_) {
  /** @type {number | undefined} */
  let numericValue;
  for (const argument of arguments_) {
    if (argument.type === "SpreadElement") return undefined;
    const value = numericLiteralValue(argument);
    if (value === undefined) continue;
    if (numericValue !== undefined) return undefined;
    numericValue = value;
  }
  return numericValue;
}

/**
 * @param {Array<import('estree').Expression | import('estree').SpreadElement>} arguments_
 * @param {import('eslint').SourceCode} sourceCode
 */
function singleNestedMathCall(arguments_, sourceCode) {
  /** @type {import('estree').CallExpression | undefined} */
  let nestedCall;
  for (const argument of arguments_) {
    if (argument.type !== "CallExpression" || mathMethodName(argument, sourceCode) === undefined) {
      continue;
    }
    if (nestedCall !== undefined) return undefined;
    nestedCall = argument;
  }
  return nestedCall;
}

/** @param {"min" | "max"} outerMethod @param {"min" | "max"} innerMethod */
function methodsFormClamp(outerMethod, innerMethod) {
  return (
    (outerMethod === "min" && innerMethod === "max") ||
    (outerMethod === "max" && innerMethod === "min")
  );
}

/**
 * @param {import('estree').CallExpression} node
 * @param {import('eslint').SourceCode} sourceCode
 */
function isImpossibleClamp(node, sourceCode) {
  const outerMethod = mathMethodName(node, sourceCode);
  if (outerMethod === undefined || node.arguments.length !== CLAMP_ARGUMENT_COUNT) return false;

  const innerCall = singleNestedMathCall(node.arguments, sourceCode);
  if (innerCall === undefined || innerCall.arguments.length !== CLAMP_ARGUMENT_COUNT) return false;

  const innerMethod = mathMethodName(innerCall, sourceCode);
  if (innerMethod === undefined || !methodsFormClamp(outerMethod, innerMethod)) return false;

  const outerBound = singleNumericLiteral(node.arguments);
  const innerBound = singleNumericLiteral(innerCall.arguments);
  if (outerBound === undefined || innerBound === undefined) return false;

  return outerMethod === "min" ? innerBound > outerBound : outerBound > innerBound;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow nested Math.min and Math.max clamps with inverted literal bounds",
      principle:
        "Inverted Math.min and Math.max bounds collapse a clamp to a constant instead of preserving values inside the intended range.",
      category: "behavior",
      pairedGuide: "none",
      repairKind: "manual",
    },
    messages: {
      badMinMaxFunc:
        "Why: These nested `Math.min` and `Math.max` bounds are inverted, so the expression always returns a constant bound. How to fix: Use the lower bound in `Math.max` and the upper bound in `Math.min`, such as `Math.min(Math.max(value, lower), upper)`.",
    },
    schema: [],
  },

  create(context) {
    return {
      CallExpression(node) {
        if (!isImpossibleClamp(node, context.sourceCode)) return;
        context.report({ node, messageId: "badMinMaxFunc" });
      },
    };
  },
};
