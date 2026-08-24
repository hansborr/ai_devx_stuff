// @ts-check

/**
 * Promise.all and Promise.allSettled eagerly start every promise in their
 * input. Mapping a dynamically sized collection into either combinator can
 * therefore turn one request into an unbounded number of database or API
 * operations.
 */

import { parentOf, staticPropertyName, unwrapChain } from "./ast-helpers.js";
import { resolveIdentifierBinding } from "./binding-resolution.js";

const MAX_STATIC_TUPLE_SIZE = 5;
const GUARDED_COMBINATORS = new Set(["all", "allSettled"]);
const NON_EXPANDING_ARRAY_METHODS = new Set(["filter", "map", "slice"]);

/**
 * @typedef {{
 *   mapped: boolean,
 *   unknownSpread: boolean,
 *   upperBound: number | undefined,
 * }} CollectionAnalysis
 */

/**
 * @typedef {{
 *   resolving: Set<import('eslint').Scope.Variable>,
 *   sourceCode: import('eslint').SourceCode,
 * }} AnalysisState
 */

/**
 * @returns {CollectionAnalysis}
 */
function unknownCollection() {
  return { mapped: false, unknownSpread: false, upperBound: undefined };
}

/**
 * @param {import('estree').CallExpression} node
 * @returns {{ method: string, receiver: import('estree').Node } | undefined}
 */
function nonExpandingArrayCall(node) {
  const callee = unwrapChain(node.callee);
  if (callee.type !== "MemberExpression") return undefined;
  const method = staticPropertyName(callee);
  if (method === undefined || !NON_EXPANDING_ARRAY_METHODS.has(method)) return undefined;
  return { method, receiver: callee.object };
}

/**
 * @param {import('eslint').Scope.Variable} variable
 * @returns {import('estree').Expression | undefined}
 */
function simpleConstInitializer(variable) {
  if (variable.identifiers.length !== 1) return undefined;
  const declarationIdentifier = variable.identifiers[0];
  if (declarationIdentifier === undefined) return undefined;
  const declarator = parentOf(declarationIdentifier);
  if (declarator?.type !== "VariableDeclarator" || declarator.id !== declarationIdentifier) {
    return undefined;
  }
  const declaration = parentOf(declarator);
  if (declaration?.type !== "VariableDeclaration" || declaration.kind !== "const") {
    return undefined;
  }
  return declarator.init ?? undefined;
}

/**
 * Resolve only a simple `const name = initializer` binding. This deliberately
 * stops short of assignment or control-flow analysis.
 *
 * @param {import('estree').Identifier} identifier
 * @param {AnalysisState} state
 * @returns {CollectionAnalysis | undefined}
 */
function analyzeConstInitializer(identifier, state) {
  const variable = resolveIdentifierBinding(state.sourceCode, identifier);
  if (variable === undefined) return undefined;
  if (state.resolving.has(variable)) return undefined;
  const initializer = simpleConstInitializer(variable);
  if (initializer === undefined) return undefined;

  state.resolving.add(variable);
  const analysis = analyzeCollection(initializer, state);
  state.resolving.delete(variable);
  return analysis;
}

/**
 * @param {CollectionAnalysis} left
 * @param {CollectionAnalysis} right
 * @returns {CollectionAnalysis}
 */
function mergeArrayAnalysis(left, right) {
  return {
    mapped: left.mapped || right.mapped,
    unknownSpread: left.unknownSpread || right.unknownSpread,
    upperBound:
      left.upperBound === undefined || right.upperBound === undefined
        ? undefined
        : left.upperBound + right.upperBound,
  };
}

/**
 * @param {import('estree').Expression | import('estree').SpreadElement | null} element
 * @param {AnalysisState} state
 * @returns {CollectionAnalysis}
 */
function analyzeArrayElement(element, state) {
  if (element?.type !== "SpreadElement") {
    return { mapped: false, unknownSpread: false, upperBound: 1 };
  }

  const spread = analyzeCollection(element.argument, state);
  return {
    mapped: spread.mapped,
    unknownSpread: spread.unknownSpread || spread.upperBound === undefined,
    upperBound: spread.upperBound,
  };
}

/**
 * @param {import('estree').ArrayExpression} node
 * @param {AnalysisState} state
 * @returns {CollectionAnalysis}
 */
function analyzeArrayExpression(node, state) {
  let analysis = { mapped: false, unknownSpread: false, upperBound: 0 };
  for (const element of node.elements) {
    analysis = mergeArrayAnalysis(analysis, analyzeArrayElement(element, state));
  }
  return analysis;
}

/**
 * @param {import('estree').CallExpression} node
 * @param {AnalysisState} state
 * @returns {CollectionAnalysis}
 */
function analyzeCallExpression(node, state) {
  const call = nonExpandingArrayCall(node);
  if (call === undefined) return unknownCollection();
  const receiver = analyzeCollection(call.receiver, state);
  return {
    mapped: receiver.mapped || call.method === "map",
    unknownSpread: receiver.unknownSpread,
    upperBound: receiver.upperBound,
  };
}

/**
 * Track a collection's static upper bound through array literals, simple const
 * bindings, and cardinality-preserving or reducing method chains.
 *
 * @param {import('estree').Node} node
 * @param {AnalysisState} state
 * @returns {CollectionAnalysis}
 */
function analyzeCollection(node, state) {
  const current = unwrapChain(node);

  if (current.type === "Identifier") {
    return analyzeConstInitializer(current, state) ?? unknownCollection();
  }

  if (current.type === "CallExpression") {
    return analyzeCallExpression(current, state);
  }

  if (current.type !== "ArrayExpression") return unknownCollection();
  return analyzeArrayExpression(current, state);
}

/**
 * @param {import('estree').Expression | import('estree').SpreadElement | undefined} argument
 * @param {import('eslint').SourceCode} sourceCode
 */
function hasUnboundedInput(argument, sourceCode) {
  if (argument === undefined || argument.type === "SpreadElement") return false;

  const analysis = analyzeCollection(argument, { resolving: new Set(), sourceCode });
  if (analysis.unknownSpread) return true;
  if (!analysis.mapped) return false;

  return analysis.upperBound === undefined || analysis.upperBound > MAX_STATIC_TUPLE_SIZE;
}

/**
 * @param {import('estree').CallExpression} node
 * @param {import('eslint').SourceCode} sourceCode
 */
function guardedCombinatorName(node, sourceCode) {
  const callee = unwrapChain(node.callee);
  if (callee.type !== "MemberExpression") return undefined;
  if (callee.object.type !== "Identifier" || callee.object.name !== "Promise") return undefined;

  const promiseBinding = resolveIdentifierBinding(sourceCode, callee.object);
  if (promiseBinding !== undefined && promiseBinding.defs.length > 0) return undefined;

  const name = staticPropertyName(callee);
  return name !== undefined && GUARDED_COMBINATORS.has(name) ? name : undefined;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow unbounded dynamic fan-out through Promise combinators",
      principle:
        "Dynamically sized Promise fan-out must not exhaust database pools or external API capacity.",
      category: "behavior",
      pairedGuide: "none",
      repairKind: "manual",
    },
    messages: {
      unboundedFanOut:
        "Why: `Promise.{{method}}` over a dynamically sized collection starts every operation at once and can exhaust database or API capacity. How to fix: Use a sequential `for...of` loop as the sanctioned bound of one, or introduce a reviewed bounded-concurrency helper before preserving parallelism.",
    },
    schema: [],
  },

  create(context) {
    return {
      CallExpression(node) {
        const method = guardedCombinatorName(node, context.sourceCode);
        if (method === undefined || !hasUnboundedInput(node.arguments[0], context.sourceCode)) {
          return;
        }
        context.report({ node, messageId: "unboundedFanOut", data: { method } });
      },
    };
  },
};
