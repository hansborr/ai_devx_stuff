// @ts-check

import {
  processEnvRestrictedSyntax,
  processExitRestrictedSyntax,
  serverTestAndHelperSourceFiles,
  sharedSchemasBarrelRestrictedImportPattern,
  sharedSourceFiles,
} from "./shared-policy.js";

const rawPrismaSqlRestrictedSyntax = {
  selector:
    "MemberExpression[property.name=/^\\$(queryRaw|queryRawUnsafe|executeRaw|executeRawUnsafe)$/]",
  message:
    "Raw Prisma SQL is restricted to sanctioned server boundaries. Move it to a reviewed service/helper and see docs/CONCURRENCY.md.",
};

const sharedSchemaZAnyRestrictedSyntax = {
  selector: "CallExpression[callee.object.name='z'][callee.property.name='any']",
  message:
    "Use z.unknown() for genuinely dynamic shared payloads instead of z.any(); see docs/guides/add-trpc-procedure.md.",
};

const permissiveTrpcOutputRestrictedSyntax = {
  selector:
    "CallExpression[callee.property.name='output'] > CallExpression.arguments:first-child[callee.object.name='z'][callee.property.name=/^(any|unknown|void)$/]",
  message:
    "Use a named shared output schema instead of z.any(), top-level z.unknown(), or z.void(); see docs/guides/add-trpc-procedure.md.",
};

export const packagePolicyConfigs = [
  {
    files: ["packages/server/src/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "local/socket-registry-broadcasts": "error",
    },
  },

  {
    files: ["packages/server/src/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "local/concurrency-guard": "error",
      "local/no-broadcast-in-transaction": "error",
      "local/no-outer-client-in-transaction": "error",
    },
  },

  {
    files: ["packages/server/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-console": "warn",
      "local/structured-logging": "error",
    },
  },

  {
    files: ["packages/server/src/utils/script-logger.ts"],
    rules: {
      "no-console": "off",
    },
  },

  {
    files: ["packages/server/src/routers/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "local/strict-trpc-input": "error",
      "local/trpc-require-output-schema": "error",
    },
  },

  {
    files: ["packages/server/src/routers/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "local/trpc-shared-input-schema": "error",
      "local/trpc-shared-output-schema": "error",
    },
  },

  {
    // The rule itself filters by name (only *InputSchema fires) so it's safe
    // to scope broadly. Output/result schemas (which back tRPC `.output(...)`
    // validation) need to stay permissive so Prisma's extra fields get
    // stripped at the boundary, not rejected.
    files: ["packages/shared/src/schemas/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "local/strict-shared-schemas": "error",
    },
  },

  {
    files: ["packages/shared/src/schemas/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      // Flat config replaces (not merges) rule entries by key. Keep process
      // primitive bans while adding shared-schema permissiveness guards.
      "no-restricted-syntax": [
        "error",
        processExitRestrictedSyntax,
        processEnvRestrictedSyntax,
        sharedSchemaZAnyRestrictedSyntax,
      ],
    },
  },

  {
    files: sharedSourceFiles,
    rules: {
      // Flat config replaces (not merges) rule entries by key, so the global
      // schemas-barrel restriction must be repeated here alongside shared-only
      // dependency restrictions.
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            sharedSchemasBarrelRestrictedImportPattern,
            {
              group: ["@musi/server", "@musi/server/*", "@musi/client", "@musi/client/*"],
              message:
                "packages/shared is the cross-package contract layer and must not depend on client or server modules.",
            },
            {
              group: [
                "react",
                "react-dom",
                "socket.io-client",
                "@tanstack/*",
                "@trpc/client",
                "@trpc/server",
              ],
              message:
                "packages/shared must stay runtime-neutral. Put browser/server adapters in packages/client or packages/server.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        {
          name: "window",
          message:
            "packages/shared must stay runtime-neutral; move browser code to packages/client.",
        },
        {
          name: "document",
          message:
            "packages/shared must stay runtime-neutral; move browser code to packages/client.",
        },
        {
          name: "localStorage",
          message:
            "packages/shared must stay runtime-neutral; move browser code to packages/client.",
        },
        {
          name: "sessionStorage",
          message:
            "packages/shared must stay runtime-neutral; move browser code to packages/client.",
        },
      ],
    },
  },

  {
    files: ["packages/client/src/**/*.{ts,tsx}", "packages/server/src/**/*.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "fetch",
          message:
            "Use a sanctioned API helper instead of raw fetch. Client API calls go through tRPC (packages/client/src/lib/trpc.ts). Add a file to the allowlist override if this is a sanctioned framework boundary or upload endpoint.",
        },
      ],
    },
  },

  {
    files: ["packages/client/src/lib/trpc.ts", "packages/client/src/hooks/use-map-image-upload.ts"],
    rules: {
      "no-restricted-globals": "off",
    },
  },
];

export const rawTxClientBoundaryConfigs = [
  {
    files: ["packages/server/src/**/*.ts"],
    ignores: [
      ...serverTestAndHelperSourceFiles,
      "packages/server/src/**/*test-helper*.ts",
      "packages/server/src/config/env.ts",
      "packages/server/src/main.ts",
      "packages/server/src/services/inventory-service.ts",
    ],
    rules: {
      // Flat config replaces (not merges) rule entries by key. Repeat the
      // process primitive selectors from script-configs.js so adding this
      // server-only raw-SQL fence does not drop the existing process bans.
      "no-restricted-syntax": [
        "error",
        processExitRestrictedSyntax,
        processEnvRestrictedSyntax,
        rawPrismaSqlRestrictedSyntax,
      ],
    },
  },

  {
    files: ["packages/server/src/routers/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      // The broader server raw-SQL fence also owns no-restricted-syntax. Repeat
      // its selectors here so router-only output guards do not weaken it.
      "no-restricted-syntax": [
        "error",
        processExitRestrictedSyntax,
        processEnvRestrictedSyntax,
        rawPrismaSqlRestrictedSyntax,
        permissiveTrpcOutputRestrictedSyntax,
      ],
    },
  },

  {
    files: ["packages/server/src/config/env.ts", "packages/server/src/main.ts"],
    rules: {
      "no-restricted-syntax": ["error", rawPrismaSqlRestrictedSyntax],
    },
  },

  // Forcing function: `RawTxClient` bypasses the restricted-delegate type
  // shim in prisma-types.ts and must only be imported by the mutation
  // helpers that act as the single trust boundary for each race-sensitive
  // table. Adding a new importer is a reviewable decision, not a
  // convenience. See docs/CONCURRENCY.md.
  {
    files: ["packages/server/src/**/*.ts"],
    ignores: [
      "packages/server/src/utils/prisma-types.ts",
      "packages/server/src/utils/*-mutations.ts",
    ],
    rules: {
      // Flat config replaces (not merges) rule entries by key, so the global
      // schemas-barrel restriction must be repeated here alongside the
      // server-only RawTxClient restriction.
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            sharedSchemasBarrelRestrictedImportPattern,
            {
              group: ["**/prisma-types.js"],
              importNames: ["RawTxClient"],
              message:
                "RawTxClient may only be imported by utils/*-mutations.ts files. Go through a locked helper (see docs/CONCURRENCY.md).",
            },
          ],
        },
      ],
    },
  },
];
