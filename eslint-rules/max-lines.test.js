// @ts-check
import { RuleTester } from "eslint";
import { describe, it } from "vitest";

import rule from "./max-lines.js";

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: { ecmaVersion: 2022, sourceType: "module" },
  },
});

describe("max-lines", () => {
  it("counts effective lines and reports repair guidance", () => {
    ruleTester.run("max-lines", rule, {
      valid: [
        {
          code: "const a = 1;\nconst b = 2;",
          options: [2],
        },
        {
          code: [
            "const a = 1;",
            "",
            "// comment-only line",
            "const b = 2; // inline comment still belongs to the code line",
          ].join("\n"),
          options: [{ max: 2, skipBlankLines: true, skipComments: true }],
        },
      ],
      invalid: [
        {
          code: "const a = 1;\nconst b = 2;\nconst c = 3;",
          options: [{ max: 2, skipBlankLines: true, skipComments: true }],
          errors: [{ messageId: "exceed", line: 3 }],
        },
        {
          code: ["const a = 1;", "", "const b = 2;", "// comment-only line", "const c = 3;"].join(
            "\n",
          ),
          options: [{ max: 2, skipBlankLines: true, skipComments: true }],
          errors: [
            {
              message:
                "Why: This file has 3 effective lines, above the 2 line limit, which makes future edits harder to localize. How to fix: Split the module into focused components, helpers, or types when that makes the code clearer. Do not compress lines or inline useful helpers just to satisfy the metric. If it should stay larger for now, do not use eslint-disable; add or adjust maxLinesPolicy.exceptions for this exact file with a modest max and a reason.",
            },
          ],
        },
      ],
    });
  });
});
