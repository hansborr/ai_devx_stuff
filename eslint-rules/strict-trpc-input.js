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

const MODE_NAMES = new Set(["strict", "passthrough", "strip", "catchall"]);

/** @param {import('estree').Node} node */
function isZObjectCall(node) {
  return (
    node.type === "CallExpression" &&
    node.callee.type === "MemberExpression" &&
    node.callee.object.type === "Identifier" &&
    node.callee.object.name === "z" &&
    node.callee.property.type === "Identifier" &&
    node.callee.property.name === "object"
  );
}

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
    if (
      outermostMode === null &&
      cur.callee.property.type === "Identifier" &&
      MODE_NAMES.has(cur.callee.property.name)
    ) {
      outermostMode = cur.callee.property.name;
    }
    if (cur.callee.object.type !== "CallExpression") break;
    cur = cur.callee.object;
  }
  return { rootIsZObject: isZObjectCall(cur), outermostMode };
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "suggestion",
    docs: {
      description: "tRPC .input(z.object(...)) schemas must call .strict()",
      principle:
        "tRPC procedures with z.object input schemas must call .strict() so unknown keys are rejected at the API boundary, preventing silent typo bugs from clients.",
      category: "architecture-fitness",
      pairedGuide: "docs/guides/add-trpc-procedure.md",
      repairKind: "manual",
    },
    messages: {
      needsStrict:
        "Why: ADR-0004 requires strict tRPC inputs because a `z.object(...)` without `.strict()` silently drops unknown keys, hiding client-side typos at the API boundary. How to fix: Add `.strict()` so unknown keys are rejected. See docs/guides/add-trpc-procedure.md.",
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
