// @ts-check

/**
 * Requires a parseable boundary reason for TypeScript type assertions outside
 * sanctioned test mock files. `as const` remains always allowed.
 */

const ALLOWED_CATEGORIES = new Set(["framework", "json", "prisma", "test", "interop"]);
const LINE_OFFSET_WITH_BLANK = 2;
// Allows JSDoc block shapes: single-line `/** ... */` (leading space) and
// multi-line `/**\n * ... */` (leading `*\n *`). Line comments are filtered
// separately by LINE_BOUNDARY_COMMENT_PATTERN below so a stray `*` prefix on
// a `//` comment still fails.
const BOUNDARY_COMMENT_PREFIX_PATTERN = String.raw`^[\s*]*type-assertion-boundary:`;
const LINE_BOUNDARY_COMMENT_PATTERN = /^\s*type-assertion-boundary:/u;
const ALLOWED_CATEGORY_ALTERNATION = [...ALLOWED_CATEGORIES].sort().join("|");
const BOUNDARY_COMMENT_PATTERN = new RegExp(BOUNDARY_COMMENT_PREFIX_PATTERN, "u");
const BOUNDARY_REASON_PATTERN = new RegExp(
  `${BOUNDARY_COMMENT_PREFIX_PATTERN}\\s*(?:${ALLOWED_CATEGORY_ALTERNATION})\\s*-\\s*\\S+`,
  "u",
);
const CATEGORY_PATTERN = new RegExp(`${BOUNDARY_COMMENT_PREFIX_PATTERN}\\s*([^\\s-]+)`, "u");
const TEST_FILENAME_PATTERN = /^.*\.(?:test|spec)\.[jt]sx?$/u;
const TEST_HELPER_FILENAME_PATTERN = /^.*\.test-helper\.[jt]sx?$/u;

/** @param {string} filename */
function basename(filename) {
  return filename.split(/[\\/]/u).at(-1) ?? filename;
}

/** @param {string} filename */
function isTestFile(filename) {
  const file = basename(filename);
  return TEST_FILENAME_PATTERN.test(file) || TEST_HELPER_FILENAME_PATTERN.test(file);
}

/** @param {import('estree').Node} node */
function isConstAssertion(node) {
  return (
    node.type === "TSAsExpression" &&
    node.typeAnnotation.type === "TSTypeReference" &&
    node.typeAnnotation.typeName.type === "Identifier" &&
    node.typeAnnotation.typeName.name === "const"
  );
}

/** @param {import('estree').Node} node */
function findContainingStatement(node) {
  let current = node;
  while (
    current.parent &&
    current.parent.type !== "Program" &&
    current.parent.type !== "BlockStatement" &&
    current.parent.type !== "StaticBlock" &&
    current.parent.type !== "SwitchCase" &&
    current.parent.type !== "TSModuleBlock" &&
    current.parent.type !== "ClassBody"
  ) {
    current = current.parent;
  }
  return current;
}

/**
 * @param {import('eslint').AST.Token} comment
 * @returns {"valid" | "invalidCategory" | "emptyReason" | "skip"}
 */
function classifyBoundaryComment(comment) {
  const text = comment.value;
  if (!BOUNDARY_COMMENT_PATTERN.test(text)) return "skip";
  if (comment.type !== "Block" && !LINE_BOUNDARY_COMMENT_PATTERN.test(text)) return "skip";
  if (BOUNDARY_REASON_PATTERN.test(text)) return "valid";
  const category = text.match(CATEGORY_PATTERN)?.[1];
  if (!category || !ALLOWED_CATEGORIES.has(category)) return "invalidCategory";
  return "emptyReason";
}

/**
 * @param {import('eslint').AST.Token[]} comments
 * @returns {"valid" | "missingBoundary" | "invalidCategory" | "emptyReason"}
 */
function boundaryCommentStatus(comments) {
  let hasInvalidCategory = false;
  let hasEmptyReason = false;

  for (const comment of comments) {
    const status = classifyBoundaryComment(comment);
    if (status === "valid") return "valid";
    if (status === "invalidCategory") hasInvalidCategory = true;
    else if (status === "emptyReason") hasEmptyReason = true;
  }

  if (hasInvalidCategory) return "invalidCategory";
  if (hasEmptyReason) return "emptyReason";
  return "missingBoundary";
}

/** @param {import('estree').Node} node */
function findAncestorJSXExpressionContainer(node) {
  let current = node.parent;
  while (current) {
    if (current.type === "JSXExpressionContainer") return current;
    if (current.type === "Program" || current.type === "BlockStatement") return null;
    current = current.parent;
  }
  return null;
}

/**
 * @param {import('eslint').AST.Token | null} left
 * @param {import('eslint').AST.Token} right
 */
function isSameToken(left, right) {
  return (
    left !== null &&
    left.loc.start.line === right.loc.start.line &&
    left.loc.start.column === right.loc.start.column &&
    left.loc.end.line === right.loc.end.line &&
    left.loc.end.column === right.loc.end.column
  );
}

/**
 * Collects the comment block directly above a statement. A multi-line JSDoc
 * block is a single token and already matches as one comment. A run of `//` Line
 * comments is several tokens, so a marker on the first line of a two-line `//`
 * block would otherwise end two lines above the statement and be dropped. This
 * walks the contiguous run of Line comments immediately above the statement and
 * returns it as one logical block, so the marker is accepted on any line of the
 * run (mirroring how a JSDoc block tolerates the marker on any of its lines).
 *
 * @param {import('estree').Node} statement
 * @param {import('eslint').SourceCode} sourceCode
 * @returns {import('eslint').AST.Token[]}
 */
function leadingBoundaryCommentBlock(statement, sourceCode) {
  const leadingComments = sourceCode.getCommentsBefore(statement);
  const lineAboveStatement = statement.loc.start.line - 1;
  const lineWithBlankBetween = statement.loc.start.line - LINE_OFFSET_WITH_BLANK;
  const hasBlankLineAboveStatement = sourceCode.lines[lineAboveStatement - 1]?.trim() === "";

  const anchorIndex = leadingComments.findLastIndex(
    (comment) =>
      comment.loc.end.line === lineAboveStatement ||
      (comment.loc.end.line === lineWithBlankBetween && hasBlankLineAboveStatement),
  );
  if (anchorIndex === -1) return [];

  const block = [leadingComments[anchorIndex]];
  for (let index = anchorIndex - 1; index >= 0; index -= 1) {
    const previous = leadingComments[index];
    const current = block[0];
    if (previous.type !== "Line" || current.type !== "Line") break;
    if (previous.loc.end.line !== current.loc.start.line - 1) break;
    block.unshift(previous);
  }
  return block;
}

/**
 * @param {import('estree').Node} node
 * @param {import('eslint').SourceCode} sourceCode
 * @param {import('eslint').AST.Token[]} allComments
 */
function nearbyBoundaryComments(node, sourceCode, allComments) {
  const jsxContainer = findAncestorJSXExpressionContainer(node);
  const immediateTrailingNodeToken = sourceCode.getTokenAfter(node, { includeComments: true });
  const sameLineComments = allComments.filter(
    (comment) =>
      (comment.loc.start.line === node.loc.end.line &&
        comment.loc.start.column >= node.loc.end.column &&
        (jsxContainer === null || isSameToken(immediateTrailingNodeToken, comment))) ||
      (comment.loc.end.line === node.loc.start.line &&
        comment.loc.end.column <= node.loc.start.column),
  );

  const statement = findContainingStatement(node);
  const statementLeadingComments = leadingBoundaryCommentBlock(statement, sourceCode);

  const jsxTrailingComments = [];
  if (jsxContainer) {
    const token = sourceCode.getTokenAfter(jsxContainer, { includeComments: true });
    if (
      token !== null &&
      (token.type === "Block" || token.type === "Line") &&
      token.loc.start.line === jsxContainer.loc.end.line &&
      token.loc.start.column >= jsxContainer.loc.end.column
    ) {
      jsxTrailingComments.push(token);
    }
  }

  return [...sameLineComments, ...statementLeadingComments, ...jsxTrailingComments];
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Require justified boundary comments for TypeScript type assertions",
      principle:
        "TypeScript type assertions hide type bugs by silently overriding the checker; they need explicit justified boundary comments.",
      category: "maintainability",
      pairedGuide: "docs/guides/local-eslint-rules.md",
      repairKind: "manual",
    },
    messages: {
      missingBoundary:
        "Why: `as Foo` casts hide type bugs by silently overriding the checker. How to fix: rewrite to a typed source (Zod parse, Prisma include, framework handler types), or add `// type-assertion-boundary: <category> - <reason>` for a real boundary. Place it on the same line after the cast, or in the comment block directly above the statement: one JSDoc block, or a contiguous run of `//` lines with no gap. The marker may sit on any line of that block. Categories: framework, json, prisma, test, interop.",
      invalidCategory:
        "Why: A `type-assertion-boundary` marker is in the comment block above (or beside) this cast but its category is not one of: framework, json, prisma, test, interop. How to fix: Update the marker to use an allowed category, or rewrite to avoid the cast.",
      emptyReason:
        "Why: A `type-assertion-boundary` marker is in the comment block above (or beside) this cast but no reason follows the `-`. How to fix: Add a specific reason explaining why this cast is the narrowest fix at this boundary.",
    },
    schema: [],
  },

  create(context) {
    const sourceCode = context.sourceCode;
    const filename = context.physicalFilename ?? context.filename;
    const allComments = sourceCode.getAllComments();

    /** @param {import('estree').Node} node */
    function checkAssertion(node) {
      if (isConstAssertion(node)) return;
      if (isTestFile(filename)) return;

      const status = boundaryCommentStatus(nearbyBoundaryComments(node, sourceCode, allComments));
      if (status === "valid") return;

      context.report({ node, messageId: status });
    }

    return {
      TSAsExpression: checkAssertion,
      TSTypeAssertion: checkAssertion,
    };
  },
};
