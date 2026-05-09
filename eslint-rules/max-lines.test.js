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
          code: [
            "const a = 1;",
            "",
            "const b = 2;",
            "// comment-only line",
            "const c = 3;",
          ].join("\n"),
          options: [{ max: 2, skipBlankLines: true, skipComments: true }],
          errors: [
            {
              message:
                "File has 3 effective lines; limit is 2. Prefer splitting the module into focused components, helpers, or types so it stays under the default limit. If this file should stay larger for now, do not use eslint-disable. Add or adjust a targeted eslint.config.js override for this exact file with `local/max-lines` set to `warn`, choose a modest max just above the current count, and keep a comment above the block explaining why the larger file is acceptable.",
            },
          ],
        },
      ],
    });
  });
});
