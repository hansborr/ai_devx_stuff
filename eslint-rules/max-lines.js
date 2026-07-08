// @ts-check

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
 * Returns the lines occupied by a comment when no code token shares the same
 * line. Inline comments should not make the code line disappear.
 *
 * @param {import('eslint').SourceCode} sourceCode
 * @param {import('estree').Comment} comment
 */
function commentOnlyLines(sourceCode, comment) {
  let start = comment.loc.start.line;
  let end = comment.loc.end.line;

  let token = /** @type {import('estree').BaseNode | null} */ (comment);
  do {
    token = /** @type {import('estree').BaseNode | null} */ (
      sourceCode.getTokenBefore(token, { includeComments: true })
    );
  } while (isCommentToken(token));

  if (token && isSameLine(token, comment)) start += 1;

  token = /** @type {import('estree').BaseNode | null} */ (comment);
  do {
    token = /** @type {import('estree').BaseNode | null} */ (
      sourceCode.getTokenAfter(token, { includeComments: true })
    );
  } while (isCommentToken(token));

  if (token && isSameLine(comment, token)) end -= 1;

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
 * @param {import('eslint').SourceCode} sourceCode
 * @param {{ skipBlankLines: boolean; skipComments: boolean }} options
 */
function effectiveLines(sourceCode, options) {
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
