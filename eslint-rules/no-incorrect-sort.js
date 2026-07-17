// @ts-check

import ts from "typescript";

import { staticPropertyName } from "./ast-helpers.js";

/** @param {import('estree').Node} node */
function isSignedNumberLiteral(node) {
  return (
    node.type === "UnaryExpression" &&
    (node.operator === "-" || node.operator === "+") &&
    node.argument.type === "Literal" &&
    typeof node.argument.value === "number"
  );
}

/** @param {import('estree').Node | null} node */
function numericLiteralKind(node) {
  if (node?.type === "Literal" && typeof node.value === "number") return "number";
  if (node?.type === "Literal" && typeof node.value === "bigint") return "bigint";
  if (node !== null && isSignedNumberLiteral(node)) return "number";
  return undefined;
}

/** @param {import('estree').Expression | import('estree').Super} node */
function numericArrayLiteralKind(node) {
  if (node.type !== "ArrayExpression" || node.elements.length === 0) return undefined;
  /** @type {Array<"number" | "bigint">} */
  const kinds = [];
  for (const element of node.elements) {
    if (element?.type === "SpreadElement") return undefined;
    const kind = numericLiteralKind(element);
    if (kind === undefined) return undefined;
    kinds.push(kind);
  }
  return kinds.every((kind) => kind === "number") ? "number" : "bigint";
}

/** @param {import('typescript').Type} type */
function numericTypeKind(type) {
  if (type.isUnion()) {
    const kinds = type.types.map(numericTypeKind);
    if (kinds.some((kind) => kind === undefined)) return undefined;
    return kinds.every((kind) => kind === "number") ? "number" : "bigint";
  }
  if ((type.flags & ts.TypeFlags.NumberLike) !== 0) return "number";
  if ((type.flags & ts.TypeFlags.BigIntLike) !== 0) return "bigint";
  return undefined;
}

/**
 * @param {import('typescript').TypeChecker} checker
 * @param {import('typescript').Type} type
 */
function isArrayType(checker, type) {
  if (type.isUnion()) return type.types.every((part) => isArrayType(checker, part));
  return checker.isArrayType(type) || checker.isTupleType(type);
}

/**
 * @param {import('estree').MemberExpression} member
 * @param {import('eslint').SourceCode['parserServices']} services
 */
function isKnownNumericArray(member, services) {
  const literalKind = numericArrayLiteralKind(member.object);
  if (literalKind !== undefined) return literalKind;
  if (services.program === null || services.program === undefined) return undefined;

  const checker = services.program.getTypeChecker();
  const type = checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(member.object));
  if (!isArrayType(checker, type)) return undefined;

  const elementType = checker.getIndexTypeOfType(type, ts.IndexKind.Number);
  return elementType === undefined ? undefined : numericTypeKind(elementType);
}

/** @param {import('estree').Expression | import('estree').SpreadElement | undefined} node */
function isMissingComparator(node) {
  if (node === undefined) return true;
  if (node.type === "Identifier") return node.name === "undefined";
  return node.type === "UnaryExpression" && node.operator === "void";
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Require an explicit comparator when sorting numeric arrays",
      principle:
        "Array.prototype.sort without a comparator coerces numeric values to strings, silently producing lexicographic instead of numeric ordering.",
      category: "behavior",
      pairedGuide: "none",
      repairKind: "manual",
    },
    messages: {
      noIncorrectSort:
        "Why: Array `sort` without a comparator coerces these numbers to strings, producing lexicographic instead of numeric order. How to fix: Add an explicit numeric comparator, such as `(left, right) => left - right` for ascending order or `(left, right) => right - left` for descending order.",
      noIncorrectBigIntSort:
        "Why: Array `sort` without a comparator coerces these bigint values to strings, while subtracting bigints does not return the number a comparator requires. How to fix: Use a relational comparator that returns numbers, such as `(left, right) => left < right ? -1 : left > right ? 1 : 0`.",
    },
    schema: [],
  },

  create(context) {
    const services = context.sourceCode.parserServices;
    return {
      CallExpression(node) {
        if (node.callee.type !== "MemberExpression") return;
        if (staticPropertyName(node.callee) !== "sort") return;
        if (!isMissingComparator(node.arguments[0])) return;
        const numericKind = isKnownNumericArray(node.callee, services);
        if (numericKind === undefined) return;
        const messageId = numericKind === "bigint" ? "noIncorrectBigIntSort" : "noIncorrectSort";
        context.report({ node, messageId });
      },
    };
  },
};
