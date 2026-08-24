// @ts-check

/**
 * Shared discovery and lexical lifecycle tracking for inline Prisma
 * interactive-transaction callbacks. Rule-specific recognition and payload
 * policy stay with each consumer.
 */

import { isFunctionNode, staticPropertyName, unwrapChain } from "./ast-helpers.js";
import { resolveDeclaredVariable } from "./binding-resolution.js";

/**
 * @typedef {{
 *   name: string | undefined,
 *   variable: import('eslint').Scope.Variable | undefined,
 * }} TransactionCallbackIdentity
 */

/**
 * @template State
 * @typedef {{
 *   callback: TransactionCallbackIdentity | undefined,
 *   inTransaction: boolean,
 *   state: State | undefined,
 * }} TransactionCallbackFrame
 */

/** @param {import('estree').CallExpression} node */
export function isTransactionCall(node) {
  const callee = unwrapChain(node.callee);
  if (callee.type !== "MemberExpression") return false;
  return staticPropertyName(callee) === "$transaction";
}

/**
 * @param {import('estree').BaseFunction} node
 * @param {import('eslint').SourceCode} sourceCode
 * @returns {TransactionCallbackIdentity}
 */
function callbackIdentity(node, sourceCode) {
  const firstParam = node.params[0];
  if (firstParam?.type !== "Identifier") return { name: undefined, variable: undefined };
  return {
    name: firstParam.name,
    variable: resolveDeclaredVariable(sourceCode.getScope(firstParam), firstParam),
  };
}

/**
 * @template State
 * @param {import('eslint').SourceCode} sourceCode
 * @param {((parent: TransactionCallbackFrame<State> | undefined, callback: TransactionCallbackIdentity | undefined, node: import('estree').BaseFunction) => State) | undefined} [createFrameState]
 */
export function createTransactionCallbackTracker(sourceCode, createFrameState) {
  /** @type {WeakMap<object, TransactionCallbackIdentity>} */
  const transactionCallbacks = new WeakMap();
  /** @type {TransactionCallbackFrame<State>[]} */
  const functionStack = [];

  /** @param {import('estree').BaseFunction} node */
  function enterFunction(node) {
    const parent = functionStack.at(-1);
    const callback = transactionCallbacks.get(node);
    functionStack.push({
      callback,
      inTransaction: parent?.inTransaction === true || callback !== undefined,
      state: createFrameState?.(parent, callback, node),
    });
  }

  function exitFunction() {
    functionStack.pop();
  }

  return {
    /** @param {import('estree').CallExpression} node */
    recordTransactionCall(node) {
      const callback = node.arguments[0];
      if (!isTransactionCall(node) || !isFunctionNode(callback)) return;
      transactionCallbacks.set(callback, callbackIdentity(callback, sourceCode));
    },

    inTransaction() {
      return functionStack.at(-1)?.inTransaction === true;
    },

    currentFrame() {
      return functionStack.at(-1);
    },

    functionVisitors: {
      ArrowFunctionExpression: enterFunction,
      "ArrowFunctionExpression:exit": exitFunction,
      FunctionDeclaration: enterFunction,
      "FunctionDeclaration:exit": exitFunction,
      FunctionExpression: enterFunction,
      "FunctionExpression:exit": exitFunction,
    },
  };
}
