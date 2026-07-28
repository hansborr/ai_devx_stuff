// @ts-check

/**
 * Interactive Prisma transactions must use the callback transaction client.
 * A call through the outer client inside the callback escapes the transaction
 * and may check out another pooled connection while the transaction holds one.
 * Helper argument inspection covers direct arguments, object/array containers,
 * and spreads, but not conditional/logical wrappers like `cond ? prisma : tx`
 * or `prisma || tx`.
 */

import { staticPropertyName, unwrapChain } from "./ast-helpers.js";
import { resolveDeclaredVariable, resolveIdentifierBinding } from "./binding-resolution.js";

const PAIRED_GUIDE = "docs/CONCURRENCY.md";

/**
 * @typedef {{
 *   inTransaction: boolean,
 *   transactionClientNames: Set<string>,
 *   transactionClientVariables: Set<import('eslint').Scope.Variable>,
 * }} TransactionFunctionState
 */

/**
 * @typedef {{
 *   transactionClientNames: Set<string>,
 *   transactionClientVariables: Set<import('eslint').Scope.Variable>,
 *   sourceCode: import('eslint').SourceCode,
 *   outerPrismaVariables: WeakSet<import('eslint').Scope.Variable>,
 * }} ClientResolutionState
 */

/** @param {import('estree').Node} node */
function parentOf(node) {
  return /** @type {import('estree').Node & { parent?: import('estree').Node }} */ (node).parent;
}

/** @param {import('estree').Node | import('estree').SpreadElement | undefined} node */
function isFunctionNode(node) {
  return node?.type === "ArrowFunctionExpression" || node?.type === "FunctionExpression";
}

/** @param {import('estree').CallExpression} node */
function isTransactionCall(node) {
  const callee = unwrapChain(node.callee);
  if (callee.type !== "MemberExpression") return false;
  return staticPropertyName(callee) === "$transaction";
}

/**
 * @param {import('estree').Node} node
 * @param {ClientResolutionState} state
 */
function startsWithOuterPrismaClient(node, state) {
  const current = unwrapChain(node);

  if (current.type === "Identifier") {
    const variable = resolveIdentifierBinding(state.sourceCode, current);
    if (current.name === "prisma") {
      if (state.transactionClientNames.has(current.name)) return false;
      return variable === undefined || !state.transactionClientVariables.has(variable);
    }
    return variable !== undefined && state.outerPrismaVariables.has(variable);
  }

  if (current.type !== "MemberExpression") return false;

  if (staticPropertyName(current) === "prisma") return true;
  return startsWithOuterPrismaClient(current.object, state);
}

/**
 * @param {import('estree').ObjectExpression} node
 * @param {ClientResolutionState} state
 */
function objectContainsOuterPrismaClient(node, state) {
  return node.properties.some((property) => {
    const value = property.type === "Property" ? property.value : property.argument;
    return containsOuterPrismaClient(value, state);
  });
}

/**
 * @param {import('estree').ArrayExpression} node
 * @param {ClientResolutionState} state
 */
function arrayContainsOuterPrismaClient(node, state) {
  return node.elements.some(
    (element) => element !== null && containsOuterPrismaClient(element, state),
  );
}

/**
 * @param {import('estree').Node | import('estree').SpreadElement} node
 * @param {ClientResolutionState} state
 */
function containsOuterPrismaClient(node, state) {
  const current = node.type === "SpreadElement" ? node.argument : unwrapChain(node);
  if (startsWithOuterPrismaClient(current, state)) return true;
  if (current.type === "ObjectExpression") {
    return objectContainsOuterPrismaClient(current, state);
  }
  if (current.type === "ArrayExpression") {
    return arrayContainsOuterPrismaClient(current, state);
  }
  return false;
}

/** @param {import('estree').VariableDeclarator} node */
function isConstDeclarator(node) {
  return parentOf(node)?.type === "VariableDeclaration" && parentOf(node)?.kind === "const";
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

/**
 * @param {import('estree').BaseFunction} node
 * @param {import('eslint').SourceCode} sourceCode
 */
function transactionClientVariablesFor(node, sourceCode) {
  const variables = new Set();
  const firstParam = node.params[0];
  if (firstParam?.type !== "Identifier") return variables;
  const variable = resolveDeclaredVariable(sourceCode.getScope(firstParam), firstParam);
  if (variable !== undefined) variables.add(variable);
  return variables;
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

/**
 * @param {Set<import('eslint').Scope.Variable>} inheritedVariables
 * @param {Set<import('eslint').Scope.Variable> | undefined} localVariables
 */
function mergedVariables(inheritedVariables, localVariables) {
  if (localVariables === undefined || localVariables.size === 0) return inheritedVariables;
  return new Set([...inheritedVariables, ...localVariables]);
}

/**
 * @param {TransactionFunctionState | undefined} parent
 * @param {Set<string> | undefined} callbackNames
 * @param {import('estree').BaseFunction} node
 */
function namesForFunctionFrame(parent, callbackNames, node) {
  const inheritedNames = callbackNames ?? parent?.transactionClientNames ?? new Set();
  const localNames =
    callbackNames === undefined && parent?.inTransaction === true
      ? localPrismaParamNamesFor(node)
      : new Set();
  return mergedNames(inheritedNames, localNames);
}

/**
 * @param {TransactionFunctionState | undefined} parent
 * @param {Set<import('eslint').Scope.Variable> | undefined} callbackVariables
 */
function variablesForFunctionFrame(parent, callbackVariables) {
  return mergedVariables(parent?.transactionClientVariables ?? new Set(), callbackVariables);
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
      pairedGuide: PAIRED_GUIDE,
      repairKind: "manual",
    },
    messages: {
      outerClientInTransaction:
        "Why: Calling the outer Prisma client inside a `$transaction` callback escapes atomicity and can deadlock the pool. How to fix: Use the `tx` callback parameter for every Prisma call inside the callback. " +
        `See ${PAIRED_GUIDE}.`,
    },
    schema: [],
  },

  create(context) {
    /** @type {WeakMap<object, Set<string>>} */
    const transactionCallbacks = new WeakMap();
    /** @type {WeakMap<object, Set<import('eslint').Scope.Variable>>} */
    const transactionCallbackVariables = new WeakMap();
    /** @type {WeakSet<import('eslint').Scope.Variable>} */
    const outerPrismaVariables = new WeakSet();
    /** @type {TransactionFunctionState[]} */
    const transactionFunctionStack = [];

    function currentTransactionClientNames() {
      return transactionFunctionStack.at(-1)?.transactionClientNames ?? new Set();
    }

    function currentTransactionClientVariables() {
      return transactionFunctionStack.at(-1)?.transactionClientVariables ?? new Set();
    }

    /** @returns {ClientResolutionState} */
    function currentClientResolutionState() {
      return {
        transactionClientNames: currentTransactionClientNames(),
        transactionClientVariables: currentTransactionClientVariables(),
        sourceCode: context.sourceCode,
        outerPrismaVariables,
      };
    }

    /** @param {import('estree').VariableDeclarator} node */
    function recordOuterPrismaAlias(node) {
      if (!isConstDeclarator(node)) return;
      if (node.id.type !== "Identifier") return;
      if (node.init === null) return;
      if (!startsWithOuterPrismaClient(node.init, currentClientResolutionState())) return;

      const variable = resolveDeclaredVariable(context.sourceCode.getScope(node.id), node.id);
      if (variable !== undefined) outerPrismaVariables.add(variable);
    }

    /** @param {import('estree').CallExpression} node */
    function outerClientArgument(node) {
      const state = currentClientResolutionState();
      for (const argument of node.arguments) {
        if (containsOuterPrismaClient(argument, state)) return argument;
      }
      return undefined;
    }

    /** @param {import('estree').CallExpression} node */
    function reportOuterClientCallee(node) {
      const callee = unwrapChain(node.callee);
      if (callee.type !== "MemberExpression") return false;
      if (!startsWithOuterPrismaClient(callee.object, currentClientResolutionState())) return false;

      context.report({
        node: callee,
        messageId: "outerClientInTransaction",
      });
      return true;
    }

    function enterFunction(/** @type {import('estree').BaseFunction} */ node) {
      const parent = transactionFunctionStack.at(-1);
      const callbackNames = transactionCallbacks.get(node);
      const callbackVariables = transactionCallbackVariables.get(node);
      transactionFunctionStack.push({
        inTransaction: parent?.inTransaction === true || callbackNames !== undefined,
        transactionClientNames: namesForFunctionFrame(parent, callbackNames, node),
        transactionClientVariables: variablesForFunctionFrame(parent, callbackVariables),
      });
    }

    function exitFunction() {
      transactionFunctionStack.pop();
    }

    return {
      VariableDeclarator: recordOuterPrismaAlias,
      CallExpression(node) {
        if (isTransactionCall(node) && isFunctionNode(node.arguments[0])) {
          transactionCallbacks.set(node.arguments[0], transactionClientNamesFor(node.arguments[0]));
          transactionCallbackVariables.set(
            node.arguments[0],
            transactionClientVariablesFor(node.arguments[0], context.sourceCode),
          );
        }

        if (transactionFunctionStack.at(-1)?.inTransaction !== true) return;

        if (reportOuterClientCallee(node)) return;
        const argument = outerClientArgument(node);
        if (argument === undefined) return;

        context.report({
          node: argument,
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
