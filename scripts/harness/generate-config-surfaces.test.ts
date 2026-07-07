import { describe, expect, it } from "vitest";

import { renderConfigSurfaceTsconfig } from "./generate-config-surfaces.js";

describe("config surface generator", () => {
  it("renders tsconfig.configs.json from the manifest-owned TypeScript configs", () => {
    expect(renderConfigSurfaceTsconfig(["one.config.ts", "nested/two.config.ts"])).toBe(`{
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
    "one.config.ts",
    "nested/two.config.ts"
  ]
}
`);
  });
});
