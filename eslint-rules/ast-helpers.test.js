// @ts-check
import { describe, it } from "vitest";

import {
  importSpecifierName,
  staticKeyName,
  staticPropertyName,
  unwrapChain,
} from "./ast-helpers.js";
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
      key: "static object key resolved",
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

      Property(node) {
        if (staticKeyName(node) === "target") context.report({ node, messageId: "key" });
      },
    };
  },
};

describe("ast-helpers", () => {
  it("resolves static member names, import names, and chain expressions", () => {
    ruleTester.run("ast-helpers-probe", probeRule, {
      valid: [
        "object[dynamic]",
        "object[1]",
        "const value = object.other",
        // A computed key is never a static name, even when it reads like one.
        "const held = { [target]: 1 };",
        "const held = { other: 1 };",
      ],
      invalid: [
        {
          code: "const held = { target: 1 };",
          errors: [{ messageId: "key" }],
        },
        {
          // A NON-computed object key may legitimately be a string literal, so
          // staticKeyName cannot simply mirror staticPropertyName's computed logic.
          code: 'const held = { "target": 1 };',
          errors: [{ messageId: "key" }],
        },
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
