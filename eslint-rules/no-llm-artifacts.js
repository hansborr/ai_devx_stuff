// @ts-check

/**
 * Catch narrow LLM editing leftovers that should never land in committed code.
 * This intentionally avoids broad words such as "placeholder" so legitimate UI
 * props and test doubles do not become noisy.
 */

const EDIT_NOTE_PATTERNS = [
  /\.\.\.\s*(?:existing|previous)\s+code\s*\.\.\./iu,
  /\b(?:rest|remainder)\s+of\s+(?:the\s+)?(?:function|code|component|file)\s+(?:remains?\s+)?(?:the\s+)?same\b/iu,
  /\b(?:same\s+as\s+before|unchanged\s+from\s+before|continues?\s+unchanged|left\s+unchanged)\b/iu,
  /\b(?:implementation\s+goes\s+here|add\s+implementation\s+here|insert\s+implementation\s+here)\b/iu,
  /\b(?:abbreviated|omitted|truncated)\s+for\s+brevity\b/iu,
];

const TODO_PATTERN = /\bTODO\b/iu;
const TODO_REFERENCE_PATTERN =
  /(?:https?:\/\/|docs\/(?:roadmap|agent_notes)\/|(?:issue|pr)\s*#?\d+|#\d+|GH-\d+|[A-Z][A-Z0-9]+-\d+|\broadmap\b|\bagent\s+note\b)/iu;
const INCOMPLETE_ERROR_PATTERN = /^(?:not implemented|not yet implemented|todo|implement me)[.!]?$/iu;

/** @param {import('eslint').AST.Token} comment */
function normalizedCommentText(comment) {
  return comment.value.replaceAll(/\s+/gu, " ").trim();
}

/** @param {string} text */
function isLeftoverEditNote(text) {
  return EDIT_NOTE_PATTERNS.some((pattern) => pattern.test(text));
}

/** @param {string} text */
function todoNeedsReference(text) {
  return TODO_PATTERN.test(text) && !TODO_REFERENCE_PATTERN.test(text);
}

/** @param {import('estree').Literal | import('estree').TemplateLiteral} node */
function staticStringValue(node) {
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type !== "TemplateLiteral" || node.expressions.length > 0) return undefined;
  return node.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join("");
}

/** @param {import('estree').Node | null | undefined} node */
function incompleteErrorText(node) {
  if (!node || node.type !== "NewExpression") return undefined;
  if (node.callee.type !== "Identifier" || node.callee.name !== "Error") return undefined;
  const firstArg = node.arguments[0];
  if (!firstArg) return undefined;
  if (firstArg.type !== "Literal" && firstArg.type !== "TemplateLiteral") return undefined;
  return staticStringValue(firstArg);
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow leftover LLM editing artifacts and untracked TODO comments",
      principle: "LLM editing artifacts and untracked TODO comments should never land in committed code.",
      category: "maintainability",
      pairedGuide: "docs/guides/local-eslint-rules.md",
      repairKind: "manual",
    },
    messages: {
      leftoverEditNote:
        "Remove this leftover editing note. Restore the real code or delete the comment.",
      todoNeedsReference:
        "TODO comments need a tracking reference. Link an issue, PR, roadmap entry, or agent note, or resolve the TODO now.",
      incompleteImplementation:
        "Replace this incomplete implementation with real behavior, or remove the dead path.",
    },
    schema: [],
  },

  create(context) {
    const sourceCode = context.sourceCode;

    return {
      Program() {
        for (const comment of sourceCode.getAllComments()) {
          const text = normalizedCommentText(comment);
          if (isLeftoverEditNote(text)) {
            context.report({ loc: comment.loc, messageId: "leftoverEditNote" });
            continue;
          }
          if (todoNeedsReference(text)) {
            context.report({ loc: comment.loc, messageId: "todoNeedsReference" });
          }
        }
      },

      ThrowStatement(node) {
        const text = incompleteErrorText(node.argument);
        if (!text) return;
        if (!INCOMPLETE_ERROR_PATTERN.test(text.trim())) return;
        context.report({ node, messageId: "incompleteImplementation" });
      },
    };
  },
};
