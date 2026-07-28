// @ts-check

/**
 * Async callbacks only work with array methods when the returned promises are
 * intentionally consumed. Most array methods ignore the callback return value
 * or treat a Promise object as truthy, which makes async work silently wrong.
 */

import { staticPropertyName, unwrapChain } from "./ast-helpers.js";
import { resolveDeclaredVariable, resolveIdentifierBinding } from "./binding-resolution.js";

const ARRAY_METHODS = new Set([
  "every",
  "filter",
  "find",
  "findIndex",
  "flatMap",
  "forEach",
  "map",
  "reduce",
  "reduceRight",
  "some",
]);
const PREDICATE_METHODS = new Set(["every", "filter", "find", "findIndex", "some"]);
const REDUCE_METHODS = new Set(["reduce", "reduceRight"]);
const PROMISE_COMBINATORS = new Set(["all", "allSettled", "any", "race"]);

/** @param {import('estree').Node} node */
function parentOf(node) {
  return /** @type {import('estree').Node & { parent?: import('estree').Node }} */ (node).parent;
}

/** @param {import('estree').CallExpression} node */
function arrayMethodName(node) {
  const callee = unwrapChain(node.callee);
  if (callee.type !== "MemberExpression") return undefined;
  const name = staticPropertyName(callee);
  return name && ARRAY_METHODS.has(name) ? name : undefined;
}

/** @param {import('estree').SpreadElement | import('estree').Expression | undefined} node */
function isAsyncCallback(node) {
  return (
    (node?.type === "ArrowFunctionExpression" || node?.type === "FunctionExpression") &&
    node.async === true
  );
}

/** @param {import('estree').CallExpression} node */
function isPromiseCombinatorCall(node) {
  const callee = unwrapChain(node.callee);
  if (callee.type !== "MemberExpression") return false;
  if (callee.object.type !== "Identifier" || callee.object.name !== "Promise") return false;
  const name = staticPropertyName(callee);
  return name !== undefined && PROMISE_COMBINATORS.has(name);
}

/** @param {import('estree').CallExpression} node */
function isImmediatePromiseCombinatorArg(node) {
  const parent = parentOf(node);
  return (
    parent?.type === "CallExpression" &&
    parent.arguments[0] === node &&
    isPromiseCombinatorCall(parent)
  );
}

/**
 * @param {import('estree').CallExpression} node
 * @param {import('eslint').SourceCode} sourceCode
 */
function constAssignedVariable(node, sourceCode) {
  const declarator = parentOf(node);
  if (declarator?.type !== "VariableDeclarator") return undefined;
  if (declarator.id.type !== "Identifier") return undefined;
  const declaration = parentOf(declarator);
  if (declaration?.type !== "VariableDeclaration" || declaration.kind !== "const") return undefined;
  return resolveDeclaredVariable(sourceCode.getScope(declarator.id), declarator.id);
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow async callbacks in array methods unless Promise arrays are consumed",
      principle:
        "Async callbacks passed to array methods like .map() and .filter() are silently ignored or return Promise objects instead of expected values.",
      category: "behavior",
      pairedGuide: "none",
      repairKind: "manual",
    },
    messages: {
      droppedPromise:
        "Why: Async callbacks passed to `{{method}}` are not awaited, so the promises they return are dropped. How to fix: Use `for...of` for sequential work, or `await Promise.all(items.map(async ...))` for parallel work.",
      asyncPredicate:
        "Why: Async predicates passed to `{{method}}` return Promise objects, not booleans. How to fix: Resolve values with `await Promise.all(...)` first, then run `{{method}}` on the resolved data.",
      asyncReduce:
        "Why: Async reducers are easy to mis-order. How to fix: Use a `for...of` loop for sequential accumulation, or resolve mapped promises before reducing.",
      asyncMap:
        "Why: Async `map` returns `Promise[]`. How to fix: Consume it with `Promise.all`, `Promise.allSettled`, `Promise.race`, or `Promise.any`, and await or return that Promise.",
    },
    schema: [],
  },

  create(context) {
    /** @type {Array<{ variable: import('eslint').Scope.Variable; node: import('estree').CallExpression }>} */
    const pendingMapCalls = [];
    /** @type {Set<import('eslint').Scope.Variable>} */
    const consumedVariables = new Set();

    /**
     * @param {import('estree').CallExpression} node
     * @param {string} method
     */
    function reportUnsafe(node, method) {
      if (method === "map") {
        context.report({ node: node.callee, messageId: "asyncMap" });
        return;
      }
      if (method === "flatMap" || method === "forEach") {
        context.report({ node: node.callee, messageId: "droppedPromise", data: { method } });
        return;
      }
      if (PREDICATE_METHODS.has(method)) {
        context.report({ node: node.callee, messageId: "asyncPredicate", data: { method } });
        return;
      }
      if (REDUCE_METHODS.has(method)) {
        context.report({ node: node.callee, messageId: "asyncReduce" });
      }
    }

    return {
      CallExpression(node) {
        if (isPromiseCombinatorCall(node)) {
          const firstArg = node.arguments[0];
          if (firstArg?.type === "Identifier") {
            const variable = resolveIdentifierBinding(context.sourceCode, firstArg);
            if (variable !== undefined) consumedVariables.add(variable);
          }
        }

        const method = arrayMethodName(node);
        if (!method) return;
        if (!isAsyncCallback(node.arguments[0])) return;

        if (method === "map") {
          if (isImmediatePromiseCombinatorArg(node)) return;
          const variable = constAssignedVariable(node, context.sourceCode);
          if (variable !== undefined) {
            pendingMapCalls.push({ variable, node });
            return;
          }
        }

        reportUnsafe(node, method);
      },

      "Program:exit"() {
        for (const pending of pendingMapCalls) {
          if (consumedVariables.has(pending.variable)) continue;
          context.report({ node: pending.node.callee, messageId: "asyncMap" });
        }
      },
    };
  },
};
