// @ts-check

/**
 * Disallow template literals with expressions (and string concatenation) as
 * direct arguments to Pino-style logger methods. Dynamic values belong in the
 * metadata object, not interpolated into the message — log aggregators key on
 * the static message string.
 *
 * Targets call sites of the shape `<expr>.log.<level>(...)` where <level> is
 * a Pino log level. Does NOT touch Error/TRPCError constructors, where
 * dynamic messages are sometimes intentional (user-facing copy).
 */

const PINO_LEVELS = new Set(["fatal", "error", "warn", "info", "debug", "trace"]);

/** @param {import('estree').CallExpression} node */
function isLoggerCall(node) {
  // Match `<obj>.log.<level>(...)`.
  const callee = node.callee;
  if (callee.type !== "MemberExpression" || callee.computed) return false;
  if (callee.property.type !== "Identifier") return false;
  if (!PINO_LEVELS.has(callee.property.name)) return false;

  const inner = callee.object;
  if (inner.type !== "MemberExpression" || inner.computed) return false;
  if (inner.property.type !== "Identifier") return false;
  return inner.property.name === "log";
}

/** @param {import('estree').Node} node */
function isStringConcat(node) {
  if (node.type !== "BinaryExpression" || node.operator !== "+") return false;
  /** @param {import('estree').Node} n */
  const stringy = (n) =>
    (n.type === "Literal" && typeof n.value === "string") ||
    n.type === "TemplateLiteral" ||
    isStringConcat(n);
  return stringy(node.left) || stringy(node.right);
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Pino logger messages must be static; pass dynamic values via the metadata object",
    },
    messages: {
      noTemplate:
        "Logger message must be a static string. Move `${...}` values into the metadata object (e.g., `log.error({ userId }, 'failed')`).",
      noConcat:
        "Logger message must be a static string. Move concatenated values into the metadata object.",
    },
    schema: [],
  },

  create(context) {
    return {
      CallExpression(node) {
        if (!isLoggerCall(node)) return;

        for (const arg of node.arguments) {
          if (arg.type === "TemplateLiteral" && arg.expressions.length > 0) {
            context.report({ node: arg, messageId: "noTemplate" });
          } else if (isStringConcat(arg)) {
            context.report({ node: arg, messageId: "noConcat" });
          }
        }
      },
    };
  },
};
