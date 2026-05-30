import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { CheckRunContext, CheckRunInput } from "./check-plugin.js";
import { parseArgs } from "./cli-args.js";
import { DEFAULT_DRIFT_AI_CONFIG } from "./config.js";
import {
  assessGraph,
  buildCycleFindings,
  buildCycleProvenance,
  findCycles,
  type ImportCyclesServices,
  resolveImportCyclesConfig,
} from "./import-cycles.js";
import { importCyclesCheck } from "./import-cycles-check.js";
import type {
  ModuleEdge,
  ModuleGraph,
  ModuleGraphResult,
  ModuleGraphRunner,
} from "./import-cycles-graph.js";
import { defaultModuleGraphRunner } from "./import-cycles-graph.js";
import type { DetectorScope } from "./scope.js";
import { buildSourceExtensions, toChangedScopeFile } from "./scope.js";
import type { ChangedFile, DriftFinding, FindingProvenance } from "./types.js";

const PROVENANCE: FindingProvenance = {
  configSource: "target-config",
  tool: "ts-morph",
  configPath: "tsconfig.json",
};

// --- in-memory graph helpers ------------------------------------------------

function edge(to: string, typeOnly = false): ModuleEdge {
  return { to, typeOnly };
}

function makeGraph(
  spec: Record<string, readonly ModuleEdge[]>,
  stats: Partial<Pick<ModuleGraph, "candidateCount" | "unresolvedCount" | "tsconfigCount">> = {},
): ModuleGraph {
  const edges = new Map<string, readonly ModuleEdge[]>(Object.entries(spec));
  return {
    edges,
    candidateCount: stats.candidateCount ?? 0,
    unresolvedCount: stats.unresolvedCount ?? 0,
    fileCount: edges.size,
    tsconfigCount: stats.tsconfigCount ?? 1,
  };
}

function changedScope(files: readonly ChangedFile[]): DetectorScope {
  return { scopeMode: "changed", files: files.map(toChangedScopeFile) };
}

// --- temp-dir fixtures (the real resolver runs against these) ---------------

const tempRoots: string[] = [];
afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

function writeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "drift-cycles-"));
  tempRoots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

function tsconfig(paths?: Record<string, string[]>): string {
  return JSON.stringify({
    compilerOptions: {
      module: "esnext",
      moduleResolution: "bundler",
      baseUrl: ".",
      ...(paths === undefined ? {} : { paths }),
    },
  });
}

function graphResultForRepo(
  root: string,
  roots: readonly string[] = ["."],
  tsconfigOverride: string | null = null,
): ModuleGraphResult {
  return defaultModuleGraphRunner()({
    repoRoot: root,
    roots,
    tsconfigOverride,
    sourceExtensions: buildSourceExtensions([]),
    ignore: DEFAULT_DRIFT_AI_CONFIG.ignore,
  });
}

function graphFailureMessage(result: Exclude<ModuleGraphResult, { readonly ok: true }>): string {
  return "error" in result ? result.error : result.reason;
}

function graphForRepo(root: string, roots: readonly string[] = ["."]): ModuleGraph {
  const result = graphResultForRepo(root, roots);
  if (!result.ok) throw new Error(`graph build failed: ${graphFailureMessage(result)}`);
  return result.graph;
}

function findingsForRepo(root: string, scope?: DetectorScope): DriftFinding[] {
  return buildCycleFindings(
    findCycles(graphForRepo(root)),
    scope ?? { scopeMode: "current", files: [] },
    PROVENANCE,
  );
}

function members(finding: DriftFinding): string[] {
  return [finding.file, ...(finding.relatedFiles ?? [])].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
}

// --- findCycles (pure classification) ---------------------------------------

describe("findCycles", () => {
  it("detects a runtime cycle and leaves acyclic nodes out", () => {
    const graph = makeGraph({
      "a.ts": [edge("b.ts")],
      "b.ts": [edge("a.ts")],
      "leaf.ts": [edge("a.ts")],
    });
    const { runtimeCycles, typeOnlyCycles } = findCycles(graph);
    expect(runtimeCycles).toEqual([["a.ts", "b.ts"]]);
    expect(typeOnlyCycles).toEqual([]);
  });

  it("classifies a cycle formed only by type-only edges as type-only", () => {
    const graph = makeGraph({
      "t1.ts": [edge("t2.ts", true)],
      "t2.ts": [edge("t1.ts", true)],
    });
    const { runtimeCycles, typeOnlyCycles } = findCycles(graph);
    expect(runtimeCycles).toEqual([]);
    expect(typeOnlyCycles).toEqual([["t1.ts", "t2.ts"]]);
  });

  it("keeps a runtime cycle runtime even if one direction is type-only", () => {
    const graph = makeGraph({
      "a.ts": [edge("b.ts", true)],
      "b.ts": [edge("a.ts", false)],
    });
    // The value-only graph is not strongly connected (a->b is type-only), so this
    // is NOT a runtime cycle; it survives only via the type-only edge.
    const { runtimeCycles, typeOnlyCycles } = findCycles(graph);
    expect(runtimeCycles).toEqual([]);
    expect(typeOnlyCycles).toEqual([["a.ts", "b.ts"]]);
  });

  it("does not flag a barrel fan-out without a back-edge", () => {
    const graph = makeGraph({
      "index.ts": [edge("a.ts"), edge("b.ts"), edge("c.ts")],
      "a.ts": [],
      "b.ts": [],
      "c.ts": [],
      "consumer.ts": [edge("index.ts")],
    });
    expect(findCycles(graph).runtimeCycles).toEqual([]);
  });

  it("still reports an independent type-only cycle alongside a separate runtime cycle", () => {
    const graph = makeGraph({
      "a.ts": [edge("b.ts")],
      "b.ts": [edge("a.ts")],
      "t1.ts": [edge("t2.ts", true)],
      "t2.ts": [edge("t1.ts", true)],
    });
    const { runtimeCycles, typeOnlyCycles } = findCycles(graph);
    expect(runtimeCycles).toEqual([["a.ts", "b.ts"]]);
    expect(typeOnlyCycles).toEqual([["t1.ts", "t2.ts"]]);
  });

  it("subsumes a type-only tangle fused with a runtime cycle (no overlapping double-report)", () => {
    // a<->b is runtime; c<->d is type-only; type-only edges (a->c, d->a) fuse all
    // four into one full SCC. Only the runtime cycle {a,b} is reported — the fused
    // superset is not also emitted as a type-only finding over the same members.
    const graph = makeGraph({
      "a.ts": [edge("b.ts"), edge("c.ts", true)],
      "b.ts": [edge("a.ts")],
      "c.ts": [edge("d.ts", true)],
      "d.ts": [edge("c.ts", true), edge("a.ts", true)],
    });
    const { runtimeCycles, typeOnlyCycles } = findCycles(graph);
    expect(runtimeCycles).toEqual([["a.ts", "b.ts"]]);
    expect(typeOnlyCycles).toEqual([]);
  });
});

// --- assessGraph (skip-vs-partial) ------------------------------------------

describe("assessGraph", () => {
  it("is ok on a well-resolved installed graph", () => {
    const graph = makeGraph({ "a.ts": [] }, { candidateCount: 100, unresolvedCount: 3 });
    expect(assessGraph(graph, true)).toEqual({ kind: "ok" });
  });

  it("skips no-target-config when no tsconfig governs any file", () => {
    const graph = makeGraph({ "a.ts": [] }, { tsconfigCount: 0 });
    expect(assessGraph(graph, true)).toMatchObject({ kind: "skip", code: "no-target-config" });
  });

  it("skips with no source files found", () => {
    const graph = makeGraph({});
    const assessment = assessGraph(graph, true);
    expect(assessment.kind).toBe("skip");
    if (assessment.kind === "skip") expect(assessment.code).toBeUndefined();
  });

  it("skips target-not-installed when resolution is too partial and node_modules is absent", () => {
    const graph = makeGraph({ "a.ts": [] }, { candidateCount: 100, unresolvedCount: 60 });
    expect(assessGraph(graph, false)).toMatchObject({
      kind: "skip",
      code: "target-not-installed",
    });
  });

  it("skips resolution-too-partial when too partial but the target IS installed", () => {
    const graph = makeGraph({ "a.ts": [] }, { candidateCount: 100, unresolvedCount: 60 });
    expect(assessGraph(graph, true)).toMatchObject({
      kind: "skip",
      code: "resolution-too-partial",
    });
  });
});

// --- buildCycleFindings (shape, scope, provenance) --------------------------

describe("buildCycleFindings", () => {
  const cycles = {
    runtimeCycles: [["a.ts", "b.ts"]],
    typeOnlyCycles: [["t1.ts", "t2.ts"]],
  } as const;

  it("builds one finding per cycle, anchored on the first member, with provenance", () => {
    const findings = buildCycleFindings(cycles, { scopeMode: "current", files: [] }, PROVENANCE);
    expect(findings).toHaveLength(2);
    const runtime = findings.find((f) => f.details?.typeOnly === false);
    expect(runtime?.file).toBe("a.ts");
    expect(runtime?.relatedFiles).toEqual(["b.ts"]);
    expect(runtime?.provenance).toEqual(PROVENANCE);
    expect(runtime?.message).toContain("circular import");
  });

  it("labels a type-only cycle as not a runtime defect", () => {
    const findings = buildCycleFindings(cycles, { scopeMode: "current", files: [] }, PROVENANCE);
    const typeOnly = findings.find((f) => f.details?.typeOnly === true);
    expect(typeOnly?.message).toContain("type-only");
    expect(typeOnly?.message).toContain("not a runtime defect");
  });

  it("in changed scope keeps only cycles that touch a changed file", () => {
    const scope = changedScope([{ path: "a.ts", status: "modified" }]);
    const findings = buildCycleFindings(cycles, scope, PROVENANCE);
    expect(findings.map((f) => f.file)).toEqual(["a.ts"]); // t1/t2 cycle is untouched
  });
});

describe("buildCycleProvenance", () => {
  it("labels per-package discovery when no --tsconfig override is set", () => {
    const provenance = buildCycleProvenance(resolveImportCyclesConfig(makeServicesCtx(null)));
    expect(provenance).toEqual({
      configSource: "target-config",
      tool: "ts-morph",
      configPath: "tsconfig.json (per-package discovery)",
    });
  });

  it("carries the explicit override path", () => {
    const provenance = buildCycleProvenance(
      resolveImportCyclesConfig(makeServicesCtx("config/tsconfig.json")),
    );
    expect(provenance.configPath).toBe("config/tsconfig.json");
  });
});

// --- real resolver against fixtures (acceptance criteria) -------------------

describe("defaultModuleGraphRunner resolution", () => {
  it("skips a missing explicit --tsconfig before reporting normal cycle findings", () => {
    const root = writeRepo({
      "src/a.ts": `import { b } from "./b";\nexport const a = () => b();\n`,
      "src/b.ts": `import { a } from "./a";\nexport const b = () => a();\n`,
    });
    const result = graphResultForRepo(root, ["src"], "missing-tsconfig.json");

    expect(result.ok).toBe(false);
    if (result.ok || !("reason" in result)) throw new Error("expected skipped graph result");
    expect(result.code).toBe("no-target-config");
    expect(result.reason).toContain("explicit --tsconfig missing-tsconfig.json");
    expect(result.reason).toContain("could not be read");
  });

  it("skips a malformed explicit --tsconfig with a compact TypeScript diagnostic", () => {
    const root = writeRepo({
      "bad-tsconfig.json": "{",
      "src/a.ts": `export const a = 1;\n`,
    });
    const result = graphResultForRepo(root, ["src"], "bad-tsconfig.json");

    expect(result.ok).toBe(false);
    if (result.ok || !("reason" in result)) throw new Error("expected skipped graph result");
    expect(result.code).toBe("no-target-config");
    expect(result.reason).toContain("explicit --tsconfig bad-tsconfig.json is invalid");
    expect(result.reason).toContain("TS");
  });

  it("does not count a malformed nearest tsconfig as loaded", () => {
    const root = writeRepo({
      "tsconfig.json": "{",
      "src/a.ts": `export const a = 1;\n`,
    });
    const result = graphResultForRepo(root, ["src"]);

    if (!result.ok) throw new Error(`graph build failed: ${graphFailureMessage(result)}`);
    expect(result.graph.tsconfigCount).toBe(0);
  });

  it("honors a valid explicit --tsconfig and counts it once", () => {
    const root = writeRepo({
      "config/tsconfig.json": JSON.stringify({
        compilerOptions: {
          module: "esnext",
          moduleResolution: "bundler",
          baseUrl: "..",
          paths: { "@src/*": ["src/*"] },
        },
        include: ["../src/**/*"],
      }),
      "src/a.ts": `import { b } from "@src/b";\nexport const a = () => b();\n`,
      "src/b.ts": `import { a } from "@src/a";\nexport const b = () => a();\n`,
    });
    const result = graphResultForRepo(root, ["src"], "config/tsconfig.json");

    if (!result.ok) throw new Error(`graph build failed: ${graphFailureMessage(result)}`);
    expect(result.graph.tsconfigCount).toBe(1);
    expect(findCycles(result.graph).runtimeCycles).toEqual([["src/a.ts", "src/b.ts"]]);
  });

  it("honors tsconfig path aliases (incl. a remap) and reports a cycle through them", () => {
    const root = writeRepo({
      "tsconfig.json": tsconfig({ "@app/*": ["./src/*"], "@lib/*": ["./packages/lib/*"] }),
      // cycle through the alias remap: src <-> packages/lib
      "src/a.ts": `import { b } from "@lib/b";\nexport const a = () => b();\n`,
      "packages/lib/b.ts": `import { a } from "@app/a";\nexport const b = () => a();\n`,
      // non-cycle through an alias: must NOT be reported
      "src/c.ts": `import { d } from "@lib/d";\nexport const c = () => d();\n`,
      "packages/lib/d.ts": `export const d = () => 1;\n`,
    });
    const findings = findingsForRepo(root);
    expect(findings).toHaveLength(1);
    expect(members(findings[0] as DriftFinding)).toEqual(["packages/lib/b.ts", "src/a.ts"]);
  });

  it("labels a type-only cycle and reports a runtime cycle unlabeled", () => {
    const root = writeRepo({
      "tsconfig.json": tsconfig(),
      "t1.ts": `import type { T2 } from "./t2";\nexport type T1 = { x: T2 | null };\n`,
      "t2.ts": `import type { T1 } from "./t1";\nexport type T2 = { y: T1 | null };\n`,
      "r1.ts": `import { r2 } from "./r2";\nexport const r1 = () => r2();\n`,
      "r2.ts": `import { r1 } from "./r1";\nexport const r2 = () => r1();\n`,
    });
    const findings = findingsForRepo(root);
    expect(findings).toHaveLength(2);
    const typeOnly = findings.find((f) => f.details?.typeOnly === true);
    const runtime = findings.find((f) => f.details?.typeOnly === false);
    expect(members(typeOnly as DriftFinding)).toEqual(["t1.ts", "t2.ts"]);
    expect(members(runtime as DriftFinding)).toEqual(["r1.ts", "r2.ts"]);
  });

  it("does not collapse a barrel's fan-out into noise; only a genuine back-edge counts", () => {
    const root = writeRepo({
      "tsconfig.json": tsconfig(),
      "index.ts": `export { a } from "./a";\nexport { b } from "./b";\nexport { c } from "./c";\n`,
      "a.ts": `export const a = 1;\n`,
      "b.ts": `export const b = 2;\n`,
      // genuine back-edge: c imports the barrel that re-exports c
      "c.ts": `import { a } from "./index";\nexport const c = a;\n`,
      // consumer imports the barrel but the barrel never imports it back
      "consumer.ts": `import { a, b } from "./index";\nexport const use = () => a + b;\n`,
    });
    const findings = findingsForRepo(root);
    expect(findings).toHaveLength(1);
    expect(members(findings[0] as DriftFinding)).toEqual(["c.ts", "index.ts"]);
  });

  it("counts a candidate that resolves to a .d.ts as external, not an unresolved failure", () => {
    // Regression: a candidate import that RESOLVES (here, to a declaration file)
    // must not be counted toward partiality — only true resolution failures are.
    const root = writeRepo({
      "tsconfig.json": tsconfig(),
      "src/types.d.ts": `export type T = number;\n`,
      "src/a.ts": `import type { T } from "./types.js";\nexport const a: T = 1;\n`,
    });
    const graph = graphForRepo(root, ["src"]);
    expect(graph.candidateCount).toBe(1);
    expect(graph.unresolvedCount).toBe(0);
  });

  it("detects a cycle across monorepo package boundaries via the alias graph", () => {
    const root = writeRepo({
      "tsconfig.json": tsconfig({
        "@pkg-a/*": ["./packages/a/src/*"],
        "@pkg-b/*": ["./packages/b/src/*"],
      }),
      "packages/a/src/index.ts": `import { b } from "@pkg-b/index";\nexport const a = () => b();\n`,
      "packages/b/src/index.ts": `import { a } from "@pkg-a/index";\nexport const b = () => a();\n`,
    });
    const findings = findingsForRepo(root);
    expect(findings).toHaveLength(1);
    expect(members(findings[0] as DriftFinding)).toEqual([
      "packages/a/src/index.ts",
      "packages/b/src/index.ts",
    ]);
  });
});

// --- importCyclesCheck (plugin wiring) --------------------------------------

type CtxOverrides = {
  readonly detectorScope?: DetectorScope;
  readonly moduleGraph?: ModuleGraphRunner;
  readonly pathExists?: (relativePath: string) => boolean;
  readonly tsconfigOverride?: string | null;
};

const RUN_STATE = {
  inventoryByDir: null,
  repoRoot: "/repo/target",
  suppressionDiffRef: null,
  config: DEFAULT_DRIFT_AI_CONFIG,
  roots: [],
  sourceExtensions: buildSourceExtensions([]),
  warnStderr: () => undefined,
} as const;

// Build the buildReport input the plugin resolves its services from. The injected
// moduleGraph/pathExists flow through env.overrides; --tsconfig flows through cli.
function makeInput(overrides: CtxOverrides = {}): CheckRunInput {
  return {
    ...RUN_STATE,
    detectorScope: overrides.detectorScope ?? { scopeMode: "current", files: [] },
    env: {
      repoRoot: "/repo/target",
      overrides: {
        moduleGraph: overrides.moduleGraph ?? (() => ({ ok: true, graph: makeGraph({}) })),
        pathExists: overrides.pathExists ?? (() => false),
      },
      cli: parseArgs([
        "--scope",
        "current",
        "--check",
        "import-cycles",
        ...(overrides.tsconfigOverride == null ? [] : ["--tsconfig", overrides.tsconfigOverride]),
      ]),
    },
  };
}

// Build the already-resolved run context the pure resolver/run helpers read from.
function makeServicesCtx(tsconfigOverride: string | null): CheckRunContext<ImportCyclesServices> {
  return {
    ...RUN_STATE,
    detectorScope: { scopeMode: "current", files: [] },
    services: {
      moduleGraph: () => ({ ok: true, graph: makeGraph({}) }),
      pathExists: () => false,
      tsconfigOverride,
    },
  };
}

describe("importCyclesCheck", () => {
  it("emits a single diagnostic finding when the graph build throws", () => {
    const outcome = importCyclesCheck.runWithSelectedConfig(
      makeInput({ moduleGraph: () => ({ ok: false, error: "boom" }) }),
    );
    expect(outcome.status).toBe("ran");
    if (outcome.status === "ran") {
      expect(outcome.findings).toHaveLength(1);
      expect(outcome.findings[0]?.message).toContain("could not build the module graph");
      expect(outcome.findings[0]?.provenance).toBeUndefined();
    }
  });

  it("skips no-target-config when no tsconfig governs the graph", () => {
    const graph = makeGraph({ "a.ts": [] }, { tsconfigCount: 0 });
    const outcome = importCyclesCheck.runWithSelectedConfig(
      makeInput({ moduleGraph: () => ({ ok: true, graph }) }),
    );
    expect(outcome.status).toBe("skipped");
    if (outcome.status === "skipped") expect(outcome.code).toBe("no-target-config");
  });

  it("skips target-not-installed when partial and node_modules is absent", () => {
    const graph = makeGraph({ "a.ts": [] }, { candidateCount: 10, unresolvedCount: 9 });
    const outcome = importCyclesCheck.runWithSelectedConfig(
      makeInput({ moduleGraph: () => ({ ok: true, graph }), pathExists: () => false }),
    );
    expect(outcome.status).toBe("skipped");
    if (outcome.status === "skipped") expect(outcome.code).toBe("target-not-installed");
  });

  it("reports provenance-stamped cycle findings on a resolved graph", () => {
    const graph = makeGraph(
      { "a.ts": [edge("b.ts")], "b.ts": [edge("a.ts")] },
      { candidateCount: 2, unresolvedCount: 0 },
    );
    const outcome = importCyclesCheck.runWithSelectedConfig(
      makeInput({ moduleGraph: () => ({ ok: true, graph }), pathExists: () => true }),
    );
    expect(outcome.status).toBe("ran");
    if (outcome.status === "ran") {
      expect(outcome.findings).toHaveLength(1);
      expect(outcome.findings[0]?.provenance?.tool).toBe("ts-morph");
      expect(outcome.findings[0]?.provenance?.configSource).toBe("target-config");
    }
  });

  it("is opt-in (not in the default run set)", () => {
    expect(importCyclesCheck.runByDefault).toBe(false);
  });
});
