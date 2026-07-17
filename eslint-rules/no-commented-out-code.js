// @ts-check

import tseslint from "typescript-eslint";

const MIN_REGION_LINES = 2;
const DOCUMENTATION_REGION_LABEL_PATTERN = /^(?:Example|Protocol|Schema):$/iu;
const SIMPLE_STATEMENT_LABELS = new Map([
  ["VariableDeclaration", "variable"],
  ["FunctionDeclaration", "function"],
  ["ClassDeclaration", "class"],
  ["TSInterfaceDeclaration", "interface"],
  ["TSTypeAliasDeclaration", "type-alias"],
  ["TSEnumDeclaration", "enum"],
  ["TSModuleDeclaration", "module"],
  ["ImportDeclaration", "import"],
  ["ExportNamedDeclaration", "export"],
  ["ExportDefaultDeclaration", "export"],
  ["ExportAllDeclaration", "export"],
  ["IfStatement", "if"],
  ["ForStatement", "for"],
  ["ForInStatement", "for"],
  ["ForOfStatement", "for"],
  ["WhileStatement", "while"],
  ["DoWhileStatement", "while"],
  ["SwitchStatement", "switch"],
  ["TryStatement", "try"],
  ["ThrowStatement", "throw"],
]);

/**
 * @typedef {import("@typescript-eslint/types").TSESTree.Node} ParsedNode
 * @typedef {{ comments: import("eslint").AST.Token[], snippet: string }} CommentRegion
 */

/** @param {string} snippet @param {string} filename @returns {string | undefined} */
function codeShapedConstruct(snippet, filename) {
  try {
    const result = tseslint.parser.parseForESLint(snippet, {
      ecmaVersion: 2022,
      filePath: filename,
      jsx: true,
      sourceType: "module",
    });
    return firstOperative(result.ast.body);
  } catch {
    return undefined;
  }
}

/** @param {string} snippet */
function isDocumentationExample(snippet) {
  const firstContentLine = snippet
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return (
    firstContentLine !== undefined && DOCUMENTATION_REGION_LABEL_PATTERN.test(firstContentLine)
  );
}

/** @param {readonly ParsedNode[]} nodes @returns {string | undefined} */
function firstOperative(nodes) {
  for (const node of nodes) {
    const label = operativeStatementLabel(node);
    if (label !== undefined) return label;
  }
  return undefined;
}

/** @param {ParsedNode} node @returns {string | undefined} */
function operativeStatementLabel(node) {
  const simple = SIMPLE_STATEMENT_LABELS.get(node.type);
  if (simple !== undefined) return simple;
  if (node.type === "ReturnStatement") return node.argument === null ? undefined : "return";
  if (node.type === "LabeledStatement") return operativeStatementLabel(node.body);
  if (node.type === "BlockStatement") return firstOperative(node.body);
  if (node.type === "ExpressionStatement") return operativeExpressionLabel(node.expression);
  return undefined;
}

/** @param {ParsedNode} node @returns {string | undefined} */
function operativeExpressionLabel(node) {
  if (node.type === "CallExpression") return "call";
  if (node.type === "NewExpression") return "new";
  const sideEffectLabel = operativeSideEffectLabel(node);
  if (sideEffectLabel !== undefined) return sideEffectLabel;
  return operativeWrappedExpressionLabel(node);
}

/** @param {ParsedNode} node @returns {string | undefined} */
function operativeSideEffectLabel(node) {
  if (node.type === "AwaitExpression") return operativeOperandLabel("await", node.argument);
  if (node.type === "YieldExpression") {
    return node.argument === null ? undefined : operativeOperandLabel("yield", node.argument);
  }
  if (node.type === "UnaryExpression" && node.operator === "delete") {
    return operativeOperandLabel("delete", node.argument);
  }
  if (node.type === "UpdateExpression") return isMemberAccess(node.argument) ? "update" : undefined;
  if (node.type === "AssignmentExpression") {
    return isMemberAccess(node.left) ? "assignment" : undefined;
  }
  return undefined;
}

/** @param {ParsedNode} node @returns {string | undefined} */
function operativeWrappedExpressionLabel(node) {
  if (
    node.type === "ChainExpression" ||
    node.type === "TSAsExpression" ||
    node.type === "TSNonNullExpression" ||
    node.type === "TSTypeAssertion"
  ) {
    return operativeExpressionLabel(node.expression);
  }
  return undefined;
}

/** @param {string} label @param {ParsedNode} operand @returns {string | undefined} */
function operativeOperandLabel(label, operand) {
  return operand.type === "Identifier" ? undefined : label;
}

/** @param {ParsedNode} node */
function isMemberAccess(node) {
  if (node.type === "TSNonNullExpression") return isMemberAccess(node.expression);
  return node.type === "MemberExpression";
}

/**
 * @param {import("eslint").AST.Token} comment
 * @param {import("eslint").SourceCode} sourceCode
 */
function isPureComment(comment, sourceCode) {
  const line = sourceCode.lines[comment.loc.start.line - 1] ?? "";
  return line.slice(0, comment.loc.start.column).trim().length === 0;
}

/**
 * @param {readonly import("eslint").AST.Token[]} comments
 * @returns {CommentRegion | undefined}
 */
function lineCommentRegion(comments) {
  if (comments.length < MIN_REGION_LINES) return undefined;
  return { comments: [...comments], snippet: comments.map((comment) => comment.value).join("\n") };
}

/**
 * @param {import("eslint").AST.Token} comment
 * @param {import("eslint").SourceCode} sourceCode
 * @returns {CommentRegion | undefined}
 */
function blockCommentRegion(comment, sourceCode) {
  if (comment.loc.end.line === comment.loc.start.line) return undefined;
  if (sourceCode.getText(comment).startsWith("/**")) return undefined;
  const snippet = comment.value
    .split(/\r?\n/gu)
    .map((line) => line.replace(/^\s*\*\s?/u, ""))
    .join("\n");
  return { comments: [comment], snippet };
}

/** @param {import("eslint").SourceCode} sourceCode @returns {CommentRegion[]} */
function commentRegions(sourceCode) {
  const regions = [];
  let lineRun = [];
  const flushLineRun = () => {
    const region = lineCommentRegion(lineRun);
    if (region !== undefined) regions.push(region);
    lineRun = [];
  };

  for (const comment of sourceCode.getAllComments()) {
    if (comment.type === "Line" && isPureComment(comment, sourceCode)) {
      const previous = lineRun.at(-1);
      if (previous !== undefined && comment.loc.start.line !== previous.loc.end.line + 1) {
        flushLineRun();
      }
      lineRun.push(comment);
      continue;
    }
    flushLineRun();
    if (comment.type !== "Block" || !isPureComment(comment, sourceCode)) continue;
    const region = blockCommentRegion(comment, sourceCode);
    if (region !== undefined) regions.push(region);
  }
  flushLineRun();
  return regions;
}

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow multi-line comment regions that parse as operative code",
      principle:
        "Commented-out implementations obscure the active design and should be removed instead of preserved beside live code.",
      category: "maintainability",
      pairedGuide: "docs/guides/local-eslint-rules.md",
      repairKind: "manual",
    },
    messages: {
      commentedOutCode:
        "Delete this commented-out code; version control preserves history. Rewrite enduring intent as prose.",
    },
    schema: [],
  },

  create(context) {
    return {
      Program() {
        for (const region of commentRegions(context.sourceCode)) {
          if (isDocumentationExample(region.snippet)) continue;
          if (codeShapedConstruct(region.snippet, context.filename) === undefined) continue;
          const first = region.comments[0];
          const last = region.comments.at(-1);
          if (first === undefined || last === undefined) continue;
          context.report({
            loc: { start: first.loc.start, end: last.loc.end },
            messageId: "commentedOutCode",
          });
        }
      },
    };
  },
};
