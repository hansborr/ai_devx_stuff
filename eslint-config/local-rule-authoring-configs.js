// @ts-check

import jsdoc from "eslint-plugin-jsdoc";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import vitestPlugin from "@vitest/eslint-plugin";

import {
  eslintComments,
  eslintCommentsRules,
  noMagicNumbersErrorRule,
  regexp,
  regexpRules,
} from "./rule-groups.js";

export function createLocalRuleAuthoringConfigs(localPlugin) {
  return [
    {
      files: ["eslint-rules/*.js"],
      ignores: ["eslint-rules/*.test.js"],
      plugins: {
        "eslint-comments": eslintComments,
        jsdoc,
        "simple-import-sort": simpleImportSort,
        regexp,
        local: localPlugin,
      },
      rules: {
        complexity: ["error", { max: 10 }],
        "local/max-lines": ["error", { max: 300, skipBlankLines: true, skipComments: true }],
        "max-lines-per-function": ["error", { max: 200, skipBlankLines: true, skipComments: true }],
        "max-params": ["error", { max: 4 }],
        "no-nested-ternary": "error",
        "no-magic-numbers": noMagicNumbersErrorRule,

        ...regexpRules,

        "simple-import-sort/imports": "error",
        "simple-import-sort/exports": "error",
        ...eslintCommentsRules,
        "jsdoc/check-alignment": "error",
        "jsdoc/check-param-names": "error",
        "jsdoc/check-tag-names": "error",
        "jsdoc/check-types": "error",
        "jsdoc/no-undefined-types": "error",
        "jsdoc/require-param-name": "error",
        "jsdoc/require-param-type": "error",
        "jsdoc/require-returns-check": "error",
        "jsdoc/valid-types": "error",
        "local/no-llm-artifacts": "error",
        "local/no-swallowed-errors": "error",
        "local/no-async-array-callbacks": "error",
      },
    },

    {
      files: ["eslint-rules/*.js"],
      ignores: ["eslint-rules/*.test.js"],
      rules: {
        "no-unused-vars": "error",
      },
    },

    {
      files: ["eslint-rules/*.test.js"],
      plugins: { vitest: vitestPlugin },
      rules: {
        ...vitestPlugin.configs.recommended.rules,
        "no-unused-vars": "error",
        "vitest/expect-expect": ["error", { assertFunctionNames: ["expect", "ruleTester.run"] }],
        "vitest/valid-expect": ["error", { maxArgs: 2 }],
      },
    },
  ];
}
