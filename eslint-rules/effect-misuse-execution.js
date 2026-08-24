// @ts-check

import { parentOf, unwrapChain } from "./ast-helpers.js";
import { resolveDeclaredVariable, resolveIdentifierBinding } from "./binding-resolution.js";

// This intentionally matches static method names without proving the receiver
// is a Promise; a non-Promise then/catch/finally method is an accepted false-positive risk.
const PROMISE_CONTINUATION_METHODS = new Set(["catch", "finally", "then"]);
const EFFECT_OWNED_SCHEDULERS = new Set([
  "queueMicrotask",
  "requestAnimationFrame",
  "requestIdleCallback",
  "setInterval",
  "setTimeout",
]);

/**
 * @typedef {import('estree').ArrowFunctionExpression | import('estree').FunctionExpression | import('estree').FunctionDeclaration} FunctionNode
 */

/**
 * @param {import('estree').Node} node
 * @returns {FunctionNode | undefined}
 */
function nearestFunction(node) {
  let current = parentOf(node);
  while (current !== undefined) {
    if (
      current.type === "ArrowFunctionExpression" ||
      current.type === "FunctionExpression" ||
      current.type === "FunctionDeclaration"
    ) {
      return current;
    }
    current = parentOf(current);
  }
  return undefined;
}

/**
 * @param {FunctionNode} node
 * @param {(candidate: import('estree').CallExpression) => boolean} isEffectCall
 */
function isEffectCallback(node, isEffectCall) {
  if (node.type === "FunctionDeclaration") return false;
  const parent = parentOf(node);
  return parent?.type === "CallExpression" && parent.arguments[0] === node && isEffectCall(parent);
}

/**
 * @param {FunctionNode} node
 * @param {import('eslint').SourceCode} sourceCode
 */
function functionVariable(node, sourceCode) {
  if (node.type === "FunctionDeclaration" && node.id !== null) {
    return resolveDeclaredVariable(sourceCode.getScope(node.id), node.id);
  }
  const parent = parentOf(node);
  if (parent?.type !== "VariableDeclarator" || parent.id.type !== "Identifier") return undefined;
  return resolveDeclaredVariable(sourceCode.getScope(parent.id), parent.id);
}

/**
 * @param {import('estree').Identifier} identifier
 * @returns {import('estree').CallExpression | undefined}
 */
function directCallForIdentifier(identifier) {
  const parent = parentOf(identifier);
  return parent?.type === "CallExpression" && unwrapChain(parent.callee) === identifier
    ? parent
    : undefined;
}

/**
 * @param {import('estree').CallExpression} call
 * @param {import('eslint').SourceCode} sourceCode
 */
function isEffectOwnedContinuationRegistration(call, sourceCode) {
  const callee = unwrapChain(call.callee);
  if (callee.type === "Identifier") {
    return (
      EFFECT_OWNED_SCHEDULERS.has(callee.name) &&
      resolveIdentifierBinding(sourceCode, callee) === undefined
    );
  }
  if (callee.type !== "MemberExpression" || callee.computed) return false;
  return (
    callee.property.type === "Identifier" && PROMISE_CONTINUATION_METHODS.has(callee.property.name)
  );
}

/**
 * @param {FunctionNode} node
 * @param {import('eslint').SourceCode} sourceCode
 * @returns {import('estree').CallExpression[]}
 */
function continuationRegistrations(node, sourceCode) {
  const parent = parentOf(node);
  if (
    parent?.type === "CallExpression" &&
    parent.arguments.includes(node) &&
    isEffectOwnedContinuationRegistration(parent, sourceCode)
  ) {
    return [parent];
  }

  const variable = functionVariable(node, sourceCode);
  if (variable === undefined) return [];
  return variable.references.flatMap((reference) => {
    const call = parentOf(reference.identifier);
    return call?.type === "CallExpression" &&
      call.arguments.includes(reference.identifier) &&
      isEffectOwnedContinuationRegistration(call, sourceCode)
      ? [call]
      : [];
  });
}

/**
 * @param {FunctionNode} node
 * @param {FunctionNode} containingFunction
 * @param {import('eslint').SourceCode} sourceCode
 */
function isDirectlyInvokedWithin(node, containingFunction, sourceCode) {
  const parent = parentOf(node);
  if (
    parent?.type === "CallExpression" &&
    unwrapChain(parent.callee) === node &&
    nearestFunction(parent) === containingFunction
  ) {
    return true;
  }

  const variable = functionVariable(node, sourceCode);
  if (variable === undefined) return false;
  return variable.references.some((reference) => {
    const call = directCallForIdentifier(reference.identifier);
    return call !== undefined && nearestFunction(call) === containingFunction;
  });
}

/**
 * @param {FunctionNode} node
 * @param {import('eslint').SourceCode} sourceCode
 * @param {(candidate: import('estree').CallExpression) => boolean} isEffectCall
 * @param {Set<FunctionNode>} visited
 */
function continuationExecutionReachesEffect(node, sourceCode, isEffectCall, visited) {
  return continuationRegistrations(node, sourceCode).some((registration) => {
    const registrationFunction = nearestFunction(registration);
    return (
      registrationFunction !== undefined &&
      synchronousExecutionReachesEffect(
        registrationFunction,
        sourceCode,
        isEffectCall,
        new Set(visited),
      )
    );
  });
}

/**
 * @param {FunctionNode} node
 * @param {import('eslint').SourceCode} sourceCode
 * @param {(candidate: import('estree').CallExpression) => boolean} isEffectCall
 * @param {Set<FunctionNode>} visited
 */
function directCallExecutionReachesEffect(node, sourceCode, isEffectCall, visited) {
  const variable = functionVariable(node, sourceCode);
  if (variable === undefined) return false;
  return variable.references.some((reference) => {
    const call = directCallForIdentifier(reference.identifier);
    const callFunction = call === undefined ? undefined : nearestFunction(call);
    return (
      callFunction !== undefined &&
      synchronousExecutionReachesEffect(callFunction, sourceCode, isEffectCall, new Set(visited))
    );
  });
}

/**
 * @param {FunctionNode} node
 * @param {import('eslint').SourceCode} sourceCode
 * @param {(candidate: import('estree').CallExpression) => boolean} isEffectCall
 */
function synchronousExecutionReachesEffect(node, sourceCode, isEffectCall, visited = new Set()) {
  if (visited.has(node)) return false;
  visited.add(node);
  if (isEffectCallback(node, isEffectCall)) return true;
  const containingFunction = nearestFunction(node);
  if (
    containingFunction !== undefined &&
    isDirectlyInvokedWithin(node, containingFunction, sourceCode) &&
    synchronousExecutionReachesEffect(containingFunction, sourceCode, isEffectCall, visited)
  ) {
    return true;
  }

  if (continuationExecutionReachesEffect(node, sourceCode, isEffectCall, visited)) return true;
  return directCallExecutionReachesEffect(node, sourceCode, isEffectCall, visited);
}

/**
 * True when the call executes in an inline effect callback, a directly invoked
 * helper, or a promise/timer continuation registered by effect-owned flow.
 * Merely registering a callback with a subscription/event API does not count.
 *
 * @param {import('estree').CallExpression} node
 * @param {import('eslint').SourceCode} sourceCode
 * @param {(candidate: import('estree').CallExpression) => boolean} isEffectCall
 */
export function isSynchronouslyInsideEffect(node, sourceCode, isEffectCall) {
  const containingFunction = nearestFunction(node);
  return (
    containingFunction !== undefined &&
    synchronousExecutionReachesEffect(containingFunction, sourceCode, isEffectCall)
  );
}
