// @ts-check

import ts from "typescript";

import { staticPropertyName } from "./ast-helpers.js";

const CALLBACK_ARRAY_METHODS = new Set([
  "every",
  "filter",
  "flatMap",
  "forEach",
  "map",
  "reduce",
  "reduceRight",
  "some",
]);

/** @param {import('typescript').Type} type */
function isNumberType(type) {
  if (type.isUnion()) return type.types.every(isNumberType);
  return (type.flags & ts.TypeFlags.NumberLike) !== 0;
}

/**
 * @param {import('estree').Expression | import('estree').SpreadElement} argument
 * @param {import('eslint').SourceCode['parserServices']} services
 */
function isPossibleLengthArgument(argument, services) {
  if (argument.type === "SpreadElement") return false;
  if (argument.type === "Literal") {
    return (
      typeof argument.value === "number" && Number.isInteger(argument.value) && argument.value >= 0
    );
  }
  if (services.program === null || services.program === undefined) return false;
  const checker = services.program.getTypeChecker();
  return isNumberType(checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(argument)));
}

/**
 * @param {import('estree').Node} node
 * @param {import('eslint').SourceCode['parserServices']} services
 */
function isSparseArrayConstructor(node, services) {
  if (node.type !== "NewExpression" && node.type !== "CallExpression") return false;
  if (node.callee.type !== "Identifier" || node.callee.name !== "Array") return false;
  return node.arguments.length === 1 && isPossibleLengthArgument(node.arguments[0], services);
}

/** @param {import('estree').Expression | import('estree').SpreadElement | undefined} node */
function isDefaultFillBoundary(node) {
  return (
    node === undefined ||
    (node.type === "Identifier" && node.name === "undefined") ||
    (node.type === "UnaryExpression" && node.operator === "void")
  );
}

/** @param {import('estree').Expression | import('estree').SpreadElement | undefined} node */
function numericLiteralValue(node) {
  if (node?.type === "Literal" && typeof node.value === "number") return node.value;
  return undefined;
}

/**
 * @param {import('estree').CallExpression} node
 * @param {import('eslint').SourceCode['parserServices']} services
 * @param {import('eslint').SourceCode} sourceCode
 */
function fillLeavesSparseSlots(node, services, sourceCode) {
  if (node.callee.type !== "MemberExpression") return false;
  if (staticPropertyName(node.callee) !== "fill") return false;
  if (!isSparseArrayConstructor(node.callee.object, services)) return false;

  const start = node.arguments[1];
  if (!isDefaultFillBoundary(start) && numericLiteralValue(start) !== 0) return true;

  const end = node.arguments[2];
  if (isDefaultFillBoundary(end)) return false;

  const lengthArgument = node.callee.object.arguments[0];
  const length = numericLiteralValue(lengthArgument);
  const endValue = numericLiteralValue(end);
  if (length !== undefined && endValue !== undefined) return endValue < length;
  return sourceCode.getText(end) !== sourceCode.getText(lengthArgument);
}

/**
 * @param {import('estree').Node} node
 * @param {import('eslint').SourceCode['parserServices']} services
 */
function isFillCall(node, services) {
  return (
    node.type === "CallExpression" &&
    node.callee.type === "MemberExpression" &&
    staticPropertyName(node.callee) === "fill" &&
    isSparseArrayConstructor(node.callee.object, services)
  );
}

/**
 * @param {import('estree').CallExpression} node
 * @param {import('eslint').SourceCode['parserServices']} services
 * @param {import('eslint').SourceCode} sourceCode
 */
function isSparseArrayCallbackCall(node, services, sourceCode) {
  if (node.callee.type !== "MemberExpression") return false;
  const methodName = staticPropertyName(node.callee);
  if (methodName === undefined || !CALLBACK_ARRAY_METHODS.has(methodName)) return false;

  const receiver = node.callee.object;
  if (!isFillCall(receiver, services)) return isSparseArrayConstructor(receiver, services);
  return fillLeavesSparseSlots(receiver, services, sourceCode);
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow callbacks on sparse arrays created with a length-only Array call",
      principle:
        "Array callbacks skip holes created by Array(length), so code expecting one callback per index silently performs no work for those slots.",
      category: "behavior",
      pairedGuide: "none",
      repairKind: "manual",
    },
    messages: {
      uninvokedArrayCallback:
        "Why: `Array(length)` creates holes, and this array method skips holes instead of invoking its callback for each index. How to fix: Use `Array.from({ length }, (_, index) => value)` or fill every slot before calling the callback method.",
    },
    schema: [],
  },

  create(context) {
    const services = context.sourceCode.parserServices;
    return {
      CallExpression(node) {
        if (!isSparseArrayCallbackCall(node, services, context.sourceCode)) return;
        context.report({ node, messageId: "uninvokedArrayCallback" });
      },
    };
  },
};
