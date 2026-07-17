// Demo-authored neutral local rule. Unlike the manifest-copied max-lines rule,
// this file belongs to the standalone example and uses no Musi paths or commands.

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "suggestion",
    docs: {
      description: "Disallow console.log while permitting other console levels",
      principle:
        "Routine console.log calls create noisy output; use an intentional console level or remove the diagnostic.",
      category: "maintainability",
      pairedGuide: "none",
      repairKind: "manual",
    },
    schema: [],
    messages: {
      useIntentionalLevel:
        "Why: console.log creates undifferentiated output. How to fix: Remove it or replace it with console.info, console.warn, or console.error.",
    },
  },
  create(context) {
    return {
      "CallExpression[callee.object.name='console'][callee.property.name='log']"(node) {
        context.report({ node, messageId: "useIntentionalLevel" });
      },
    };
  },
};
