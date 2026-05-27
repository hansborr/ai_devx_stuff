// @ts-check

import {
  codeFiles,
  eslintConfigJsFiles,
  lintedScriptFiles,
  processEnvRestrictedSyntax,
  processExitRestrictedSyntax,
  testAndHelperFiles,
  tsConfigFiles,
} from "./shared-policy.js";

export const scriptDebtOverrideConfigs = [
  // Leaf 41g existing singleton findings stay ratcheted until drained; keep
  // these rules active everywhere else.
  {
    files: ["scripts/code-intel.test.ts"],
    rules: {
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
    },
  },

  {
    files: ["scripts/lint-ratchet-baseline.test.ts"],
    rules: {
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-dynamic-delete": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "max-params": "off",
      "regexp/no-super-linear-backtracking": "off",
    },
  },

  {
    files: ["scripts/lint-coverage-map-check.ts"],
    rules: {
      complexity: "off",
      "no-magic-numbers": "off",
      "@typescript-eslint/require-await": "off",
      "regexp/no-unused-capturing-group": "off",
    },
  },

  // Newly un-ignored scripts: relax rules that produce legitimate
  // patterns in CLI tools (numeric template interpolation, multi-param
  // builder functions). Remaining findings are tracked by the ratchet
  // system; per-file overrides below suppress duplicates.
  {
    files: [
      "scripts/db-status.ts",
      "scripts/drift-ai.ts",
      "scripts/drift-ai/**/*.ts",
      "scripts/generate-harness-controls.ts",
      "scripts/harness-check.ts",
      "scripts/harness-emit-envelope.ts",
      "scripts/harness-wrapper-slot*.ts",
      "scripts/lint-agent.ts",
      "scripts/lint-ratchet*.ts",
      "scripts/logs-audit.ts",
      "scripts/sensor-blob-size.ts",
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
  {
    files: [
      "scripts/drift-ai.test.ts",
      "scripts/drift-ai/**/*.test.ts",
      "scripts/lint-ratchet-check-registry.test.ts",
      "scripts/lint-ratchet-output.test.ts",
      "scripts/lint-ratchet-report.test.ts",
      "scripts/lint-ratchet-summary.test.ts",
      "scripts/logs-audit.test.ts",
      "scripts/sensor-blob-size.test.ts",
    ],
    rules: {
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-dynamic-delete": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "max-params": "off",
    },
  },

  // Ratcheted findings - the ratchet system enforces these rules
  // independently, so suppress from the normal lint run.
  {
    files: [
      "scripts/drift-ai.ts",
      "scripts/generate-harness-controls.ts",
      "scripts/harness-check.ts",
      "scripts/lint-agent.ts",
      "scripts/logs-audit.ts",
      "scripts/sensor-blob-size.ts",
    ],
    rules: { complexity: "off" },
  },
  {
    files: [
      "scripts/drift-ai.ts",
      "scripts/drift-ai/comments.ts",
      "scripts/harness-check.ts",
      "scripts/lint-ratchet-metrics.ts",
      "scripts/lint-ratchet.ts",
    ],
    rules: { "regexp/no-unused-capturing-group": "off" },
  },
  {
    files: [
      "scripts/drift-ai/duplicates.ts",
      "scripts/drift-ai/ghost-files.ts",
      "scripts/lint-ratchet-baseline.ts",
    ],
    rules: { "@typescript-eslint/no-unnecessary-condition": "off" },
  },
  {
    files: [
      "scripts/harness-emit-envelope.ts",
      "scripts/lint-ratchet-baseline-parse.ts",
      "scripts/lint-ratchet-baseline.ts",
    ],
    rules: { "@typescript-eslint/no-unsafe-argument": "off" },
  },
  {
    files: ["scripts/drift-ai.ts"],
    rules: {
      "regexp/no-super-linear-backtracking": "off",
      "@typescript-eslint/switch-exhaustiveness-check": "off",
    },
  },
  {
    files: ["scripts/harness-emit-envelope.ts"],
    rules: {
      "@typescript-eslint/unbound-method": "off",
      "preserve-caught-error": "off",
    },
  },
  {
    files: ["scripts/lint-ratchet.ts"],
    rules: {
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/prefer-promise-reject-errors": "off",
      "no-nested-ternary": "off",
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
      "scripts/lint-ratchet-output.ts",
      "scripts/lint-ratchet.ts",
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
    // Linted scripts/ modules and selected entrypoints live outside package
    // tsconfigs, so point ESLint at the scripts project.
    {
      files: lintedScriptFiles,
      languageOptions: {
        parserOptions: {
          projectService: false,
          project: "./tsconfig.scripts.json",
          tsconfigRootDir: repoRoot,
        },
      },
    },

    {
      files: lintedScriptFiles,
      rules: {
        "local/type-assertion-boundary": "error",
      },
    },

    // Server scripts live outside `src/` and so aren't covered by the server
    // tsconfig's project service. Point them at a dedicated tsconfig.
    {
      files: ["packages/server/scripts/**/*.ts", "packages/server/prisma/seed*.ts"],
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
