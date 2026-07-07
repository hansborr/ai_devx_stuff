import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { tsConfigFiles } from "../../eslint-config/shared-policy.js";
import { runDocGenerator } from "../lib/doc-generator.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outputPath = join(repoRoot, "tsconfig.configs.json");

function quoteJsonString(value: string): string {
  return JSON.stringify(value);
}

function renderIncludeList(include: readonly string[]): string {
  return include.map((path) => `    ${quoteJsonString(path)}`).join(",\n");
}

function readTsConfigFilesFromPolicy(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    throw new Error("config surface policy must export tsConfigFiles[]");
  }
  const files: string[] = [];
  for (const file of value) {
    if (typeof file !== "string" || file.length === 0) {
      throw new Error("config surface policy tsConfigFiles entries must be non-empty strings");
    }
    files.push(file);
  }
  return files;
}

export function renderConfigSurfaceTsconfig(include: readonly string[]): string {
  return `{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "composite": false,
    "declaration": false,
    "declarationMap": false,
    "noEmit": true,
    "rootDir": ".",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "allowImportingTsExtensions": true,
    "types": ["node"]
  },
  "include": [
${renderIncludeList(include)}
  ]
}
`;
}

function main(): void {
  runDocGenerator({
    outputPath,
    refreshCommand: "harness:config-surfaces",
    render: () => ({
      rendered: renderConfigSurfaceTsconfig(readTsConfigFilesFromPolicy(tsConfigFiles)),
    }),
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
