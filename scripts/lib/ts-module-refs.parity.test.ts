import { describe, expect, it } from "vitest";

import {
  addSource,
  createFixtureProject,
  createFixtureResolver,
  graphFor,
} from "../code-intel/test-fixtures.test-helper.js";
import { DEFAULT_DRIFT_AI_CONFIG } from "../drift-ai/config.js";
import { defaultModuleGraphRunner } from "../drift-ai/import-cycles-graph.js";
import { buildSourceExtensions } from "../drift-ai/scope.js";
import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";

// Cross-stack parity: drift-ai's module graph and code-intel's import graph
// must classify identical sources identically. Both consume the shared kernel
// (scripts/lib/ts-module-refs.ts); this test is the re-fork tripwire on the
// mapping layers ABOVE it — drift-ai's typeOnly AND-merge per (from, to) and
// code-intel's per-via dedup preferring the runtime edge collapse to the same
// per-(from, to) fact: the edge is runtime iff ANY occurrence is runtime.
// Intentional divergences stay out of the fixture: code-intel's vi.mock
// specifier filter (test files only — no fixture file is named *.test.ts) and
// the stacks' different resolution policies (all specifiers resolve on both).

const tmpRepo = registerTempRootCleanup();

// The fixture stays minimal on purpose: syntax-shape variation is the kernel
// characterization table's job (ts-module-refs.test.ts). Retained here is only
// what exercises the mapping layers above the kernel — runtime/type polarity
// in both directions, all three kinds (import / export-from / dynamic-import;
// the pair keys drop `via`, so their Via mapping is pinned by
// scripts/code-intel/graph-queries.test.ts, not here), and merge-divergence
// probes where the same (from, to) pair mixes type-only and runtime
// occurrences.
const fixtureSources: Record<string, string> = {
  "a.ts": `export const a = 1;\nexport type T = number;\n`,
  "b.ts": `export const b = () => 2;\nexport type U = string;\n`,
  "value-import.ts": `import { a } from "./a.js";\nexport const v = a;\n`,
  "type-import.ts": `import type { T } from "./a.js";\nexport type V = T;\n`,
  "reexport-star.ts": `export * from "./a.js";\n`,
  "type-reexport.ts": `export type { T } from "./a.js";\n`,
  "dynamic.ts": `export const load = () => import("./a.js");\n`,
  "type-then-dynamic.ts": [
    `import type { T } from "./a.js";`,
    `export const late: () => Promise<{ a: T }> = () => import("./a.js");`,
    ``,
  ].join("\n"),
  "type-then-value.ts": [
    `import type { U } from "./b.js";`,
    `import { b } from "./b.js";`,
    `export const both: U extends string ? number : never = b();`,
    ``,
  ].join("\n"),
};

type PairClassification = Map<string, boolean>; // "from -> to" -> runtime edge?

function driftAiPairs(): PairClassification {
  const root = tmpRepo.writeRepo(
    {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { module: "esnext", moduleResolution: "bundler" },
      }),
      ...fixtureSources,
    },
    "ts-module-refs-parity-",
  );
  const result = defaultModuleGraphRunner()({
    repoRoot: root,
    roots: ["."],
    tsconfigOverride: null,
    sourceExtensions: buildSourceExtensions([]),
    ignore: DEFAULT_DRIFT_AI_CONFIG.ignore,
  });
  if (!result.ok) throw new Error("drift-ai graph build failed");
  const pairs: PairClassification = new Map();
  for (const [from, edges] of result.graph.edges) {
    for (const edge of edges) pairs.set(`${from} -> ${edge.to}`, !edge.typeOnly);
  }
  return pairs;
}

function codeIntelPairs(): PairClassification {
  const project = createFixtureProject();
  for (const [file, text] of Object.entries(fixtureSources)) addSource(project, file, text);
  const graph = graphFor(project, createFixtureResolver(project));
  const pairs: PairClassification = new Map();
  for (const edges of graph.incoming.values()) {
    for (const edge of edges) {
      const key = `${edge.from} -> ${edge.to}`;
      pairs.set(key, (pairs.get(key) ?? false) || edge.runtime);
    }
  }
  return pairs;
}

describe("drift-ai / code-intel import-edge parity", () => {
  it("classifies identical sources identically across both stacks", () => {
    const drift = driftAiPairs();
    const intel = codeIntelPairs();

    expect([...drift.keys()].sort()).toEqual([...intel.keys()].sort());
    for (const [pair, runtime] of drift) {
      expect({ pair, runtime }).toEqual({ pair, runtime: intel.get(pair) });
    }

    // The fixture must exercise both classifications, or parity is vacuous.
    const classifications = new Set(drift.values());
    expect(classifications).toEqual(new Set([true, false]));
    expect(drift.get("type-then-dynamic.ts -> a.ts")).toBe(true);
    expect(drift.get("type-then-value.ts -> b.ts")).toBe(true);
    expect(drift.get("type-import.ts -> a.ts")).toBe(false);
  });
});
