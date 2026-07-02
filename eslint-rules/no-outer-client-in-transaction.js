// @ts-check

/**
 * Interactive Prisma transactions must use the callback transaction client.
 * A call through the outer client inside the callback escapes the transaction
 * and may check out another pooled connection while the transaction holds one.
 */

/** @param {import('estree').Node} node */
function unwrapChain(node) {
  return node.type === "ChainExpression" ? node.expression : node;
}

/** @param {import('estree').PrivateIdentifier | import('estree').Expression} property */
function propertyName(property) {
  if (property.type === "Identifier") return property.name;
  if (property.type === "Literal" && typeof property.value === "string") return property.value;
  return undefined;
}

/** @param {import('estree').Node | import('estree').SpreadElement | undefined} node */
function isFunctionNode(node) {
  return node?.type === "ArrowFunctionExpression" || node?.type === "FunctionExpression";
}

/** @param {import('estree').CallExpression} node */
function isTransactionCall(node) {
  const callee = unwrapChain(node.callee);
  if (callee.type !== "MemberExpression") return false;
  return propertyName(callee.property) === "$transaction";
}

/**
 * @param {import('estree').Node} node
 * @param {Set<string>} transactionClientNames
 */
function startsWithOuterPrismaClient(node, transactionClientNames) {
  const current = unwrapChain(node);

  if (current.type === "Identifier") {
    return current.name === "prisma" && !transactionClientNames.has(current.name);
  }

  if (current.type !== "MemberExpression") return false;

  if (propertyName(current.property) === "prisma") return true;
  return startsWithOuterPrismaClient(current.object, transactionClientNames);
}

/** @param {import('estree').Pattern} param */
function paramName(param) {
  return param.type === "Identifier" ? param.name : undefined;
}

/** @param {import('estree').BaseFunction} node */
function transactionClientNamesFor(node) {
  const firstParamName = node.params[0] ? paramName(node.params[0]) : undefined;
  return new Set(firstParamName ? [firstParamName] : []);
}

/** @param {import('estree').BaseFunction} node */
function localPrismaParamNamesFor(node) {
  const names = new Set();
  for (const param of node.params) {
    const name = paramName(param);
    if (name === "prisma") names.add(name);
  }
  return names;
}

/**
 * @param {Set<string>} inheritedNames
 * @param {Set<string>} localNames
 */
function mergedNames(inheritedNames, localNames) {
  if (localNames.size === 0) return inheritedNames;
  return new Set([...inheritedNames, ...localNames]);
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow outer Prisma client calls inside interactive transactions",
      principle:
        "Interactive Prisma transaction callbacks must use their callback transaction client so every persistence call shares one atomic transaction.",
      category: "behavior",
      pairedGuide: "docs/CONCURRENCY.md",
      repairKind: "manual",
    },
    messages: {
      outerClientInTransaction:
        "Why: Calling the outer Prisma client inside a `$transaction` callback escapes atomicity and can deadlock the pool. How to fix: Use the `tx` callback parameter for every Prisma call inside the callback.",
    },
    schema: [],
  },

  create(context) {
    /** @type {WeakMap<object, Set<string>>} */
    const transactionCallbacks = new WeakMap();
    /** @type {Array<{ inTransaction: boolean, transactionClientNames: Set<string> }>} */
    const transactionFunctionStack = [];

    function currentTransactionClientNames() {
      return transactionFunctionStack.at(-1)?.transactionClientNames ?? new Set();
    }

    function enterFunction(/** @type {import('estree').BaseFunction} */ node) {
      const parent = transactionFunctionStack.at(-1);
      const callbackNames = transactionCallbacks.get(node);
      const inheritedNames = callbackNames ?? parent?.transactionClientNames ?? new Set();
      const localNames =
        callbackNames === undefined && parent?.inTransaction === true
          ? localPrismaParamNamesFor(node)
          : new Set();
      transactionFunctionStack.push({
        inTransaction: parent?.inTransaction === true || callbackNames !== undefined,
        transactionClientNames: mergedNames(inheritedNames, localNames),
      });
    }

    function exitFunction() {
      transactionFunctionStack.pop();
    }

    return {
      CallExpression(node) {
        if (isTransactionCall(node) && isFunctionNode(node.arguments[0])) {
          transactionCallbacks.set(node.arguments[0], transactionClientNamesFor(node.arguments[0]));
        }

        if (transactionFunctionStack.at(-1)?.inTransaction !== true) return;

        const callee = unwrapChain(node.callee);
        if (callee.type !== "MemberExpression") return;
        if (!startsWithOuterPrismaClient(callee.object, currentTransactionClientNames())) return;

        context.report({
          node: callee,
          messageId: "outerClientInTransaction",
        });
      },
      ArrowFunctionExpression: enterFunction,
      "ArrowFunctionExpression:exit": exitFunction,
      FunctionDeclaration: enterFunction,
      "FunctionDeclaration:exit": exitFunction,
      FunctionExpression: enterFunction,
      "FunctionExpression:exit": exitFunction,
    };
  },
};
