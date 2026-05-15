// @ts-check

/**
 * Socket broadcasts must happen after persistence commits. A broadcast inside
 * a Prisma `$transaction` callback can notify clients about state that later
 * rolls back, or run before related writes in the callback complete.
 */

const BROADCAST_FUNCTIONS = new Set(["broadcast", "broadcastToUsers"]);

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

/** @param {import('estree').CallExpression} node */
function isTransactionCall(node) {
  const callee = unwrapChain(node.callee);
  if (callee.type !== "MemberExpression") return false;
  return propertyName(callee.property) === "$transaction";
}

/** @param {import('estree').Node | import('estree').SpreadElement | undefined} node */
function isFunctionNode(node) {
  return node?.type === "ArrowFunctionExpression" || node?.type === "FunctionExpression";
}

/** @param {import('estree').CallExpression} node */
function broadcastFunctionName(node) {
  const callee = unwrapChain(node.callee);
  if (callee.type !== "Identifier") return undefined;
  if (BROADCAST_FUNCTIONS.has(callee.name)) return callee.name;
  return /^broadcast[A-Z]/u.test(callee.name) ? callee.name : undefined;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow socket broadcasts inside Prisma transaction callbacks",
    },
    messages: {
      noBroadcastInTransaction:
        "Why: Broadcasting inside a Prisma `$transaction` callback can notify clients about state that later rolls back. How to fix: Persist first, then call {{name}} after the transaction resolves. See docs/guides/add-socket-broadcast.md.",
    },
    schema: [],
  },

  create(context) {
    /** @type {WeakSet<object>} */
    const transactionCallbacks = new WeakSet();
    /** @type {boolean[]} */
    const transactionFunctionStack = [];

    function enterFunction(/** @type {import('estree').BaseFunction} */ node) {
      const parentInTransaction = transactionFunctionStack.at(-1) === true;
      transactionFunctionStack.push(parentInTransaction || transactionCallbacks.has(node));
    }

    function exitFunction() {
      transactionFunctionStack.pop();
    }

    return {
      CallExpression(node) {
        if (isTransactionCall(node) && isFunctionNode(node.arguments[0])) {
          transactionCallbacks.add(node.arguments[0]);
        }

        if (transactionFunctionStack.at(-1) !== true) return;

        const name = broadcastFunctionName(node);
        if (!name) return;

        context.report({
          node: node.callee,
          messageId: "noBroadcastInTransaction",
          data: { name },
        });
      },
      ArrowFunctionExpression: enterFunction,
      "ArrowFunctionExpression:exit": exitFunction,
      FunctionExpression: enterFunction,
      "FunctionExpression:exit": exitFunction,
    };
  },
};
