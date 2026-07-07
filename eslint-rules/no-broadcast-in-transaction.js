// @ts-check

import { isEmitMember } from "./socket-registry-broadcasts.js";

/**
 * Socket broadcasts must happen after persistence commits. A broadcast inside
 * a Prisma `$transaction` callback can notify clients about state that later
 * rolls back, or run before related writes in the callback complete.
 *
 * This rule is intentionally lexical: deferred work scheduled inside the
 * callback with process.nextTick, setTimeout, or similar still reports. Keep
 * the scheduler call outside the transaction to make the post-commit boundary
 * explicit.
 */

const BROADCAST_FUNCTIONS = new Set(["broadcast", "broadcastToUsers"]);
const SOCKET_ROOTS = new Set(["io", "socket"]);
const SOCKET_ROOT_PROPERTIES = new Set(["io", "socket"]);
const SOCKET_FACTORY_FUNCTIONS = new Set(["getSocketIO"]);
const SOCKET_CHAIN_PROPERTIES = new Set(["broadcast", "local", "volatile"]);
const SOCKET_CHAIN_METHODS = new Set(["compress", "except", "in", "timeout", "to"]);

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

/** @param {import('estree').MemberExpression} receiver */
function isSocketMemberReceiver(receiver) {
  const property = propertyName(receiver.property);
  if (SOCKET_CHAIN_PROPERTIES.has(property ?? "")) return isSocketEmitReceiver(receiver.object);
  return SOCKET_ROOT_PROPERTIES.has(property ?? "");
}

/** @param {import('estree').CallExpression} receiver */
function isSocketFactoryCall(receiver) {
  const callee = unwrapChain(receiver.callee);
  if (callee.type === "Identifier") return SOCKET_FACTORY_FUNCTIONS.has(callee.name);
  if (callee.type !== "MemberExpression") return false;
  return SOCKET_FACTORY_FUNCTIONS.has(propertyName(callee.property) ?? "");
}

/** @param {import('estree').CallExpression} receiver */
function isSocketRoomCall(receiver) {
  const callee = unwrapChain(receiver.callee);
  return (
    callee.type === "MemberExpression" &&
    SOCKET_CHAIN_METHODS.has(propertyName(callee.property) ?? "") &&
    isSocketEmitReceiver(callee.object)
  );
}

/** @param {import('estree').Node} node */
function isSocketEmitReceiver(node) {
  const receiver = unwrapChain(node);

  if (receiver.type === "Identifier") return SOCKET_ROOTS.has(receiver.name);
  if (receiver.type === "MemberExpression") return isSocketMemberReceiver(receiver);
  if (receiver.type !== "CallExpression") return false;
  return isSocketFactoryCall(receiver) || isSocketRoomCall(receiver);
}

/** @param {import('estree').CallExpression} node */
function isSocketEmitCall(node) {
  const callee = unwrapChain(node.callee);
  return (
    callee.type === "MemberExpression" &&
    isEmitMember(callee) &&
    isSocketEmitReceiver(callee.object)
  );
}

/** @param {import('estree').CallExpression} node */
function broadcastCallName(node) {
  const name = broadcastFunctionName(node);
  if (name) return name;
  return isSocketEmitCall(node) ? "emit" : undefined;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow socket broadcasts inside Prisma transaction callbacks",
      principle:
        "Socket broadcasts must happen after persistence commits; broadcasting inside a Prisma transaction can notify clients about state that later rolls back.",
      category: "behavior",
      pairedGuide: "docs/guides/add-socket-broadcast.md",
      repairKind: "manual",
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

        const name = broadcastCallName(node);
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
