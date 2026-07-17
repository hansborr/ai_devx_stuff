// @ts-check
import { describe, it } from "vitest";

import { importSpecifierName, staticPropertyName, unwrapChain } from "./ast-helpers.js";
import { makeRuleTester } from "./rule-tester.js";

const ruleTester = makeRuleTester();

/** @type {import('eslint').Rule.RuleModule} */
const probeRule = {
  meta: {
    type: "problem",
    docs: {
      description: "Probe shared AST helpers in tests",
      principle: "Test-only probe rule.",
      category: "maintainability",
      pairedGuide: "none",
      repairKind: "manual",
    },
    messages: {
      computed: "computed property resolved",
      imported: "import specifier resolved",
      plain: "plain property resolved",
      unwrapped: "chain expression unwrapped",
    },
    schema: [],
  },

  create(context) {
    return {
      ImportSpecifier(node) {
        if (importSpecifierName(node) === "source-name") {
          context.report({ node, messageId: "imported" });
        }
      },

      MemberExpression(node) {
        const name = staticPropertyName(node);
        if (name === "plain") context.report({ node, messageId: "plain" });
        if (name === "computed") context.report({ node, messageId: "computed" });
      },

      ChainExpression(node) {
        if (unwrapChain(node) === node.expression) {
          context.report({ node, messageId: "unwrapped" });
        }
      },
    };
  },
};

describe("ast-helpers", () => {
  it("resolves static member names, import names, and chain expressions", () => {
    ruleTester.run("ast-helpers-probe", probeRule, {
      valid: ["object[dynamic]", "object[1]", "const value = object.other"],
      invalid: [
        {
          code: "object.plain()",
          errors: [{ messageId: "plain" }],
        },
        {
          code: 'object["computed"]()',
          errors: [{ messageId: "computed" }],
        },
        {
          code: 'import { "source-name" as localName } from "library";',
          errors: [{ messageId: "imported" }],
        },
        {
          code: "object?.method()",
          errors: [{ messageId: "unwrapped" }],
        },
      ],
    });
  });
});
