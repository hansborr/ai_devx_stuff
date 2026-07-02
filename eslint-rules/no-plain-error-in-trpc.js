// @ts-check

/**
 * tRPC routers and services must throw coded `TRPCError`s instead of direct
 * plain `Error`s so callers receive intentional error semantics.
 */

/** @param {import('estree').Node | null | undefined} node */
function isPlainErrorConstructor(node) {
  return (
    node?.type === "NewExpression" &&
    node.callee.type === "Identifier" &&
    node.callee.name === "Error"
  );
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow direct plain Error throws in tRPC-adjacent server surfaces",
      principle:
        "tRPC routers and services must throw coded TRPCErrors so clients receive intentional error semantics instead of opaque INTERNAL_SERVER_ERROR responses.",
      category: "behavior",
      pairedGuide: "docs/authorization.md",
      repairKind: "manual",
    },
    messages: {
      plainError:
        "Why: A direct plain Error thrown through a tRPC procedure loses the intended tRPC error code and reaches clients as an opaque 500. How to fix: Use TRPCError with the right code, or translate this domain error at the tRPC boundary. See docs/authorization.md.",
    },
    schema: [],
  },

  create(context) {
    return {
      ThrowStatement(node) {
        if (!isPlainErrorConstructor(node.argument)) return;

        context.report({
          node: node.argument,
          messageId: "plainError",
        });
      },
    };
  },
};
