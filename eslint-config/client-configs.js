// @ts-check

import pluginQuery from "@tanstack/eslint-plugin-query";
import jsxA11y from "eslint-plugin-jsx-a11y";
import pluginReact from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

import {
  clientSourceFiles,
  clientTestAndHelperSourceFiles,
  sharedSchemasBarrelRestrictedImportPattern,
} from "./shared-policy.js";

export const clientFrameworkConfigs = [
  {
    ...jsxA11y.flatConfigs.recommended,
    files: ["packages/client/**/*.tsx"],
    settings: {
      "jsx-a11y": {
        components: {
          Button: "button",
          Input: "input",
          Label: "label",
          SelectTrigger: "button",
          TabsTrigger: "button",
          Textarea: "textarea",
        },
        linkComponents: [{ name: "Link", linkAttribute: "to" }],
      },
    },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      "jsx-a11y/anchor-is-valid": [
        "error",
        {
          components: ["Link"],
          specialLink: ["to"],
          aspects: ["noHref", "invalidHref", "preferButton"],
        },
      ],
    },
  },

  {
    files: ["packages/client/**/*.tsx"],
    plugins: { react: pluginReact },
    // Pin the React version instead of "detect": under ESLint 10,
    // eslint-plugin-react 7.37.5's "detect" path (version.js resolveBasedir)
    // calls the removed context.getFilename() and crashes every rule. Pinning
    // skips that path. Revisit when the plugin ships an ESLint ^10 peer — see
    // docs/agent_notes/backlog/eslint-react-peer-exception-removal.md.
    settings: { react: { version: "19.2" } },
    rules: {
      "react/jsx-key": "error",
      "react/jsx-no-constructed-context-values": "error",
      "react/no-unstable-nested-components": "error",
      "react/self-closing-comp": "error",
      "react/no-array-index-key": "error",
      "react/no-unused-prop-types": "error",
    },
  },

  {
    files: ["packages/client/**/*.{ts,tsx}"],
    plugins: { "@tanstack/query": pluginQuery },
    rules: {
      "@tanstack/query/exhaustive-deps": "error",
      "@tanstack/query/no-rest-destructuring": "warn",
      "@tanstack/query/stable-query-client": "error",
      "@tanstack/query/no-unstable-deps": "error",
      "@tanstack/query/infinite-query-property-order": "error",
      "@tanstack/query/no-void-query-fn": "error",
      "@tanstack/query/mutation-property-order": "error",
      "@tanstack/query/prefer-query-options": "error",
    },
  },
];

export const clientRuntimeBoundaryConfigs = [
  {
    ...reactHooks.configs.flat["recommended-latest"],
    files: ["packages/client/**/*.{ts,tsx}"],
    rules: {
      ...reactHooks.configs.flat["recommended-latest"].rules,
      // Owned by ratchet/react-hooks-set-state-in-effect-client (no-new floor
      // over the ~24 accepted findings). Kept off in normal lint to avoid
      // double-reporting; see docs/guides/lint-ratchet.md and the
      // lint-followups summary at
      // docs/agent_notes/finished_work/lint-followups-2026-06.md. The original
      // set-state-in-effect verdict register now lives only in git history.
      "react-hooks/set-state-in-effect": "off",
      "no-magic-numbers": "off",
      "@typescript-eslint/explicit-function-return-type": "off",
    },
  },

  {
    files: clientSourceFiles,
    ignores: clientTestAndHelperSourceFiles,
    rules: {
      // Owned by ratchet/local-no-arbitrary-tailwind-value-client until the
      // current arbitrary-value inventory drains to zero and promotes.
      "local/no-arbitrary-tailwind-value": "off",
    },
  },

  {
    files: clientSourceFiles,
    ignores: ["packages/client/src/hooks/socket-context.tsx", "**/*.test.{ts,tsx}"],
    rules: {
      // Keep the Socket.io client lifecycle centralized in SocketProvider.
      // Repeat the schemas-barrel restriction because flat-config rule entries
      // replace by key.
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            sharedSchemasBarrelRestrictedImportPattern,
            {
              group: ["socket.io-client"],
              message:
                "Use the app SocketProvider/useSocket hooks instead of constructing another Socket.io client.",
            },
          ],
        },
      ],
    },
  },

  {
    files: clientSourceFiles,
    ignores: clientTestAndHelperSourceFiles,
    rules: {
      "local/socket-listener-cleanup": "error",
    },
  },

  {
    files: ["packages/client/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}"],
    rules: {
      "no-console": "warn",
    },
  },
];
