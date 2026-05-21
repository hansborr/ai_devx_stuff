import tseslint from "typescript-eslint";
import ratchetedRule from "%REPO_ROOT_FILE_URL%/eslint-rules/max-lines.js";

export default [
  { ignores: ["**/*.config.{js,mjs,ts}","**/*.spec.ts","**/*.test.{ts,tsx}","**/dist/**","**/generated/**","**/node_modules/**","packages/client/src/components/campaign/encounters/add-participant-dialog.tsx","packages/client/src/components/campaign/encounters/encounter-detail-view.tsx","packages/client/src/components/campaign/notes/notes-panel.tsx","packages/client/src/components/campaign/npcs/monster-tab.tsx","packages/client/src/components/campaign/npcs/npc-panel.tsx","packages/client/src/components/homebrew/entries/entry-dialog.tsx","packages/client/src/components/homebrew/magic-item/magic-item-form-fields.tsx","packages/client/src/components/homebrew/monster/monster-form-data.ts","packages/client/src/components/homebrew/monster/monster-form-fields.tsx","packages/client/src/components/vtt/drawer/tabs/stats-tab-rolls.tsx","packages/client/src/pages/settings-page.tsx","packages/client/src/stores/map-canvas-store.ts","packages/client/src/test/fixtures-encounter.ts","packages/client/src/test/fixtures-srd.ts","packages/client/src/test/mock-trpc.tsx","packages/server/src/routers/encounter.ts","packages/server/src/routers/homebrew.ts","packages/server/src/routers/srd.ts","packages/server/src/services/rest-service.ts","packages/shared/src/rules/attack-damage.ts"] },
  {
    files: ["e2e/**/*.{js,cjs,mjs,ts,tsx,mts,cts}","packages/**/*.{js,cjs,mjs,ts,tsx,mts,cts}","scripts/code-intel/**/*.ts","scripts/drift/**/*.ts","scripts/generate-lint-guidance.ts"],
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
