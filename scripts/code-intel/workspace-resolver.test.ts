import { describe, expect, it } from "vitest";

import {
  addSource,
  createFixtureProject,
  createFixtureResolver,
} from "./test-fixtures.test-helper.js";
import { createWorkspaceResolver } from "./workspace-resolver.js";

describe("WorkspaceResolver", () => {
  it("maps package exports, client aliases, relative imports, and source equivalents", () => {
    const project = createFixtureProject();
    addSource(project, "packages/shared/src/schemas/character.ts", "export const character = 1;");
    addSource(project, "packages/shared/src/rules/attack.ts", "export const attack = 1;");
    addSource(project, "packages/shared/src/dice/dice-roller.ts", "export const roll = 1;");
    addSource(project, "packages/shared/src/map/grid-utils.tsx", "export const grid = 1;");
    addSource(project, "packages/shared/src/constants.ts", "export const VERSION = 'test';");
    addSource(project, "packages/server/src/routers/app-router.ts", "export type AppRouter = {};");
    addSource(
      project,
      "packages/client/src/components/button.tsx",
      "export const Button = () => null;",
    );
    addSource(project, "packages/client/src/lib/local.ts", "export const local = 1;");
    addSource(
      project,
      "packages/client/src/pages/home.tsx",
      "import { local } from '../lib/local'; export const home = local;",
    );

    const resolver = createFixtureResolver(project);

    expect(resolver.resolveModule("@musi/shared/schemas/character.js")).toBe(
      "packages/shared/src/schemas/character.ts",
    );
    expect(resolver.resolveModule("@musi/shared/rules/attack.js")).toBe(
      "packages/shared/src/rules/attack.ts",
    );
    expect(resolver.resolveModule("@musi/shared/dice/dice-roller.js")).toBe(
      "packages/shared/src/dice/dice-roller.ts",
    );
    expect(resolver.resolveModule("@musi/shared/map/grid-utils.js")).toBe(
      "packages/shared/src/map/grid-utils.tsx",
    );
    expect(resolver.resolveModule("@musi/shared/constants")).toBe(
      "packages/shared/src/constants.ts",
    );
    expect(resolver.resolveModule("@musi/server/router-type")).toBe(
      "packages/server/src/routers/app-router.ts",
    );
    expect(resolver.resolveModule("@/components/button.js")).toBe(
      "packages/client/src/components/button.tsx",
    );
    expect(resolver.resolveModule("../lib/local", "packages/client/src/pages/home.tsx")).toBe(
      "packages/client/src/lib/local.ts",
    );
  });

  it("maps real workspace package exports to source", () => {
    const resolver = createWorkspaceResolver(process.cwd());

    expect(resolver.resolveModule("@musi/shared/constants")).toBe(
      "packages/shared/src/constants.ts",
    );
    expect(resolver.resolveModule("@musi/server/router-type")).toBe(
      "packages/server/src/routers/app-router.ts",
    );
  });
});
