// @ts-check

import json from "@eslint/json";
import tseslint from "typescript-eslint";

import { noMagicNumbersRule } from "./rule-groups.js";
import { tsConfigFiles } from "./shared-policy.js";

export const jsonFileConfigs = [
  {
    files: ["**/*.json"],
    ignores: ["**/tsconfig*.json", "**/.vscode/*.json"],
    plugins: { json },
    language: "json/json",
    rules: {
      "json/no-duplicate-keys": "error",
      "json/no-empty-keys": "error",
      "json/no-unnormalized-keys": "error",
      "json/no-unsafe-values": "error",
    },
  },

  {
    files: ["**/*.jsonc", "**/tsconfig*.json", "**/.vscode/*.json"],
    plugins: { json },
    language: "json/jsonc",
    languageOptions: { allowTrailingCommas: true },
    rules: {
      "json/no-duplicate-keys": "error",
      "json/no-empty-keys": "error",
      "json/no-unnormalized-keys": "error",
      "json/no-unsafe-values": "error",
    },
  },
];

export function createTsConfigFileConfigs(repoRoot) {
  return [
    // Maintained root/package TS configs are re-included from the global config
    // ignore. Project service uses this dedicated project as its default because
    // these files intentionally live outside package production tsconfig includes.
    {
      files: tsConfigFiles,
      plugins: { "@typescript-eslint": tseslint.plugin },
      languageOptions: {
        parserOptions: {
          projectService: {
            allowDefaultProject: tsConfigFiles,
            defaultProject: "./tsconfig.configs.json",
            maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: tsConfigFiles.length,
          },
          tsconfigRootDir: repoRoot,
        },
      },
      rules: {
        "local/max-lines": "off",
        "no-magic-numbers": noMagicNumbersRule,
        "@typescript-eslint/explicit-function-return-type": [
          "error",
          {
            allowExpressions: true,
            allowTypedFunctionExpressions: true,
            allowHigherOrderFunctions: true,
          },
        ],
      },
    },
  ];
}
