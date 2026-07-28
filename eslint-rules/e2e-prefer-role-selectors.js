// @ts-check

/**
 * Prefer a11y-tree selectors in e2e tests. Raw `.locator(...)` calls make
 * tests depend on implementation structure instead of role/name/label text.
 *
 * This rule is intentionally syntax-based and must be scoped to `e2e/` from
 * ESLint flat config.
 */

import { staticPropertyName, unwrapChain } from "./ast-helpers.js";

/** @param {import('estree').CallExpression} node */
function isLocatorCall(node) {
  const callee = unwrapChain(node.callee);
  if (callee.type !== "MemberExpression") return false;

  return staticPropertyName(callee) === "locator";
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "suggestion",
    docs: {
      description: "Prefer role, label, or text selectors over raw locators in e2e tests",
      principle:
        "E2E tests should select by role/label/text instead of CSS to remain resilient to implementation changes.",
      category: "maintainability",
      pairedGuide: "docs/guides/add-e2e-test.md",
      repairKind: "manual",
    },
    messages: {
      preferRoleSelectors:
        "Prefer role/name selectors in e2e/. Use getByRole/getByLabel/getByText before falling back to CSS. See docs/guides/add-e2e-test.md for the recipe.",
    },
    schema: [],
  },

  create(context) {
    return {
      CallExpression(node) {
        if (!isLocatorCall(node)) return;

        context.report({ node: node.callee, messageId: "preferRoleSelectors" });
      },
    };
  },
};
