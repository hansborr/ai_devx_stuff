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
      principle:
        "'any' removes type checking from the value it touches; add useful types when they help prevent errors, especially for key concepts, and keep intentional untyped boundaries line-scoped with a reason.",
      category: "maintainability",
      pairedGuide: "docs/guides/local-eslint-rules.md",
      repairKind: "manual",
    },
    messages: {
      noAny:
        "Why: `any` removes type checking from the value it touches. How to fix: Add a useful type when it helps prevent errors, especially for key concepts: use `unknown` plus narrowing for untrusted data, an existing shared type for domain values, or a small local type. Do not add noisy types just to satisfy lint. If `any` is the clearer boundary, suppress this exact line with `// eslint-disable-next-line local/no-explicit-any -- <why this boundary is intentionally untyped>`.",
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
