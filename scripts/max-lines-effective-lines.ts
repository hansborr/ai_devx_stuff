// Compute a file's EFFECTIVE line count through the SAME code path the ESLint
// `local/max-lines` rule uses, so the max-lines-exceptions validator's warning
// can never overstate or drift from what the rule will actually count.
//
// We run the file through ESLint's flat `Linter` with the repo TypeScript
// parser and a throwaway capture rule that calls the rule's exported
// `effectiveLines` helper on the real `SourceCode` the Linter built. A file that
// fails to parse yields `undefined` — ESLint's own run is the gate for that, so
// callers simply skip the warning rather than crashing the validator.

import { Linter, type Rule } from "eslint";
import tseslint from "typescript-eslint";

import { effectiveLines } from "../eslint-rules/max-lines.js";

export type EffectiveLineCounting = {
  readonly skipBlankLines: boolean;
  readonly skipComments: boolean;
};

const CAPTURE_PLUGIN = "max-lines-effective";
const CAPTURE_RULE = "capture";

const linter = new Linter();

function isJsxFile(filePath: string): boolean {
  return filePath.endsWith(".tsx") || filePath.endsWith(".jsx");
}

/**
 * The effective line count the ESLint rule would report for `text`, or
 * `undefined` when the file cannot be parsed (a syntax error ESLint itself will
 * surface). `filePath` selects TS-vs-JSX parsing; `counting` is
 * `maxLinesPolicy.counting`.
 */
export function computeEffectiveLineCount(
  filePath: string,
  text: string,
  counting: EffectiveLineCounting,
): number | undefined {
  let captured: number | undefined;

  const captureRule: Rule.RuleModule = {
    meta: { type: "problem", schema: [] },
    create(context) {
      return {
        "Program:exit"() {
          captured = effectiveLines(context.sourceCode, counting).length;
        },
      };
    },
  };

  // No filename is passed to `verify`: a filename makes ESLint match the config's
  // `files`/`ignores` globs against the cwd, and an absolute source path outside
  // the cwd resolves to "No matching configuration found" and no lint pass. JSX
  // is instead selected explicitly from the extension, and the rule needs no
  // type information, so the parser needs neither a filename nor a project.
  linter.verify(text, {
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: isJsxFile(filePath) } },
    },
    plugins: { [CAPTURE_PLUGIN]: { rules: { [CAPTURE_RULE]: captureRule } } },
    rules: { [`${CAPTURE_PLUGIN}/${CAPTURE_RULE}`]: "error" },
  });

  return captured;
}
