// @ts-check

/**
 * Detect direct writes to concurrency-gated Prisma delegates.
 *
 * The branded delegate types are the enforcement boundary; this name-matching
 * analyzer is the author-time diagnostic that points callers at that boundary.
 */

import {
  isConstDeclarator,
  recordKnownDestructuredAliases,
  resolvedConstPropertyName,
  staticPropertyName,
  unwrapChain,
  unwrapTransparent,
} from "./ast-helpers.js";
import { resolveDeclaredVariable, resolveIdentifierBinding } from "./binding-resolution.js";
import { GATED_DELEGATES, GATED_MUTATORS } from "./concurrency-guard-graph.js";

/**
 * @param {import('estree').Node} node
 * @param {import('eslint').SourceCode} sourceCode
 * @param {WeakMap<import('eslint').Scope.Variable, string>} delegateAliases
 */
function delegateName(node, sourceCode, delegateAliases) {
  const unwrapped = unwrapTransparent(node);
  if (unwrapped.type === "Identifier") {
    if (GATED_DELEGATES.has(unwrapped.name)) return unwrapped.name;
    const variable = resolveIdentifierBinding(sourceCode, unwrapped);
    const recorded = variable === undefined ? undefined : delegateAliases.get(variable);
    return recorded ?? resolvedConstPropertyName(unwrapped, sourceCode, GATED_DELEGATES);
  }
  if (unwrapped.type !== "MemberExpression") return undefined;
  const name = staticPropertyName(unwrapped);
  return name !== undefined && GATED_DELEGATES.has(name) ? name : undefined;
}

/**
 * @param {import('estree').CallExpression} node
 * @param {import('eslint').SourceCode} sourceCode
 * @param {WeakMap<import('eslint').Scope.Variable, string>} delegateAliases
 */
function directGatedWrite(node, sourceCode, delegateAliases) {
  const callee = unwrapChain(node.callee);
  if (callee.type !== "MemberExpression") return undefined;

  const method = staticPropertyName(callee);
  if (!method || !GATED_MUTATORS.has(method)) return undefined;

  const delegate = delegateName(callee.object, sourceCode, delegateAliases);
  if (!delegate) return undefined;

  return { delegate, method };
}

/**
 * @param {import('eslint').SourceCode} sourceCode
 */
export function createDirectAnalyzer(sourceCode) {
  /** @type {WeakMap<import('eslint').Scope.Variable, string>} */
  const delegateAliases = new WeakMap();

  /**
   * @param {import('estree').Identifier} identifier
   * @param {string} name
   */
  function recordAlias(identifier, name) {
    const variable = resolveDeclaredVariable(sourceCode.getScope(identifier), identifier);
    if (variable !== undefined) delegateAliases.set(variable, name);
  }

  return {
    /** @param {import('estree').VariableDeclarator} node */
    recordAliases(node) {
      if (!isConstDeclarator(node)) return;

      if (node.id.type === "Identifier") {
        if (node.init === null || node.init === undefined) return;
        const init = unwrapTransparent(node.init);
        if (init.type !== "MemberExpression") return;
        const delegate = staticPropertyName(init);
        if (delegate !== undefined && GATED_DELEGATES.has(delegate)) {
          recordAlias(node.id, delegate);
        }
        return;
      }

      if (node.id.type === "ObjectPattern") {
        recordKnownDestructuredAliases(node.id, GATED_DELEGATES, recordAlias);
      }
    },

    /** @param {import('estree').CallExpression} node */
    findWrites(node) {
      return directGatedWrite(node, sourceCode, delegateAliases);
    },
  };
}
