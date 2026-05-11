// @ts-check

/**
 * Catch blocks that only log to console hide failures from callers. Keep this
 * narrow: logging wrappers, named error handlers, returns, and rethrows are
 * domain decisions outside this rule's first pass.
 */

const CONSOLE_METHODS = new Set(["debug", "error", "log", "warn"]);

/** @param {import('estree').Expression | import('estree').Super} node */
function unwrapChain(node) {
  return node.type === "ChainExpression" ? node.expression : node;
}

/** @param {import('estree').Statement} statement */
function isDirectConsoleCallStatement(statement) {
  if (statement.type !== "ExpressionStatement") return false;

  const expression = statement.expression;
  if (expression.type !== "CallExpression") return false;

  const callee = unwrapChain(expression.callee);
  if (callee.type !== "MemberExpression" || callee.computed) return false;
  if (callee.object.type !== "Identifier" || callee.object.name !== "console") return false;

  return callee.property.type === "Identifier" && CONSOLE_METHODS.has(callee.property.name);
}

/** @param {import('estree').Statement} statement */
function isExecutableStatement(statement) {
  return statement.type !== "EmptyStatement";
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow catch blocks that only log to console and continue",
    },
    messages: {
      swallowedError:
        "Catch block only logs to console, so callers cannot detect the failure. Rethrow with `cause`, return a failure value, or delegate to a named error handler.",
    },
    schema: [],
  },

  create(context) {
    return {
      CatchClause(node) {
        const statements = node.body.body.filter(isExecutableStatement);
        if (statements.length === 0) return;
        if (!statements.every(isDirectConsoleCallStatement)) return;

        context.report({ node: node.body, messageId: "swallowedError" });
      },
    };
  },
};
