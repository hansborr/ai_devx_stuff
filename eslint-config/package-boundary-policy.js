// @ts-check

/**
 * @typedef {(
 *   | { readonly regex: string; readonly message: string }
 *   | {
 *       readonly group: readonly string[];
 *       readonly importNames?: readonly string[];
 *       readonly message: string;
 *     }
 * )} RestrictedImportPattern
 */

/** @type {Readonly<RestrictedImportPattern>} */
export const sharedSchemasBarrelRestrictedImportPattern = {
  regex: "^@musi/shared/schemas$",
  message:
    "Why: ADR-0005 keeps `@musi/shared` on subpath exports, so the removed schemas barrel stays removed and bundle graphs stay traceable. How to fix: Import from the specific schema source file, e.g. `@musi/shared/schemas/spell.js`. See docs/adr/0005-shared-subpath-exports.md.",
};

// Flat config replaces a rule's complete value when a later scoped entry sets
// the same key. Build every restricted-import site here so a local fence cannot
// erase the repository-wide schemas-barrel fence.
/**
 * @param {readonly RestrictedImportPattern[]} extraPatterns
 * @returns {readonly ["error", { readonly patterns: readonly RestrictedImportPattern[] }]}
 */
export const restrictedImportsRule = (extraPatterns) => [
  "error",
  { patterns: [sharedSchemasBarrelRestrictedImportPattern, ...extraPatterns] },
];
