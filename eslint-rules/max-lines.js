// @ts-check
//
// Unlike its siblings, this module's `@ts-check` pragma is actually enforced:
// scripts/*.ts imports `effectiveLines` and the guidance constants, and
// tsconfig.scripts.json sets `allowJs`, so the pragma is honored there (a
// project-level `checkJs: false` does not override it). Keep it compiling —
// a type error here fails the scripts typecheck, not just an editor.

const DEFAULT_MAX_LINES = 300;

export const MAX_LINES_SPLIT_GUIDANCE =
  "Split the module into focused components, helpers, or types when that makes the code clearer";
export const MAX_LINES_METRIC_GUIDANCE =
  "Do not compress lines or inline useful helpers just to satisfy the metric.";

const MAX_LINES_REPAIR_GUIDANCE = `${MAX_LINES_SPLIT_GUIDANCE}. ${MAX_LINES_METRIC_GUIDANCE}`;

/** @param {number} start @param {number} end */
function lineRange(start, end) {
  return Array.from({ length: end - start }, (_value, index) => start + index);
}

/** @param {import('estree').BaseNode | null | undefined} token */
function isCommentToken(token) {
  return token?.type === "Block" || token?.type === "Line";
}

/**
 * @param {import('estree').BaseNode} left
 * @param {import('estree').BaseNode} right
 */
function isSameLine(left, right) {
  return left.loc?.end.line === right.loc?.start.line;
}

/**
 * The nearest token on `side` of `comment` that is not itself a comment, or
 * `null` at the start/end of the file. Walking with the null check in the loop
 * condition keeps every argument a real token, so no cast is needed.
 *
 * @param {import('eslint').SourceCode} sourceCode
 * @param {import('estree').Comment} comment
 * @param {"before" | "after"} side
 */
function adjacentCodeToken(sourceCode, comment, side) {
  const step = side === "before" ? sourceCode.getTokenBefore : sourceCode.getTokenAfter;
  const next = step.bind(sourceCode);
  let token = next(comment, { includeComments: true });
  while (token !== null && isCommentToken(token)) {
    token = next(token, { includeComments: true });
  }
  return token;
}

/**
 * Returns the lines occupied by a comment when no code token shares the same
 * line. Inline comments should not make the code line disappear.
 *
 * @param {import('eslint').SourceCode} sourceCode
 * @param {import('estree').Comment} comment
 */
function commentOnlyLines(sourceCode, comment) {
  // ESLint always populates `loc` on the comments it hands out; estree types it
  // optional. Treat a locless comment as occupying no lines rather than casting.
  const loc = comment.loc;
  if (!loc) return [];
  let start = loc.start.line;
  let end = loc.end.line;

  const before = adjacentCodeToken(sourceCode, comment, "before");
  if (before && isSameLine(before, comment)) start += 1;

  const after = adjacentCodeToken(sourceCode, comment, "after");
  if (after && isSameLine(comment, after)) end -= 1;

  return start <= end ? lineRange(start, end + 1) : [];
}

/** @param {unknown} option */
function readOptions(option) {
  if (typeof option === "number") {
    return { max: option, skipBlankLines: false, skipComments: false };
  }
  if (option && typeof option === "object") {
    const values =
      /** @type {{ max?: unknown; skipBlankLines?: unknown; skipComments?: unknown }} */ (option);
    return {
      max: typeof values.max === "number" ? values.max : DEFAULT_MAX_LINES,
      skipBlankLines: values.skipBlankLines === true,
      skipComments: values.skipComments === true,
    };
  }
  return { max: DEFAULT_MAX_LINES, skipBlankLines: false, skipComments: false };
}

/**
 * Count the lines the rule treats as "real" for a file: the raw source lines
 * minus the trailing newline's phantom line and, per the counting options, blank
 * and comment-only lines. Exported so the max-lines-exceptions validator can
 * report the same effective count the rule enforces — the count logic lives here
 * only, so the two can never drift.
 *
 * @param {import('eslint').SourceCode} sourceCode
 * @param {{ skipBlankLines: boolean; skipComments: boolean }} options
 */
export function effectiveLines(sourceCode, options) {
  let lines = sourceCode.lines.map((text, index) => ({
    lineNumber: index + 1,
    text,
  }));

  if (lines.length > 1 && lines.at(-1)?.text === "") {
    lines = lines.slice(0, -1);
  }

  if (options.skipBlankLines) {
    lines = lines.filter((line) => line.text.trim() !== "");
  }

  if (options.skipComments) {
    const commentLines = new Set(
      sourceCode.getAllComments().flatMap((comment) => commentOnlyLines(sourceCode, comment)),
    );
    lines = lines.filter((line) => !commentLines.has(line.lineNumber));
  }

  return lines;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "suggestion",
    docs: {
      description: "Enforce a maximum file length with Musi repair guidance",
      // @ts-expect-error -- every local rule carries harness metadata on meta.docs (read by scripts/harness/generate-harness-controls-validation.ts); ESLint's RulesMetaDocs lives in the transitive @eslint/core and does not declare these keys
      principle:
        "Files with excessive lines become harder to maintain and reason about; split into focused modules.",
      category: "maintainability",
      pairedGuide: "docs/guides/local-eslint-rules.md",
      repairKind: "manual",
    },
    messages: {
      exceed: `Why: This file has {{actual}} effective lines, above the {{max}} line limit, which makes future edits harder to localize. How to fix: ${MAX_LINES_REPAIR_GUIDANCE} If it should stay larger, do not eslint-disable; add this file's entry to eslint-config/max-lines-exceptions.baseline.json (cap, reason, lifecycle) and run \`bun run lint:max-lines-exceptions:update\`.`,
    },
    schema: [
      {
        oneOf: [
          {
            type: "integer",
            minimum: 0,
          },
          {
            type: "object",
            properties: {
              max: {
                type: "integer",
                minimum: 0,
              },
              skipComments: {
                type: "boolean",
              },
              skipBlankLines: {
                type: "boolean",
              },
            },
            additionalProperties: false,
          },
        ],
      },
    ],
  },

  create(context) {
    const options = readOptions(context.options[0]);
    const sourceCode = context.sourceCode;

    return {
      "Program:exit"() {
        const lines = effectiveLines(sourceCode, options);
        if (lines.length <= options.max) return;

        const overflowLine = lines[options.max]?.lineNumber ?? sourceCode.lines.length;
        context.report({
          loc: {
            start: { line: overflowLine, column: 0 },
            end: {
              line: sourceCode.lines.length,
              column: sourceCode.lines.at(-1)?.length ?? 0,
            },
          },
          messageId: "exceed",
          data: {
            actual: String(lines.length),
            max: String(options.max),
          },
        });
      },
    };
  },
};
