// @ts-check

import { describe, it } from "vitest";

import { makeRuleTester } from "./rule-tester.js";
import {
  createTransactionCallbackTracker,
  isTransactionCall,
} from "./transaction-callback-tracker.js";

const ruleTester = makeRuleTester();

/** @type {import('eslint').Rule.RuleModule} */
const trackerProbeRule = {
  meta: {
    schema: [],
    messages: {
      inside: "inside transaction as {{identity}}",
    },
  },
  create(context) {
    const tracker = createTransactionCallbackTracker(context.sourceCode, (parent, callback) => {
      if (callback === undefined) return parent?.state;
      const binding = callback.variable === undefined ? "unbound" : "bound";
      return `${callback.name ?? "anonymous"}:${binding}`;
    });

    return {
      ...tracker.functionVisitors,
      CallExpression(node) {
        if (isTransactionCall(node)) tracker.recordTransactionCall(node);
        if (node.callee.type !== "Identifier" || node.callee.name !== "inspect") return;
        if (!tracker.inTransaction()) return;
        context.report({
          node,
          messageId: "inside",
          data: { identity: tracker.currentFrame()?.state ?? "missing" },
        });
      },
    };
  },
};

describe("transaction-callback-tracker", () => {
  it("tracks callback identity and inherited function state", () => {
    ruleTester.run("transaction-callback-tracker", trackerProbeRule, {
      valid: [
        "inspect();",
        "function inspectLater() { inspect(); } inspectLater();",
        "await prisma.$transaction([writeOne, writeTwo]); inspect();",
      ],
      invalid: [
        {
          code: "await prisma.$transaction(async (tx) => { inspect(); });",
          errors: [{ messageId: "inside", data: { identity: "tx:bound" } }],
        },
        {
          code: "await prisma.$transaction(function (db) { inspect(); });",
          errors: [{ messageId: "inside", data: { identity: "db:bound" } }],
        },
        {
          code: [
            "await prisma.$transaction(async (tx) => {",
            "  function nested() { inspect(); }",
            "  nested();",
            "});",
          ].join("\n"),
          errors: [{ messageId: "inside", data: { identity: "tx:bound" } }],
        },
      ],
    });
  });
});
