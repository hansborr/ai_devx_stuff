// @ts-check

const INDEX_FILE_RE = /(^|[/\\])index\.tsx?$/;

/**
 * @param {string} filename
 */
function isIndexFile(filename) {
  return INDEX_FILE_RE.test(filename);
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow index.ts barrel re-exports",
    },
    messages: {
      noBarrel:
        "Barrel file detected. Run: bun run codemod:expand-barrel -- --barrel {{path}}.",
    },
    schema: [],
  },

  create(context) {
    if (!isIndexFile(context.filename)) {
      return {};
    }

    const data = { path: context.filename };
    const importedNames = new Set();
    const localExportNodes = [];

    return {
      ImportDeclaration(node) {
        for (const specifier of node.specifiers) {
          importedNames.add(specifier.local.name);
        }
      },

      ExportAllDeclaration(node) {
        context.report({ node, messageId: "noBarrel", data });
      },

      ExportNamedDeclaration(node) {
        if (node.source) {
          context.report({ node, messageId: "noBarrel", data });
          return;
        }

        localExportNodes.push(node);
      },

      "Program:exit"() {
        for (const node of localExportNodes) {
          const exportsImportedBinding = node.specifiers.some((specifier) =>
            importedNames.has(specifier.local.name),
          );
          if (exportsImportedBinding) context.report({ node, messageId: "noBarrel", data });
        }
      },
    };
  },
};
