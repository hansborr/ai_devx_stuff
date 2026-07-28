// @ts-check

/**
 * Require router `.output(...)` schemas to come from shared schema modules.
 * This keeps response contracts visible to the client package instead of
 * letting server-only router files define private output shapes.
 */

import { createSharedSchemaImportCollector } from "./trpc-shared-schema-import-collector.js";

const PAIRED_GUIDE = "docs/guides/add-trpc-procedure.md";

/**
 * @param {import('estree').Node | import('estree').SpreadElement | undefined} node
 * @returns {string | undefined}
 */
function getDirectIdentifierName(node) {
  if (!node || node.type === "SpreadElement") return undefined;
  if (node.type === "Identifier") return node.name;
  return undefined;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Require tRPC router output schemas to be imported from shared schemas",
      principle:
        "Router output schemas are the client/server contract and must live in shared packages instead of server-only router files.",
      category: "architecture-fitness",
      pairedGuide: PAIRED_GUIDE,
      repairKind: "codemod",
      repairCommand: "bun run codemod:trpc-shared-output",
    },
    messages: {
      needsSharedOutput:
        "Why: ADR-0004 keeps router output schemas in shared because they are the client/server contract, not router-local detail. How to fix: Move this output shape to packages/shared/src/schemas/<domain>.ts (run: `bun run codemod:trpc-shared-output -- <file>`). Move complex or wrapped output shapes manually. " +
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
        if (node.callee.property.name !== "output") return;

        const directName = getDirectIdentifierName(node.arguments[0]);
        if (directName && sharedSchemaImports.has(directName)) return;

        context.report({
          node: node.arguments[0] ?? node,
          messageId: "needsSharedOutput",
        });
      },
    };
  },
};
