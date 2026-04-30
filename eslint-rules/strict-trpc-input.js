// @ts-check

/**
 * Require `.strict()` on inline `z.object(...)` schemas passed to tRPC
 * `.input(...)`. Strict-mode objects reject unknown keys, which catches
 * client-side typos at the API boundary instead of silently dropping them.
 *
 * Only fires on inline `z.object({ ... })` (and chained calls on top of one).
 * If the argument is a named identifier or a non-object schema
 * (`z.union`, `z.discriminatedUnion`, etc.) the rule stays silent — those
 * cases need to be handled at the schema definition site, not the call site.
 */

/**
 * Walk down a method-call chain rooted at `arg`. Returns whether the chain
 * ultimately calls `z.object(...)` and which unknown-key mode wins, i.e. the
 * outermost mode call along the chain. `.strict().passthrough()` resolves to
 * "passthrough" because the outer call replaces the earlier mode.
 *
 * @param {import('estree').Node} arg
 */
function analyzeChain(arg) {
  /** @type {"strict" | "passthrough" | "strip" | "catchall" | null} */
  let outermostMode = null;
  let cur = arg;
  while (cur.type === "CallExpression" && cur.callee.type === "MemberExpression") {
    if (cur.callee.property.type === "Identifier") {
      const name = cur.callee.property.name;
      if (
        outermostMode === null &&
        (name === "strict" || name === "passthrough" || name === "strip" || name === "catchall")
      ) {
        outermostMode = name;
      }
    }
    if (cur.callee.object.type !== "CallExpression") break;
    cur = cur.callee.object;
  }
  const rootIsZObject =
    cur.type === "CallExpression" &&
    cur.callee.type === "MemberExpression" &&
    cur.callee.object.type === "Identifier" &&
    cur.callee.object.name === "z" &&
    cur.callee.property.type === "Identifier" &&
    cur.callee.property.name === "object";
  return { rootIsZObject, outermostMode };
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "suggestion",
    docs: {
      description: "tRPC .input(z.object(...)) schemas must call .strict()",
    },
    messages: {
      needsStrict:
        "tRPC input schemas must call .strict() on z.object(...) so unknown keys are rejected at the API boundary.",
    },
    schema: [],
  },

  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== "MemberExpression") return;
        if (node.callee.property.type !== "Identifier") return;
        if (node.callee.property.name !== "input") return;
        if (node.arguments.length === 0) return;

        const arg = node.arguments[0];
        if (arg.type === "SpreadElement") return;

        const { rootIsZObject, outermostMode } = analyzeChain(arg);
        if (rootIsZObject && outermostMode !== "strict") {
          context.report({ node: arg, messageId: "needsStrict" });
        }
      },
    };
  },
};
