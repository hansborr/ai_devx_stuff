// @ts-check

import {
  codeFiles,
  codemodSourceFiles,
  eslintConfigJsFiles,
  processEnvRestrictedSyntax,
  processExitRestrictedSyntax,
  serverScriptTypeScriptFiles,
  scriptProjectIgnores,
  scriptTypeScriptFiles,
  sharedSchemasBarrelRestrictedImportPattern,
  testAndHelperFiles,
  tsConfigFiles,
} from "./shared-policy.js";

export const driftDirectionLawConfigs = [
  // Direction law (drift-triage collapse, 2026-07-17 ruling 4): triage is the
  // downstream reducer over drift-ai's scan output, so drift-ai (the flat
  // entries scripts/drift-ai.ts and scripts/drift-ai.test.ts as well as
  // scripts/drift-ai/**) must never import the triage module — neither the
  // scripts/drift-triage/** internals nor the scripts/drift-triage.ts entry.
  // Enforced one-way only; the forward contract (types, check-metadata, scope,
  // prototype-advisory, scan-provenance) is documented in the triage module
  // doc and policed by review, not by a reverse allowlist.
  {
    files: ["scripts/drift-ai.ts", "scripts/drift-ai.test.ts", "scripts/drift-ai/**/*.ts"],
    rules: {
      // Flat config replaces (not merges) rule entries by key, so the global
      // schemas-barrel restriction must be repeated here alongside the
      // direction-law restriction.
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            sharedSchemasBarrelRestrictedImportPattern,
            {
              group: [
                // The triage directory (module internals), from any depth.
                "**/drift-triage/**",
                "../drift-triage/**",
                "./drift-triage/**",
                // The flat triage entry scripts/drift-triage.ts: bare and
                // extensioned (.js/.ts) specifiers from a flat sibling
                // (./...), from inside scripts/drift-ai/ (../...), or through
                // any deeper path that ends at the entry (**/...).
                "**/drift-triage",
                "**/drift-triage.*",
                "../drift-triage",
                "../drift-triage.*",
                "./drift-triage",
                "./drift-triage.*",
              ],
              message:
                "Direction law: scripts/drift-ai must not import scripts/drift-triage. Triage is the downstream reducer over drift-ai output; move shared logic into drift-ai and let triage import it.",
            },
          ],
        },
      ],
    },
  },
];

export const scriptDebtOverrideConfigs = [
  // Drift-AI family CLI policy (lint-review-2026-06 leaf 03e): a deliberate
  // keep, not tracked debt. Drift-AI is a metrics/reporting CLI — numeric
  // template interpolation, multi-input analysis functions, and scoring
  // constants are its idiom, so the family keeps allowNumber, max-params 6,
  // and no-magic-numbers off (verdict recorded in the lint-review-2026-06
  // register, now in git history; summary in
  // docs/agent_notes/finished_work/lint-review-2026-06.md).
  // Tests inherit the same options instead of a blanket test relax.
  // scripts/drift-triage (the triage reducer relocated out of drift-ai,
  // drift-triage-collapse S2) is the same metrics/reporting family and keeps
  // the same verdict.
  {
    files: [
      "scripts/drift-ai.ts",
      "scripts/drift-ai.test.ts",
      "scripts/drift-ai/**/*.ts",
      "scripts/drift-triage.ts",
      "scripts/drift-triage/**/*.ts",
    ],
    rules: {
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        {
          allowNumber: true,
          allowBoolean: false,
          allowAny: false,
          allowNullish: false,
          allowNever: false,
          allowRegExp: false,
        },
      ],
      "max-params": ["error", { max: 6 }],
      "no-magic-numbers": "off",
    },
  },

  // Codemod source policy (lint-review-2026-06 leaf 03i): normal lint owns
  // these files, while AST rewrite helpers keep a slightly wider arity and
  // small arity/index literals. Complexity and max-lines remain error floors.
  {
    files: codemodSourceFiles,
    rules: {
      "max-params": ["error", { max: 8 }],
      "no-magic-numbers": [
        "error",
        {
          ignore: [0, 1, 2, 3, -1],
          ignoreArrayIndexes: true,
          ignoreDefaultValues: true,
          enforceConst: true,
        },
      ],
    },
  },

  // Drained top-level entrypoint singletons (lint-review-2026-06 leaf 03a):
  // these files held the deleted top-level-scripts ratchets' stricter
  // restrict-template-expressions floor (allowNumber: false, unlike the
  // relaxed CLI block above and the typescript-eslint default), so normal
  // lint pins it here instead of keeping a different-options ratchet.
  {
    files: [
      "scripts/db-status.ts",
      "scripts/harness-emit-envelope.ts",
      "scripts/sensor-blob-size.test.ts",
      "scripts/sensor-blob-size.ts",
    ],
    rules: {
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        {
          allowAny: false,
          allowBoolean: false,
          allowNever: false,
          allowNullish: false,
          allowNumber: false,
          allowRegExp: false,
        },
      ],
    },
  },
];

export const processPrimitiveConfigs = [
  // Ban restricted process primitives outside named bootstrap/config/script
  // boundaries.
  {
    files: codeFiles,
    ignores: [...eslintConfigJsFiles, ...tsConfigFiles],
    rules: {
      "no-restricted-syntax": ["error", processExitRestrictedSyntax, processEnvRestrictedSyntax],
    },
  },

  // Bootstrap/config/script entrypoints where the restricted process
  // primitive is the correct boundary. This is the first no-restricted-syntax
  // selector in the config, so turning the whole rule off here only drops the
  // process primitive bans for these named files.
  {
    files: [
      "scripts/db-status.ts",
      "scripts/code-intel/daemon-process.ts",
      "scripts/code-intel/daemon-server.ts",
      "scripts/code-intel/perf-check.ts",
      // Implements the HARNESS_DIAGNOSTICS_OUTPUT sidecar contract; reading
      // that env var here IS the boundary every producer shares.
      "scripts/harness/harness-diagnostics-output.ts",
      // Implements the MUSI_HARNESS_CHECK_ALLOW_NO_FIXTURE_PATHS fixture
      // opt-out; reading that env var here IS the fail-closed boundary.
      "scripts/harness/fixture-closure-check.ts",
      "scripts/lint-ratchet/output.ts",
      "scripts/lint-ratchet.ts",
      "scripts/max-lines-exceptions.ts",
      "scripts/sensor-knip-unused-exports.ts",
      "scripts/sensor-near-duplicates.ts",
      "packages/server/src/config/env.ts",
      "packages/server/src/main.ts",
      "packages/server/prisma/seed.ts",
      "packages/server/prisma/seed-template.ts",
      "packages/server/scripts/pgexec.ts",
    ],
    rules: {
      "no-restricted-syntax": "off",
    },
  },

  // Test, helper, and e2e setup code may read/mutate environment variables
  // to isolate processes and databases; keep process.exit(...) restricted.
  {
    files: testAndHelperFiles,
    rules: {
      "no-restricted-syntax": ["error", processExitRestrictedSyntax],
    },
  },
];

export function createScriptProjectConfigs(repoRoot) {
  return [
    // Maintained scripts/ TypeScript lives outside package tsconfigs, so point
    // ESLint at the scripts project by default and exclude fixtures/config.
    {
      files: scriptTypeScriptFiles,
      ignores: scriptProjectIgnores,
      languageOptions: {
        parserOptions: {
          projectService: false,
          project: "./tsconfig.scripts.json",
          tsconfigRootDir: repoRoot,
        },
      },
    },

    {
      files: scriptTypeScriptFiles,
      ignores: scriptProjectIgnores,
      rules: {
        "local/type-assertion-boundary": "error",
      },
    },

    // Server scripts live outside `src/` and so aren't covered by the server
    // tsconfig's project service. Point them at a dedicated tsconfig.
    {
      files: serverScriptTypeScriptFiles,
      languageOptions: {
        parserOptions: {
          projectService: false,
          project: "./packages/server/tsconfig.scripts.json",
          tsconfigRootDir: repoRoot,
        },
      },
    },
  ];
}
