// @ts-check

import path from "node:path";

import importX from "eslint-plugin-import-x";

import {
  clientSourceFiles,
  clientTestAndHelperSourceFiles,
  serverSourceFiles,
  serverTestAndHelperSourceFiles,
  sharedSourceFiles,
  sharedTestAndHelperSourceFiles,
} from "./path-glob-policy.js";

export function createPackageDependencyConfigs(repoRoot) {
  const sharedDir = path.resolve(repoRoot, "packages/shared");
  const serverDir = path.resolve(repoRoot, "packages/server");
  const clientDir = path.resolve(repoRoot, "packages/client");
  const serverSeedGeneratorGlob = path.resolve(
    repoRoot,
    "packages/server/src/seed/generate-srd-*.ts",
  );

  return [
    // packages/shared - strict tier: production-ish source
    {
      files: sharedSourceFiles,
      ignores: sharedTestAndHelperSourceFiles,
      plugins: { "import-x": importX },
      rules: {
        "import-x/no-extraneous-dependencies": [
          "error",
          { packageDir: [sharedDir], devDependencies: false },
        ],
      },
    },

    // packages/shared - tests & helpers: root devDeps allowed
    {
      files: sharedTestAndHelperSourceFiles,
      plugins: { "import-x": importX },
      rules: {
        "import-x/no-extraneous-dependencies": [
          "error",
          {
            packageDir: [sharedDir, repoRoot],
            devDependencies: true,
          },
        ],
      },
    },

    // packages/server - strict tier: production-ish source
    {
      files: serverSourceFiles,
      ignores: serverTestAndHelperSourceFiles,
      plugins: { "import-x": importX },
      rules: {
        "import-x/no-extraneous-dependencies": [
          "error",
          {
            packageDir: [serverDir],
            devDependencies: [serverSeedGeneratorGlob],
          },
        ],
      },
    },

    // packages/server - tests & helpers: root devDeps allowed
    {
      files: serverTestAndHelperSourceFiles,
      plugins: { "import-x": importX },
      rules: {
        "import-x/no-extraneous-dependencies": [
          "error",
          {
            packageDir: [serverDir, repoRoot],
            devDependencies: true,
          },
        ],
      },
    },

    // packages/client - strict tier: production-ish source
    {
      files: clientSourceFiles,
      ignores: clientTestAndHelperSourceFiles,
      plugins: { "import-x": importX },
      rules: {
        "import-x/no-extraneous-dependencies": [
          "error",
          { packageDir: [clientDir], devDependencies: false },
        ],
      },
    },

    // packages/client - tests & helpers: root devDeps allowed
    {
      files: clientTestAndHelperSourceFiles,
      plugins: { "import-x": importX },
      rules: {
        "import-x/no-extraneous-dependencies": [
          "error",
          {
            packageDir: [clientDir, repoRoot],
            devDependencies: true,
          },
        ],
      },
    },
  ];
}
