// @ts-check

/**
 * Require tRPC router procedures to declare `.output(...)` before `.query(...)`
 * or `.mutation(...)`. The app-router output coverage test enforces this at
 * runtime; this lint rule gives the editor a line-local repair message.
 *
 * Alias resolution follows local declaration initializers and caches by binding.
 * Reassigned procedure-builder aliases are out of scope; keep builder aliases
 * `const` so the output-schema analysis matches the call site.
 */

import { staticPropertyName, unwrapChain } from "./ast-helpers.js";
import { resolveIdentifierBinding } from "./binding-resolution.js";

const RESOLVER_METHODS = new Set(["query", "mutation"]);
const PAIRED_GUIDE = "docs/guides/add-trpc-procedure.md";

/**
 * @typedef {{
 *   hasOutput: boolean,
 *   isProcedure: boolean,
 * }} ProcedureChainAnalysis
 *
 * @typedef {{
 *   sourceCode: import('eslint').SourceCode,
 *   cache: WeakMap<import('eslint').Scope.Variable, ProcedureChainAnalysis>,
 *   seen: Set<import('eslint').Scope.Variable>,
 * }} ProcedureAnalysisContext
 */

/** @type {ProcedureChainAnalysis} */
const NOT_PROCEDURE_CHAIN = { hasOutput: false, isProcedure: false };

/** @param {string} name */
function isProcedureRootName(name) {
  return name === "publicProcedure" || name === "protectedProcedure" || name.endsWith("Procedure");
}

/**
 * @param {ProcedureChainAnalysis} chain
 * @param {boolean} hasOutput
 */
function mergeOutput(chain, hasOutput) {
  return {
    hasOutput: hasOutput || chain.hasOutput,
    isProcedure: chain.isProcedure,
  };
}

/** @param {import('eslint').Scope.Variable} variable */
function procedureVariableInitializer(variable) {
  for (const definition of variable.defs) {
    if (definition.node.type === "VariableDeclarator") {
      return definition.node.init ?? undefined;
    }
  }
  return undefined;
}

/**
 * @param {import('eslint').Scope.Variable} variable
 * @param {ProcedureAnalysisContext} state
 */
function analyzeProcedureVariable(variable, state) {
  const cached = state.cache.get(variable);
  if (cached !== undefined) return cached;
  if (state.seen.has(variable)) return NOT_PROCEDURE_CHAIN;

  state.seen.add(variable);
  const initializer = procedureVariableInitializer(variable);
  const chain =
    initializer === undefined ? NOT_PROCEDURE_CHAIN : analyzeProcedureChain(initializer, state);
  state.cache.set(variable, chain);
  state.seen.delete(variable);
  return chain;
}

/**
 * @param {import('estree').Identifier} identifier
 * @param {boolean} hasOutput
 * @param {ProcedureAnalysisContext} state
 */
function analyzeIdentifierRoot(identifier, hasOutput, state) {
  // Resolve the binding before the *Procedure name heuristic so an alias
  // whose initializer already applied .output is not falsely flagged. The
  // heuristic stays as the fallback for roots the initializer walk cannot
  // vouch for (imports, parameters, unresolved globals).
  const variable = resolveIdentifierBinding(state.sourceCode, identifier);
  if (variable !== undefined) {
    const chain = analyzeProcedureVariable(variable, state);
    if (chain.isProcedure) return mergeOutput(chain, hasOutput);
  }

  if (isProcedureRootName(identifier.name)) {
    return { hasOutput, isProcedure: true };
  }

  return NOT_PROCEDURE_CHAIN;
}

/**
 * @param {import('estree').Node} node
 * @param {ProcedureAnalysisContext} state
 */
function analyzeProcedureChain(node, state) {
  let current = unwrapChain(node);
  let hasOutput = false;

  while (true) {
    if (current.type === "Identifier") {
      return analyzeIdentifierRoot(current, hasOutput, state);
    }

    if (current.type === "CallExpression") {
      const callee = unwrapChain(current.callee);
      if (callee.type !== "MemberExpression") return NOT_PROCEDURE_CHAIN;

      if (staticPropertyName(callee) === "output") hasOutput = true;
      current = unwrapChain(callee.object);
      continue;
    }

    if (current.type === "MemberExpression") {
      if (staticPropertyName(current) === "output") hasOutput = true;
      current = unwrapChain(current.object);
      continue;
    }

    return NOT_PROCEDURE_CHAIN;
  }
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Require tRPC router procedures to declare output schemas",
      principle:
        "Every tRPC router query and mutation must validate its response with a shared output schema.",
      category: "architecture-fitness",
      pairedGuide: PAIRED_GUIDE,
      repairKind: "manual",
    },
    messages: {
      missingOutput:
        "Why: ADR-0004 requires an explicit output schema because a router {{method}} without `.output(...)` returns unvalidated data, so response-shape drift reaches clients silently. How to fix: Add `.output(<sharedSchema>)` before `.{{method}}(...)` to validate the response against a shared schema. " +
        `See ${PAIRED_GUIDE}.`,
    },
    schema: [],
  },

  create(context) {
    /** @type {ProcedureAnalysisContext} */
    const procedureAnalysis = {
      sourceCode: context.sourceCode,
      cache: new WeakMap(),
      seen: new Set(),
    };

    return {
      CallExpression(node) {
        const callee = unwrapChain(node.callee);
        if (callee.type !== "MemberExpression") return;

        const method = staticPropertyName(callee);
        if (!method || !RESOLVER_METHODS.has(method)) return;

        const chain = analyzeProcedureChain(callee.object, procedureAnalysis);
        if (!chain.isProcedure || chain.hasOutput) return;

        context.report({
          node: callee.property,
          messageId: "missingOutput",
          data: { method },
        });
      },
    };
  },
};
