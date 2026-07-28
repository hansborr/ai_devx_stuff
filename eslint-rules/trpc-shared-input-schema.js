// @ts-check

/**
 * Require router `.input(...)` schemas to come from shared schema modules.
 * This keeps the client/server wire contract in `packages/shared` instead of
 * letting server-only router files define private input shapes.
 */

import { createSharedSchemaImportCollector } from "./trpc-shared-schema-import-collector.js";

const ALLOWED_WRAPPERS = new Set(["describe", "optional"]);
const PAIRED_GUIDE = "docs/guides/add-trpc-procedure.md";

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
      principle:
        "Router input schemas are the client/server contract and must live in shared packages instead of server-only router files.",
      category: "architecture-fitness",
      pairedGuide: PAIRED_GUIDE,
      repairKind: "codemod",
      repairCommand: "bun run codemod:trpc-shared-input",
    },
    messages: {
      needsSharedInput:
        "Why: ADR-0004 keeps router input schemas in shared because they are the client/server contract, not router-local detail. How to fix: Move this input shape to packages/shared/src/schemas/<domain>-inputs.ts (run: `bun run codemod:trpc-shared-input -- <file>`). Move complex .extend/.merge/.and/.or shapes manually. " +
        `See ${PAIRED_GUIDE}.`,
    },
    schema: [],
  },

  create(context) {
    const { sharedSchemaImports, ImportDeclaration } = createSharedSchemaImportCollector();

    return {
      ImportDeclaration,

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
