import tseslint from "typescript-eslint";
import ratchetedRule from "%REPO_ROOT_FILE_URL%/eslint-rules/max-lines.js";

export default [
  { ignores: [] },
  {
    files: ["scripts/code-intel.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { local: { rules: { "max-lines": ratchetedRule } } },
    rules: { "local/max-lines": ["error",{"max":300,"skipBlankLines":true,"skipComments":true}] },
  },
];
