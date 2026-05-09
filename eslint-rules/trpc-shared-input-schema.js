// @ts-check

/**
 * Require router `.input(...)` schemas to come from shared schema modules.
 * This keeps the client/server wire contract in `packages/shared` instead of
 * letting server-only router files define private input shapes.
 */

const SHARED_SCHEMA_PREFIX = "@musi/shared/schemas/";
const ALLOWED_WRAPPERS = new Set(["describe", "optional"]);

/** @param {string} source */
function isSharedSchemaSource(source) {
  return source.startsWith(SHARED_SCHEMA_PREFIX);
}

/**
 * Unwrap harmless Zod metadata/presence wrappers such as:
 *   someInputSchema.optional()
 *   someInputSchema.describe("x").optional()
 * Structural combinators like `.extend(...)`, `.merge(...)`, `.and(...)`,
 * and `.or(...)` must be moved into the shared schema module instead.
 *
 * @param {import('estree').Node | import('estree').SpreadElement | undefined} node
 * @returns {string | undefined}
 */
function getSharedInputRootName(node) {
  if (!node || node.type === "SpreadElement") return undefined;
  if (node.type === "Identifier") return node.name;
  if (node.type === "ChainExpression") return getSharedInputRootName(node.expression);
  if (node.type === "CallExpression" && node.callee.type === "MemberExpression") {
    if (node.callee.computed) return undefined;
    if (node.callee.property.type !== "Identifier") return undefined;
    if (!ALLOWED_WRAPPERS.has(node.callee.property.name)) return undefined;
    return getSharedInputRootName(node.callee.object);
  }
  return undefined;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Require tRPC router input schemas to be imported from shared schemas",
    },
    messages: {
      needsSharedInput:
        "Move this input shape to packages/shared/src/schemas/<domain>-inputs.ts (run: `bun run codemod:trpc-shared-input -- <file>`). Complex .extend/.merge/.and/.or shapes must be moved manually.",
    },
    schema: [],
  },

  create(context) {
    /** @type {Set<string>} */
    const sharedSchemaImports = new Set();

    return {
      ImportDeclaration(node) {
        if (typeof node.source.value !== "string") return;
        if (!isSharedSchemaSource(node.source.value)) return;

        for (const specifier of node.specifiers) {
          if (specifier.type === "ImportSpecifier") {
            sharedSchemaImports.add(specifier.local.name);
          }
        }
      },

      CallExpression(node) {
        if (node.callee.type !== "MemberExpression") return;
        if (node.callee.property.type !== "Identifier") return;
        if (node.callee.property.name !== "input") return;

        const rootName = getSharedInputRootName(node.arguments[0]);
        if (rootName && sharedSchemaImports.has(rootName)) return;

        context.report({
          node: node.arguments[0] ?? node,
          messageId: "needsSharedInput",
        });
      },
    };
  },
};
