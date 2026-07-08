import { describe, expect, it } from "vitest";

import { queryExports } from "./export-query.js";
import {
  addSource,
  createFixtureProject,
  createFixtureResolver,
} from "./test-fixtures.test-helper.js";

describe("export-query", () => {
  it("lists direct exports and re-exports", () => {
    const project = createFixtureProject();
    addSource(project, "packages/shared/src/rules/math.ts", "export const sum = () => 1;\n");
    addSource(
      project,
      "packages/shared/src/rules/types.ts",
      "export type Thing = { id: string };\n",
    );
    addSource(
      project,
      "packages/shared/src/rules/index.ts",
      'export { sum } from "./math.js";\nexport type { Thing } from "./types.js";\nexport const direct = 1;\n',
    );
    const resolver = createFixtureResolver(project);

    expect(queryExports(project, resolver, "packages/shared/src/rules/index.ts")).toEqual([
      { kind: "export", name: "direct", exportKind: "value export" },
      { kind: "export", name: "sum", exportKind: "value re-export" },
      { kind: "export", name: "Thing", exportKind: "type re-export" },
    ]);
  });
});
