// @ts-check

/**
 * Reports TypeScript `any` usage with Musi-specific repair guidance.
 *
 * The upstream @typescript-eslint/no-explicit-any rule is still the policy
 * source, but its message is too terse for agent workflows. This local rule
 * keeps the same low-noise AST target and tells the next editor how to make
 * the judgment call.
 */

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "suggestion",
    docs: {
      description: "Disallow explicit any with repair guidance",
    },
    messages: {
      noAny:
        "Avoid `any` by default. Prefer `unknown` plus narrowing, an existing shared type, or a small local type for key concepts. If adding a type would be clutter rather than clarity, keep the `any` and suppress this exact line with `// eslint-disable-next-line local/no-explicit-any -- <why this boundary is intentionally untyped>`.",
    },
    schema: [],
  },

  create(context) {
    return {
      TSAnyKeyword(node) {
        context.report({ node, messageId: "noAny" });
      },
    };
  },
};
