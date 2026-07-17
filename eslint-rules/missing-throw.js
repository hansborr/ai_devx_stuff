// @ts-check

const ERROR_CONSTRUCTORS = new Set([
  "AggregateError",
  "Error",
  "EvalError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",
]);
const TRANSPARENT_WRAPPER_TYPES = new Set([
  "TSAsExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "TSTypeAssertion",
]);

/**
 * @param {import('eslint').SourceCode} sourceCode
 * @param {import('estree').Identifier} callee
 */
function isGlobalBuiltinConstructor(sourceCode, callee) {
  for (let scope = sourceCode.getScope(callee); scope !== null; scope = scope.upper) {
    const variable = scope.variables.find(({ name }) => name === callee.name);
    if (variable !== undefined) return variable.defs.length === 0;
  }
  return true;
}

/** @param {import('estree').CallExpression | import('estree').NewExpression} node */
function discardedExpressionStatement(node) {
  /** @type {import('estree').Node} */
  let current = node;
  let parent = current.parent;
  while (parent !== undefined && TRANSPARENT_WRAPPER_TYPES.has(parent.type)) {
    current = parent;
    parent = current.parent;
  }
  if (parent?.type === "ExpressionStatement" && parent.expression === current) return parent;
  return undefined;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow standalone built-in Error constructions that are never thrown",
      principle:
        "Constructing an Error as a standalone expression does not stop execution or notify callers, leaving invalid control-flow paths to continue silently.",
      category: "behavior",
      pairedGuide: "none",
      repairKind: "autofix",
    },
    fixable: "code",
    messages: {
      missingThrow:
        "Why: This built-in Error is constructed and immediately discarded, so execution continues normally. How to fix: Add `throw` before the construction, or explicitly return or assign the Error when it is intentionally used as a value.",
    },
    schema: [],
  },

  create(context) {
    /** @param {import('estree').CallExpression | import('estree').NewExpression} node */
    function checkDiscardedError(node) {
      if (node.callee.type !== "Identifier") return;
      if (!ERROR_CONSTRUCTORS.has(node.callee.name)) return;
      if (!isGlobalBuiltinConstructor(context.sourceCode, node.callee)) return;
      const statement = discardedExpressionStatement(node);
      if (statement === undefined) return;

      context.report({
        node,
        messageId: "missingThrow",
        fix: (fixer) => fixer.insertTextBefore(statement, "throw "),
      });
    }

    return {
      CallExpression: checkDiscardedError,
      NewExpression: checkDiscardedError,
    };
  },
};
