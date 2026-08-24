// @ts-check

import { builtinModules } from "node:module";

import { restrictedImportsRule } from "./package-boundary-policy.js";
import {
  serverSourceFiles,
  serverTestAndHelperSourceFiles,
  sharedSourceFiles,
  sharedTestAndHelperSourceFiles,
} from "./path-glob-policy.js";
import { serverScriptTypeScriptFiles } from "./script-test-policy.js";

// One string for the four browser globals shared code may not touch, so the
// decision id and repair stay in sync across every entry.
const sharedRuntimeNeutralGlobalMessage =
  "Why: ADR-0006 keeps packages/shared runtime-neutral, so browser globals are unavailable to the contract layer. How to fix: Move browser code to packages/client and pass the resolved value into shared code. See docs/adr/0006-shared-package-layering.md.";

const sharedDependencyRestrictedImportPatterns = [
  {
    group: ["@musi/server", "@musi/server/*", "@musi/client", "@musi/client/*"],
    message:
      "Why: ADR-0006 makes packages/shared the cross-package contract layer, so depending on client or server modules inverts the shared -> server -> client flow. How to fix: Move the dependent code into packages/client or packages/server. See docs/adr/0006-shared-package-layering.md.",
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
      "Why: ADR-0006 keeps packages/shared runtime-neutral, so a browser or server adapter imported there reaches every consumer. How to fix: Put the adapter in packages/client or packages/server and pass what shared code needs as a parameter. See docs/adr/0006-shared-package-layering.md.",
  },
];

const sharedBrowserGlobalRestrictions = [
  "window",
  "document",
  "localStorage",
  "sessionStorage",
].map((name) => ({ name, message: sharedRuntimeNeutralGlobalMessage }));

const sharedNodeBuiltinRestrictedImportPattern = {
  group: ["node:*", ...builtinModules.filter((specifier) => !specifier.startsWith("node:"))],
  message:
    "Why: ADR-0006 keeps packages/shared portable across browser and server consumers, so Node builtins are unavailable to production shared code. How to fix: Move Node-specific work to packages/server and pass the resolved value into shared code. See docs/adr/0006-shared-package-layering.md.",
};

const uploadServiceRestBoundaryFile = "packages/server/src/services/upload-service.ts";

export const packagePolicyConfigs = [
  {
    files: [...serverSourceFiles, ...serverScriptTypeScriptFiles],
    ignores: serverTestAndHelperSourceFiles,
    rules: {
      "local/no-unbounded-promise-all": "error",
      "no-restricted-properties": [
        "error",
        {
          object: "Math",
          property: "random",
          message:
            "Use crypto.randomBytes or crypto.randomUUID for server-side randomness; Math.random is not suitable for tokens, invite codes, or other secrets.",
        },
      ],
    },
  },

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
    files: ["packages/server/src/routers/**/*.ts", "packages/server/src/services/**/*.ts"],
    ignores: [
      ...serverTestAndHelperSourceFiles,
      "packages/server/src/**/*-test-helper.{ts,tsx}",
      // Documented REST-boundary exception: routes/MODULE.md maps these
      // upload validation Errors to HTTP 400 outside tRPC.
      uploadServiceRestBoundaryFile,
    ],
    rules: {
      "local/no-plain-error-in-trpc": "error",
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
    files: sharedSourceFiles,
    rules: {
      "@typescript-eslint/no-restricted-imports": restrictedImportsRule(
        sharedDependencyRestrictedImportPatterns,
      ),
      "no-restricted-globals": ["error", ...sharedBrowserGlobalRestrictions],
    },
  },

  {
    files: sharedSourceFiles,
    ignores: sharedTestAndHelperSourceFiles,
    rules: {
      // Complete good-faith Node reachability fence for production shared TS:
      // static imports (including type-only) and re-exports are restricted
      // below; dynamic literal/template imports, `import(...)` types,
      // import-equals, and unshadowed require are handled by the local rule;
      // ambient identifiers (`process`, `Buffer`, `__dirname`, `__filename`,
      // and `NodeJS`) are scope-resolved by the local rule in every value/type
      // position while innocent local declarations and shadowing stay valid.
      // Runtime-computed module specifiers remain outside the accidental-misuse
      // threat model. The test/helper ignore deliberately retains Node access.
      "@typescript-eslint/no-restricted-imports": restrictedImportsRule([
        ...sharedDependencyRestrictedImportPatterns,
        sharedNodeBuiltinRestrictedImportPattern,
      ]),
      "no-restricted-globals": ["error", ...sharedBrowserGlobalRestrictions],
      "local/no-node-builtin-reference": "error",
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
      "@typescript-eslint/no-restricted-imports": restrictedImportsRule([
        {
          group: ["**/prisma-types.js"],
          importNames: ["RawTxClient"],
          message:
            "Why: ADR-0007 restricts RawTxClient because it bypasses gated delegate types. How to fix: Use a locked helper; see docs/guides/add-race-sensitive-mutation.md.",
        },
      ]),
    },
  },
];
