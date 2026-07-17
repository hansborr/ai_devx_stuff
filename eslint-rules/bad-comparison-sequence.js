// @ts-check

import ts from "typescript";

const COMPARISON_OPERATORS = new Set(["<", "<=", ">", ">=", "==", "!=", "===", "!=="]);
const EQUALITY_OPERATORS = new Set(["==", "!=", "===", "!=="]);

/** @param {string} operator */
function isComparisonOperator(operator) {
  return COMPARISON_OPERATORS.has(operator);
}

/** @param {import('estree').Node} node */
function isBooleanLiteral(node) {
  return node.type === "Literal" && typeof node.value === "boolean";
}

/** @param {import('estree').Node} node */
function isComparisonExpression(node) {
  return node.type === "BinaryExpression" && isComparisonOperator(node.operator);
}

/** @param {import('typescript').Type} type */
function isBooleanType(type) {
  if (type.isUnion()) return type.types.every(isBooleanType);
  return (type.flags & ts.TypeFlags.BooleanLike) !== 0;
}

/**
 * @param {import('estree').BinaryExpression} node
 * @param {import('eslint').SourceCode['parserServices']} services
 */
function isExplicitBooleanCheck(node, services) {
  if (!EQUALITY_OPERATORS.has(node.operator)) return false;
  if (isBooleanLiteral(node.right)) return true;
  if (services.program === null || services.program === undefined) return false;
  const checker = services.program.getTypeChecker();
  return isBooleanType(checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(node.right)));
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow chained comparisons that reuse an intermediate boolean result",
      principle:
        "JavaScript evaluates chained comparisons from left to right, so mathematical range notation silently compares an intermediate boolean instead of the original value.",
      category: "behavior",
      pairedGuide: "none",
      repairKind: "manual",
    },
    messages: {
      badComparisonSequence:
        "Why: JavaScript evaluates this chain from left to right, so the final comparison uses an intermediate boolean instead of the original value. How to fix: Split the chain into explicit comparisons joined with `&&`, such as `minimum <= value && value <= maximum`.",
    },
    schema: [],
  },

  create(context) {
    const services = context.sourceCode.parserServices;
    return {
      BinaryExpression(node) {
        if (!isComparisonOperator(node.operator)) return;
        if (!isComparisonExpression(node.left)) return;
        if (isExplicitBooleanCheck(node, services)) return;
        context.report({ node, messageId: "badComparisonSequence" });
      },
    };
  },
};
