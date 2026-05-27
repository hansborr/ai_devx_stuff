// @ts-check

import jsdoc from "eslint-plugin-jsdoc";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import vitestPlugin from "@vitest/eslint-plugin";

import {
  eslintComments,
  eslintCommentsRules,
  noMagicNumbersRule,
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
        "no-magic-numbers": noMagicNumbersRule,

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

    // Phase A.2 existing findings stay ratcheted until drained; keep the
    // syntactic floor active everywhere else.
    {
      files: [
        "eslint-rules/strict-trpc-input.js",
        "eslint-rules/structured-logging.js",
        "eslint-rules/type-assertion-boundary.js",
      ],
      rules: {
        complexity: "off",
      },
    },

    {
      files: ["eslint-rules/type-assertion-boundary.js"],
      rules: {
        "no-magic-numbers": "off",
      },
    },

    {
      files: ["eslint-rules/no-barrel.js", "eslint-rules/structured-logging.js"],
      rules: {
        "regexp/no-unused-capturing-group": "off",
      },
    },

    {
      files: ["eslint-rules/no-llm-artifacts.js"],
      rules: {
        "regexp/no-useless-non-capturing-group": "off",
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

    // Phase B existing RuleTester harness findings stay ratcheted until drained;
    // keep the vitest floor active everywhere else.
    {
      files: ["eslint-rules/message-guidance.test.js"],
      rules: {
        "vitest/no-conditional-expect": "off",
      },
    },

    {
      files: ["eslint-rules/test-file-location.test.js"],
      rules: {
        "vitest/no-commented-out-tests": "off",
      },
    },
  ];
}
