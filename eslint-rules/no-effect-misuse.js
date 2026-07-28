// @ts-check

/**
 * Detect two effect shapes that have a clear non-effect replacement in Musi:
 * imperative server-data fetching and effects whose only work is synchronously
 * updating state created by React.useState.
 */

import { importSpecifierName, staticPropertyName, unwrapChain } from "./ast-helpers.js";
import { resolveDeclaredVariable, resolveIdentifierBinding } from "./binding-resolution.js";
import { isSynchronouslyInsideEffect } from "./effect-misuse-execution.js";
import {
  registerTrpcClientDeclaration,
  registerTrpcImport,
} from "./effect-misuse-trpc-provenance.js";

const IMPERATIVE_QUERY_METHODS = new Set(["ensureQueryData", "fetchQuery", "prefetchQuery"]);

/**
 * @param {import('estree').CallExpression} node
 * @param {import('eslint').SourceCode} sourceCode
 * @param {{ direct: Set<import('eslint').Scope.Variable>; namespace: Set<import('eslint').Scope.Variable> }} bindings
 * @param {string} hookName
 */
function isReactHookCall(node, sourceCode, bindings, hookName) {
  const callee = unwrapChain(node.callee);
  if (callee.type === "Identifier") {
    const binding = resolveIdentifierBinding(sourceCode, callee);
    return binding !== undefined && bindings.direct.has(binding);
  }
  if (callee.type !== "MemberExpression" || callee.computed) return false;
  if (staticPropertyName(callee) !== hookName) return false;

  const object = unwrapChain(callee.object);
  if (object.type !== "Identifier") return false;
  const binding = resolveIdentifierBinding(sourceCode, object);
  return binding !== undefined && bindings.namespace.has(binding);
}

/**
 * @param {import('estree').MemberExpression} member
 * @returns {import('estree').Identifier | undefined}
 */
function staticMemberRoot(member) {
  let current = member;
  while (true) {
    if (current.computed || current.property.type !== "Identifier") return undefined;
    const object = unwrapChain(current.object);
    if (object.type === "Identifier") return object;
    if (object.type !== "MemberExpression") return undefined;
    current = object;
  }
}

/**
 * @param {import('estree').CallExpression} node
 * @param {import('eslint').SourceCode} sourceCode
 * @param {Set<import('eslint').Scope.Variable>} trpcClientBindings
 */
function isImperativeQueryCall(node, sourceCode, trpcClientBindings) {
  const callee = unwrapChain(node.callee);
  if (callee.type !== "MemberExpression" || callee.computed) return false;
  const method = staticPropertyName(callee);
  if (method === undefined) return false;
  // TanStack gives these imperative methods distinctive names, and this rule
  // only reports them inside effects, so receiver provenance is intentionally unnecessary.
  if (IMPERATIVE_QUERY_METHODS.has(method)) return true;

  if (method !== "query") return false;
  const root = staticMemberRoot(callee);
  if (root === undefined) return false;
  const binding = resolveIdentifierBinding(sourceCode, root);
  return binding !== undefined && trpcClientBindings.has(binding);
}

/**
 * @param {import('estree').Identifier} identifier
 * @param {import('eslint').SourceCode} sourceCode
 */
function isUnshadowedGlobal(identifier, sourceCode) {
  const binding = resolveIdentifierBinding(sourceCode, identifier);
  return binding === undefined || binding.defs.length === 0;
}

/** @param {import('estree').Node} callee */
function globalFetchObject(callee) {
  if (
    callee.type !== "MemberExpression" ||
    callee.computed ||
    callee.property.type !== "Identifier" ||
    callee.property.name !== "fetch"
  ) {
    return undefined;
  }
  const object = unwrapChain(callee.object);
  return object.type === "Identifier" && (object.name === "globalThis" || object.name === "window")
    ? object
    : undefined;
}

/**
 * @param {import('estree').CallExpression} node
 * @param {import('eslint').SourceCode} sourceCode
 */
function isGlobalFetchCall(node, sourceCode) {
  const callee = unwrapChain(node.callee);
  if (callee.type === "Identifier") {
    return callee.name === "fetch" && isUnshadowedGlobal(callee, sourceCode);
  }
  const object = globalFetchObject(callee);
  return object !== undefined && isUnshadowedGlobal(object, sourceCode);
}

/**
 * @param {import('estree').CallExpression} node
 * @param {import('eslint').SourceCode} sourceCode
 * @param {Set<import('eslint').Scope.Variable>} trpcClientBindings
 * @param {Set<import('eslint').Scope.Variable>} trpcFetchBindings
 */
function isFetchCall(node, sourceCode, trpcClientBindings, trpcFetchBindings) {
  if (isGlobalFetchCall(node, sourceCode)) return true;
  const callee = unwrapChain(node.callee);
  if (callee.type === "Identifier") {
    const binding = resolveIdentifierBinding(sourceCode, callee);
    return binding !== undefined && trpcFetchBindings.has(binding);
  }
  return isImperativeQueryCall(node, sourceCode, trpcClientBindings);
}

/**
 * @param {import('estree').Expression} expression
 * @param {import('eslint').SourceCode} sourceCode
 * @param {Set<import('eslint').Scope.Variable>} stateSetterBindings
 */
function isStateSetterCall(expression, sourceCode, stateSetterBindings) {
  const unwrapped = unwrapChain(expression);
  if (unwrapped.type !== "CallExpression") return false;
  const callee = unwrapChain(unwrapped.callee);
  if (callee.type !== "Identifier") return false;
  const binding = resolveIdentifierBinding(sourceCode, callee);
  return binding !== undefined && stateSetterBindings.has(binding);
}

/**
 * @typedef {{ onlyStateUpdates: boolean; stateUpdateCount: number }} StateUpdateSummary
 */

/**
 * @param {import('estree').Statement} statement
 * @param {import('eslint').SourceCode} sourceCode
 * @param {Set<import('eslint').Scope.Variable>} stateSetterBindings
 * @returns {StateUpdateSummary}
 */
function summarizeStatement(statement, sourceCode, stateSetterBindings) {
  if (statement.type === "EmptyStatement") {
    return { onlyStateUpdates: true, stateUpdateCount: 0 };
  }
  if (statement.type === "ReturnStatement" && statement.argument === null) {
    return { onlyStateUpdates: true, stateUpdateCount: 0 };
  }
  if (statement.type === "ExpressionStatement") {
    const isSetter = isStateSetterCall(statement.expression, sourceCode, stateSetterBindings);
    return { onlyStateUpdates: isSetter, stateUpdateCount: isSetter ? 1 : 0 };
  }
  if (statement.type === "BlockStatement") {
    return summarizeStatements(statement.body, sourceCode, stateSetterBindings);
  }
  if (statement.type === "IfStatement") {
    const consequent = summarizeStatement(statement.consequent, sourceCode, stateSetterBindings);
    const alternate =
      statement.alternate === null
        ? { onlyStateUpdates: true, stateUpdateCount: 0 }
        : summarizeStatement(statement.alternate, sourceCode, stateSetterBindings);
    return {
      onlyStateUpdates: consequent.onlyStateUpdates && alternate.onlyStateUpdates,
      stateUpdateCount: consequent.stateUpdateCount + alternate.stateUpdateCount,
    };
  }
  return { onlyStateUpdates: false, stateUpdateCount: 0 };
}

/**
 * @param {import('estree').Statement[]} statements
 * @param {import('eslint').SourceCode} sourceCode
 * @param {Set<import('eslint').Scope.Variable>} stateSetterBindings
 * @returns {StateUpdateSummary}
 */
function summarizeStatements(statements, sourceCode, stateSetterBindings) {
  let stateUpdateCount = 0;
  for (const statement of statements) {
    const summary = summarizeStatement(statement, sourceCode, stateSetterBindings);
    if (!summary.onlyStateUpdates) return { onlyStateUpdates: false, stateUpdateCount: 0 };
    stateUpdateCount += summary.stateUpdateCount;
  }
  return { onlyStateUpdates: true, stateUpdateCount };
}

/**
 * @param {import('estree').ArrowFunctionExpression | import('estree').FunctionExpression} callback
 * @param {import('eslint').SourceCode} sourceCode
 * @param {Set<import('eslint').Scope.Variable>} stateSetterBindings
 */
function isDerivedStateOnlyEffect(callback, sourceCode, stateSetterBindings) {
  if (callback.body.type !== "BlockStatement") {
    return isStateSetterCall(callback.body, sourceCode, stateSetterBindings);
  }
  const summary = summarizeStatements(callback.body.body, sourceCode, stateSetterBindings);
  return summary.onlyStateUpdates && summary.stateUpdateCount > 0;
}

/**
 * @param {import('estree').ImportDeclarationSpecifier} specifier
 * @param {import('eslint').Scope.Variable} variable
 * @param {{ effect: Set<import('eslint').Scope.Variable>; layoutEffect: Set<import('eslint').Scope.Variable>; state: Set<import('eslint').Scope.Variable>; namespace: Set<import('eslint').Scope.Variable> }} bindings
 */
function registerReactImport(specifier, variable, bindings) {
  if (
    specifier.type === "ImportDefaultSpecifier" ||
    specifier.type === "ImportNamespaceSpecifier"
  ) {
    bindings.namespace.add(variable);
    return;
  }
  const importedName = importSpecifierName(specifier);
  if (importedName === "useEffect") bindings.effect.add(variable);
  if (importedName === "useLayoutEffect") bindings.layoutEffect.add(variable);
  if (importedName === "useState") bindings.state.add(variable);
}

/**
 * @param {import('estree').VariableDeclarator} node
 * @param {import('eslint').SourceCode} sourceCode
 * @param {(candidate: import('estree').CallExpression) => boolean} isStateCall
 */
function declaredStateSetter(node, sourceCode, isStateCall) {
  if (node.id.type !== "ArrayPattern") return undefined;
  if (node.init?.type !== "CallExpression" || !isStateCall(node.init)) return undefined;
  const setter = node.id.elements[1];
  if (setter?.type !== "Identifier") return undefined;
  return resolveDeclaredVariable(sourceCode.getScope(setter), setter);
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow imperative data fetching and derived-state-only React effects",
      principle:
        "Effects synchronize React with external systems; server data, derived state, event logic, and form resets have dedicated declarative owners.",
      category: "architecture-fitness",
      pairedGuide: "docs/guides/client-effects.md",
      repairKind: "manual",
    },
    messages: {
      fetchInEffect:
        "Why: Imperative fetching inside an effect bypasses Musi's tRPC and TanStack Query data lifecycle. How to fix: Move server reads to a tRPC query hook, or move a user-initiated mutation into its event handler. See docs/guides/client-effects.md.",
      derivedStateEffect:
        "Why: This effect only updates React state, adding an avoidable render and letting values drift out of sync. How to fix: Use render-time computation for derived values, update state in the originating event handler, or reset a dialog/form with a key remount. See docs/guides/client-effects.md.",
    },
    schema: [],
  },

  create(context) {
    const effectBindings = new Set();
    const layoutEffectBindings = new Set();
    const stateBindings = new Set();
    const reactNamespaceBindings = new Set();
    const stateSetterBindings = new Set();
    const trpcClientBindings = new Set();
    const trpcClientFactoryBindings = new Set();
    const trpcFetchBindings = new Set();

    /** @param {import('estree').CallExpression} node */
    const isEffectCall = (node) =>
      isReactHookCall(
        node,
        context.sourceCode,
        { direct: effectBindings, namespace: reactNamespaceBindings },
        "useEffect",
      );

    /** @param {import('estree').CallExpression} node */
    const isFetchEffectCall = (node) =>
      isEffectCall(node) ||
      isReactHookCall(
        node,
        context.sourceCode,
        { direct: layoutEffectBindings, namespace: reactNamespaceBindings },
        "useLayoutEffect",
      );

    /** @param {import('estree').CallExpression} node */
    const isStateCall = (node) =>
      isReactHookCall(
        node,
        context.sourceCode,
        { direct: stateBindings, namespace: reactNamespaceBindings },
        "useState",
      );

    return {
      ImportDeclaration(node) {
        for (const specifier of node.specifiers) {
          const variable = resolveDeclaredVariable(
            context.sourceCode.getScope(specifier.local),
            specifier.local,
          );
          if (variable === undefined) continue;
          if (node.source.value === "react") {
            registerReactImport(specifier, variable, {
              effect: effectBindings,
              layoutEffect: layoutEffectBindings,
              state: stateBindings,
              namespace: reactNamespaceBindings,
            });
            continue;
          }
          registerTrpcImport(node.source.value, specifier, variable, {
            client: trpcClientBindings,
            factory: trpcClientFactoryBindings,
            fetch: trpcFetchBindings,
          });
        }
      },

      VariableDeclarator(node) {
        registerTrpcClientDeclaration(
          node,
          context.sourceCode,
          trpcClientBindings,
          trpcClientFactoryBindings,
        );
        const setter = declaredStateSetter(node, context.sourceCode, isStateCall);
        if (setter !== undefined) stateSetterBindings.add(setter);
      },

      CallExpression(node) {
        if (
          isFetchCall(node, context.sourceCode, trpcClientBindings, trpcFetchBindings) &&
          isSynchronouslyInsideEffect(node, context.sourceCode, isFetchEffectCall)
        ) {
          context.report({ node: node.callee, messageId: "fetchInEffect" });
        }

        if (!isEffectCall(node)) return;
        const callback = node.arguments[0];
        if (
          callback?.type !== "ArrowFunctionExpression" &&
          callback?.type !== "FunctionExpression"
        ) {
          return;
        }
        if (isDerivedStateOnlyEffect(callback, context.sourceCode, stateSetterBindings)) {
          context.report({ node: node.callee, messageId: "derivedStateEffect" });
        }
      },
    };
  },
};
