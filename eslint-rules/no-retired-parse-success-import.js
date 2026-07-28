// @ts-check

const RETIRED_NAME = "expectParseSuccess";

/** @param {string} source */
function isParseHelperModule(source) {
  return (
    source === "./parse-helpers.js" ||
    source === "@musi/shared/test/parse-helpers.js" ||
    /(?:^|\/)test\/parse-helpers\.js$/u.test(source)
  );
}

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Reject imports of the retired ambiguous Zod success assertion helper.",
      principle:
        "Positive schema fixtures should retain their static input contract, while wrapper-owned results should name the unknown-input boundary explicitly.",
      category: "behavior",
      pairedGuide: "none",
      repairKind: "manual",
    },
    schema: [],
    messages: {
      retired:
        "Why: expectParseSuccess hides whether a positive fixture is statically checked. How to fix: Use expectSchemaParseSuccess(schema, input) for direct schema fixtures or expectParseResultSuccess(result) for wrapper-owned results.",
    },
  },

  create(context) {
    return {
      ImportDeclaration(node) {
        if (typeof node.source.value !== "string" || !isParseHelperModule(node.source.value)) {
          return;
        }

        for (const specifier of node.specifiers) {
          if (
            specifier.type === "ImportSpecifier" &&
            specifier.imported.type === "Identifier" &&
            specifier.imported.name === RETIRED_NAME
          ) {
            context.report({ node: specifier, messageId: "retired" });
          }
        }
      },
      ExportNamedDeclaration(node) {
        if (
          node.source === null ||
          typeof node.source.value !== "string" ||
          !isParseHelperModule(node.source.value)
        ) {
          return;
        }

        for (const specifier of node.specifiers) {
          if (
            specifier.type === "ExportSpecifier" &&
            specifier.local.type === "Identifier" &&
            specifier.local.name === RETIRED_NAME
          ) {
            context.report({ node: specifier, messageId: "retired" });
          }
        }
      },
    };
  },
};
