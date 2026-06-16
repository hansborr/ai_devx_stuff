// @ts-check

/**
 * Shared import-collector for the twin trpc-shared-{input,output}-schema rules.
 *
 * Both rules need the same thing: track which local identifiers were imported
 * from a `@musi/shared/schemas/*` module, so a `.input(...)`/`.output(...)`
 * argument that references one of them is treated as the shared wire contract.
 * The matched property name (`input` vs `output`), messageId, and the input
 * rule's `.optional()/.describe()` unwrap stay per-rule; only this collector is
 * shared so a prefix change can't silently apply to one twin only.
 */

export const SHARED_SCHEMA_PREFIX = "@musi/shared/schemas/";

/** @param {string} source */
export function isSharedSchemaSource(source) {
  return source.startsWith(SHARED_SCHEMA_PREFIX);
}

/**
 * Build a collector that records the local names of identifiers imported from
 * shared schema modules. Wire the returned `ImportDeclaration` handler into the
 * rule's visitor object and read `sharedSchemaImports` from the `CallExpression`
 * matcher.
 *
 * @returns {{
 *   sharedSchemaImports: Set<string>,
 *   ImportDeclaration: (node: import('estree').ImportDeclaration) => void,
 * }}
 */
export function createSharedSchemaImportCollector() {
  /** @type {Set<string>} */
  const sharedSchemaImports = new Set();

  return {
    sharedSchemaImports,
    /** @param {import('estree').ImportDeclaration} node */
    ImportDeclaration(node) {
      if (typeof node.source.value !== "string") return;
      if (!isSharedSchemaSource(node.source.value)) return;

      for (const specifier of node.specifiers) {
        if (specifier.type === "ImportSpecifier") {
          sharedSchemaImports.add(specifier.local.name);
        }
      }
    },
  };
}
