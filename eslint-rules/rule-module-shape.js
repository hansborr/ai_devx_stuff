// @ts-check
//
// The one shape classifier that decides whether a module in this directory is
// an ESLint rule or a helper. Two consumers depend on it and they may not
// disagree: the plugin-registry generator
// (scripts/harness/generate-local-plugin.ts, through
// scripts/harness/local-rule-discovery.ts) and the AST-helper coverage suite.
//
// It lives in a module of its own, importing nothing, because the generator has
// to classify rule files BEFORE eslint-config/local-plugin.generated.js exists.
// Hosting it in a module that imports the generated registry — as the retired
// all-local-rules.js did — would make the generator depend on its own output.
//
// This module is intentionally NOT a `*.test.js` file so the eslint-rules
// vitest project (include: ["*.test.js"]) does not collect it as a suite, and
// it deliberately has no rule-shaped default export so it classifies itself as
// a helper.

/**
 * An ESLint rule module is the default export carrying both `meta` and
 * `create`. Helper modules have no such default export, so classifying by shape
 * keeps filesystem guards open to new helper homes without an allowlist.
 *
 * @param {unknown} mod
 * @returns {unknown | undefined}
 */
export function ruleFromModule(mod) {
  const candidate =
    mod && typeof mod === "object" && "default" in mod
      ? /** @type {{ default: unknown }} */ (mod).default
      : undefined;
  if (
    candidate &&
    typeof candidate === "object" &&
    "meta" in candidate &&
    typeof (/** @type {{ create?: unknown }} */ (candidate).create) === "function"
  ) {
    return candidate;
  }
  return undefined;
}
