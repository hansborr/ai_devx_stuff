// @ts-check

import eslintComments from "@eslint-community/eslint-plugin-eslint-comments";
import regexp from "eslint-plugin-regexp";

export { eslintComments, regexp };

export const maxLinesRules = {
  "max-lines": "off",
  "local/max-lines": ["error", { max: 300, skipBlankLines: true, skipComments: true }],
  "max-lines-per-function": ["error", { max: 200, skipBlankLines: true, skipComments: true }],
};

export const noMagicNumbersRule = [
  "warn",
  {
    ignore: [0, 1, -1],
    ignoreArrayIndexes: true,
    ignoreDefaultValues: true,
    enforceConst: true,
  },
];

export const maintainabilityRules = {
  complexity: ["error", { max: 10 }],
  ...maxLinesRules,
  "max-params": ["error", { max: 4 }],
  "no-nested-ternary": "error",
  "no-magic-numbers": noMagicNumbersRule,
};

export const regexpRules = {
  ...regexp.configs["flat/recommended"].rules,
  "regexp/confusing-quantifier": "error",
  "regexp/no-empty-alternative": "error",
  "regexp/no-lazy-ends": "error",
  "regexp/no-potentially-useless-backreference": "error",
  "regexp/no-useless-flag": "error",
  "regexp/optimal-lookaround-quantifier": "error",
  "regexp/no-super-linear-backtracking": "error",
  "regexp/no-misleading-capturing-group": "error",
  "regexp/no-contradiction-with-assertion": "error",
  // Style-only per Leaf 21 backlog; not part of v3 flat/recommended but
  // override explicitly so future plugin upgrades do not surprise us.
  "regexp/prefer-named-capture-group": "off",
};

export const eslintCommentsRules = {
  "eslint-comments/require-description": ["error", { ignore: [] }],
  "eslint-comments/no-aggregating-enable": "error",
  "eslint-comments/no-duplicate-disable": "error",
  "eslint-comments/no-unlimited-disable": "error",
  "eslint-comments/no-unused-disable": "error",
};
