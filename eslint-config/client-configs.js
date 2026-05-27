// @ts-check

import pluginQuery from "@tanstack/eslint-plugin-query";
import jsxA11y from "eslint-plugin-jsx-a11y";
import pluginReact from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

import { clientSourceFiles, sharedSchemasBarrelRestrictedImportPattern } from "./shared-policy.js";

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
    settings: { react: { version: "detect" } },
    rules: {
      "react/jsx-key": "error",
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
      "react-hooks/set-state-in-effect": "off",
      "no-magic-numbers": "off",
      "@typescript-eslint/explicit-function-return-type": "off",
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
    files: ["packages/client/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}"],
    rules: {
      "no-console": "warn",
    },
  },
];
