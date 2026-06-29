// @ts-check
//
// Shared RuleTester factory for the eslint-rules suite.
//
// 17 of the 19 RuleTester instances re-declared a byte-identical
// `languageOptions` block (tseslint parser + ecmaVersion 2022 + module). That
// made a parser-baseline move (ecmaVersion bump, parser swap, a new default
// parserOption) a 17-file lockstep edit, with a missed file silently parsing
// under different assumptions. Centralizing the construction here makes that a
// one-line change and turns the two intentional deviations — the JSX variant
// (type-assertion-boundary) and the parser-less variant (max-lines) — into
// named, reviewable shapes instead of silent copies.
//
// This module is intentionally NOT a `*.test.js` file, so the eslint-rules
// vitest project (include: ["*.test.js"]) does not collect it as a suite.

import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";

const BASE_PARSER_OPTIONS = { ecmaVersion: 2022, sourceType: "module" };

/**
 * The canonical RuleTester for TypeScript-parsed rule tests.
 *
 * @param {Record<string, unknown>} [extraParserOptions] merged into the base
 *   parserOptions (e.g. `{ jsx: true }`).
 * @returns {RuleTester}
 */
export function makeRuleTester(extraParserOptions = {}) {
  return new RuleTester({
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ...BASE_PARSER_OPTIONS, ...extraParserOptions },
    },
  });
}

/**
 * RuleTester for rules that operate on raw source text and do not need the
 * TypeScript parser (e.g. max-lines, which counts effective lines). Kept as a
 * distinct factory so the parser-less shape stays an explicit, named escape
 * hatch rather than a missing `parser` key inside the common signature.
 *
 * @param {Record<string, unknown>} [extraParserOptions] merged into the base
 *   parserOptions.
 * @returns {RuleTester}
 */
export function makeParserlessRuleTester(extraParserOptions = {}) {
  return new RuleTester({
    languageOptions: {
      parserOptions: { ...BASE_PARSER_OPTIONS, ...extraParserOptions },
    },
  });
}

/** RuleTester with JSX enabled, for rules exercised against `.tsx` sources. */
export const jsxRuleTester = makeRuleTester({ jsx: true });
