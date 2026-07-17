// @ts-check
import { describe, it } from "vitest";

import { makeRuleTester } from "./rule-tester.js";
import rule from "./no-commented-out-code.js";

const ruleTester = makeRuleTester();

describe("no-commented-out-code", () => {
  it("reports only multi-line pure-comment regions that parse as operative code", () => {
    ruleTester.run("no-commented-out-code", rule, {
      valid: [
        "// const oldValue = 1;\nconst value = 2;",
        [
          "// This helper computes the running total.",
          "// It caches results for speed.",
          "// See the module docs for details.",
          "const value = 1;",
        ].join("\n"),
        [
          "/**",
          " * @example",
          " * const result = compute();",
          " * persist(result);",
          " */",
          "function compute() { return 1; }",
        ].join("\n"),
        [
          "// Schema:",
          "// z.object({",
          "//   name: z.string(),",
          "//   level: z.number().int(),",
          "// });",
          "const schemaDocumented = true;",
        ].join("\n"),
        [
          "// Example:",
          "// t.router({",
          "//   campaign: t.procedure.query(() => 'ready'),",
          "// });",
          "const routerDocumented = true;",
        ].join("\n"),
        [
          "// Protocol:",
          "// socket.emit('campaign:updated', {",
          "//   campaignId,",
          "//   revision: 2,",
          "// });",
          "const protocolDocumented = true;",
        ].join("\n"),
        ["// const config = {", "//   enabled: true,", "const config = { enabled: true };"].join(
          "\n",
        ),
        [
          "const first = 1; // const oldFirst = 0;",
          "const second = 2; // const oldSecond = 0;",
        ].join("\n"),
      ],
      invalid: [
        {
          code: "// const oldValue = compute();\n// persist(oldValue);\nconst value = 1;",
          errors: [{ messageId: "commentedOutCode", line: 1, endLine: 2 }],
        },
        {
          code: [
            "/*",
            " * const oldValue = compute();",
            " * persist(oldValue);",
            " */",
            "const value = 1;",
          ].join("\n"),
          errors: [{ messageId: "commentedOutCode", line: 1, endLine: 4 }],
        },
        {
          code: ["// if (ready) {", "//   run();", "// }", "const ready = true;"].join("\n"),
          errors: [{ messageId: "commentedOutCode", line: 1, endLine: 3 }],
        },
        {
          code: ["// retry:", "// while (!ready) poll();", "const ready = true;"].join("\n"),
          errors: [{ messageId: "commentedOutCode", line: 1, endLine: 2 }],
        },
        {
          filename: "packages/client/src/components/save-button.tsx",
          code: [
            "function SaveButton() {",
            "  // return (",
            "  //   <Button>Save</Button>",
            "  // );",
            "}",
          ].join("\n"),
          errors: [{ messageId: "commentedOutCode", line: 2, endLine: 4 }],
        },
      ],
    });
  });
});
