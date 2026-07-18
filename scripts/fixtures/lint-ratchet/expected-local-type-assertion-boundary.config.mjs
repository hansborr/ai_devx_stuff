import tseslint from "typescript-eslint";
import ratchetedRule from "%REPO_ROOT_FILE_URL%/eslint-rules/type-assertion-boundary.js";

export default [
  { linterOptions: { noInlineConfig: true } },
  { ignores: ["**/dist/**","**/node_modules/**","scripts/codemods/fixtures/**","scripts/drift-ai/fixtures/**","scripts/fixtures/**","scripts/harness-audit/fixtures/**","scripts/logs-audit/fixtures/**","scripts/vitest.config.ts"] },
  {
    files: ["e2e/**/*.ts","packages/**/*.{ts,tsx}","scripts/**/*.ts","tools/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { local: { rules: { "type-assertion-boundary": ratchetedRule } } },
    rules: { "local/type-assertion-boundary": ["error"] },
  },
];
