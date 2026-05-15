// @ts-check

/**
 * Prefer a11y-tree selectors in e2e tests. Raw `.locator(...)` calls make
 * tests depend on implementation structure instead of role/name/label text.
 *
 * This rule is intentionally syntax-based and must be scoped to `e2e/` from
 * ESLint flat config.
 */

/** @param {import('estree').Node} node */
function unwrapChain(node) {
  return node.type === "ChainExpression" ? node.expression : node;
}

/** @param {import('estree').PrivateIdentifier | import('estree').Expression} property */
function staticPropertyName(property) {
  if (property.type === "Identifier") return property.name;
  if (property.type === "Literal" && typeof property.value === "string") return property.value;
  return undefined;
}

/** @param {import('estree').CallExpression} node */
function isLocatorCall(node) {
  const callee = unwrapChain(node.callee);
  if (callee.type !== "MemberExpression") return false;

  return staticPropertyName(callee.property) === "locator";
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "suggestion",
    docs: {
      description: "Prefer role, label, or text selectors over raw locators in e2e tests",
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
