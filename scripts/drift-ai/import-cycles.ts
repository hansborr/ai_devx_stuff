// Pure logic for the import-cycles adapter: strongly-connected-component detection
// over the module graph, runtime-vs-type-only classification, scope filtering,
// findings construction, partiality assessment, and provenance. All I/O (the graph
// build) lives behind ModuleGraphRunner in import-cycles-graph.ts; the CheckPlugin
// wiring is in import-cycles-check.ts. This is a config-honoring structural adapter
// (adapter contract §1/§2): it honors the target's own tsconfig path aliases, but a
// cycle is a verdict-free fact, so there is no threshold to defer.

import type { PathProbe } from "./adapter-support.js";
import type { CheckRunContext } from "./check-plugin.js";
import type { ModuleEdge, ModuleGraph, ModuleGraphRunner } from "./import-cycles-graph.js";
import { changedFilesFromScope, sortFindingsByFileMessage, toPosix } from "./path-util.js";
import type { DetectorScope } from "./scope.js";
import type { ConfigSource, DriftFinding, FindingProvenance, SkipReasonCode } from "./types.js";

// Services the import-cycles adapter resolves for itself (plugin-owned setup): the
// module-graph builder, the repo-relative install probe, and the explicit
// --tsconfig override (config-authority ladder rung 1; null = per-file
// nearest-tsconfig discovery). Defined here, beside the resolution logic that reads
// it, so the plugin file imports it without a cycle.
export type ImportCyclesServices = {
  readonly moduleGraph: ModuleGraphRunner;
  readonly pathExists: PathProbe;
  readonly tsconfigOverride: string | null;
};

// Above this share of relative/alias specifiers failing to resolve, the module
// graph is too partial to trust and we skip rather than report a misleading set of
// cycles (adapter contract §4, evidence-not-verdicts). On installed Musi the real
// ratio is ~3.4% (the spike), so 0.25 only trips on genuinely broken resolution
// (wrong/missing tsconfig, or a heavily workspace-aliased uninstalled target).
export const MAX_UNRESOLVED_RATIO = 0.25;

export const IMPORT_CYCLES_TOOL = "ts-morph";

export const RUNTIME_CYCLE_HINT =
  "break the cycle: invert one dependency, or extract the shared code both files need into a third module. AI agents often introduce this by splitting a module so the new child re-imports its parent.";

export const TYPE_ONLY_CYCLE_HINT =
  "type-only: this cycle does not exist at runtime (it is formed only by `import type`/`export type` edges). It is reported as evidence, not a defect; if undesired, move the shared types into a leaf module both sides import.";

// --- config resolution (ladder rungs 1–2) -----------------------------------

export type ImportCyclesResolution = {
  readonly configSource: ConfigSource;
  // Explicit --tsconfig override (rung 1), or null for per-file nearest-tsconfig
  // discovery (rung 2, the monorepo default).
  readonly tsconfigOverride: string | null;
  // Human/provenance label for the resolved config.
  readonly displayPath: string;
};

export function resolveImportCyclesConfig(
  ctx: CheckRunContext<ImportCyclesServices>,
): ImportCyclesResolution {
  const override = ctx.services.tsconfigOverride;
  return {
    configSource: "target-config",
    tsconfigOverride: override,
    displayPath: override ?? "tsconfig.json (per-package discovery)",
  };
}

export function buildCycleProvenance(resolution: ImportCyclesResolution): FindingProvenance {
  return {
    configSource: resolution.configSource,
    tool: IMPORT_CYCLES_TOOL,
    configPath: resolution.displayPath,
  };
}

// --- graph assessment (skip-vs-partial; adapter contract §4) -----------------

export type GraphAssessment =
  | { readonly kind: "ok" }
  | { readonly kind: "skip"; readonly reason: string; readonly code?: SkipReasonCode };

// Decide whether the built graph is trustworthy enough to report cycles from. No
// hard install gate — ts-morph resolves aliases offline (the point of option (c)) —
// but a graph whose relative/alias imports mostly fail to resolve is skipped.
export function assessGraph(graph: ModuleGraph, targetInstalled: boolean): GraphAssessment {
  if (graph.fileCount === 0) {
    return { kind: "skip", reason: "no TypeScript source files found under the configured roots." };
  }
  if (graph.tsconfigCount === 0) {
    return {
      kind: "skip",
      code: "no-target-config",
      reason:
        "no tsconfig found to resolve the module graph and honor the target's path aliases. Pass --tsconfig <path> to point at one.",
    };
  }
  const ratio = graph.candidateCount === 0 ? 0 : graph.unresolvedCount / graph.candidateCount;
  if (ratio > MAX_UNRESOLVED_RATIO) {
    return tooPartialSkip(graph, ratio, targetInstalled);
  }
  return { kind: "ok" };
}

function tooPartialSkip(
  graph: ModuleGraph,
  ratio: number,
  targetInstalled: boolean,
): GraphAssessment {
  const pct = Math.round(ratio * 100);
  const stats = `${graph.unresolvedCount}/${graph.candidateCount} (${pct}%) relative/alias imports did not resolve`;
  if (!targetInstalled) {
    return {
      kind: "skip",
      code: "target-not-installed",
      reason: `module-graph resolution is too partial to trust: ${stats}, and the target has no node_modules. Install the target's dependencies (and/or pass --tsconfig <path>) and re-run.`,
    };
  }
  return {
    kind: "skip",
    code: "resolution-too-partial",
    reason: `module-graph resolution is too partial to trust: ${stats}. Check that the right tsconfig governs these files, or pass --tsconfig <path>.`,
  };
}

// --- cycle detection --------------------------------------------------------

export type DetectedCycles = {
  // SCCs (size >= 2) that survive when type-only edges are removed — real runtime
  // cycles.
  readonly runtimeCycles: readonly (readonly string[])[];
  // SCCs (size >= 2) in the full graph whose members are entirely outside any
  // runtime cycle — cycles that exist only via `import type`/`export type` edges.
  readonly typeOnlyCycles: readonly (readonly string[])[];
};

export function findCycles(graph: ModuleGraph): DetectedCycles {
  const fullSccs = stronglyConnectedComponents(buildAdjacency(graph, true)).filter(isCycle);
  const valueSccs = stronglyConnectedComponents(buildAdjacency(graph, false)).filter(isCycle);
  const runtimeNodes = new Set(valueSccs.flat());
  // A full-graph cycle is reported as type-only only when NONE of its members are
  // already in a runtime cycle. This intentionally keeps the two finding sets
  // disjoint: an independent type-only cycle is still surfaced, but a type-only
  // tangle that is fused (via type-only edges) into a component that ALSO contains
  // a runtime cycle is subsumed under that runtime cycle rather than double-reported
  // with overlapping members. The task allows type-only cycles to be ignored or
  // labeled; this labels the independent ones and folds the fused ones into the
  // higher-signal runtime finding.
  const typeOnlyCycles = fullSccs.filter((scc) => scc.every((node) => !runtimeNodes.has(node)));
  return {
    runtimeCycles: valueSccs.map(sortedCycle),
    typeOnlyCycles: typeOnlyCycles.map(sortedCycle),
  };
}

function isCycle(component: readonly string[]): boolean {
  return component.length >= 2;
}

function sortedCycle(component: readonly string[]): string[] {
  return [...component].sort((left, right) => left.localeCompare(right, "en"));
}

function buildAdjacency(graph: ModuleGraph, includeTypeOnly: boolean): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const from of graph.edges.keys()) adjacency.set(from, []);
  for (const [from, edges] of graph.edges) {
    const list = adjacency.get(from);
    if (list === undefined) continue;
    for (const edge of edges) {
      if (includeTypeOnly || !edge.typeOnly) list.push(edge.to);
    }
  }
  return adjacency;
}

// --- findings ---------------------------------------------------------------

export function buildCycleFindings(
  cycles: DetectedCycles,
  detectorScope: DetectorScope,
  provenance: FindingProvenance,
): DriftFinding[] {
  const inScope = scopeFilter(detectorScope);
  const findings = [
    ...cycles.runtimeCycles.map((cycle) => cycleFinding(cycle, false, provenance)),
    ...cycles.typeOnlyCycles.map((cycle) => cycleFinding(cycle, true, provenance)),
  ].filter((finding): finding is DriftFinding => finding !== null && inScope(finding));
  return sortFindingsByFileMessage(findings);
}

function cycleFinding(
  cycle: readonly string[],
  typeOnly: boolean,
  provenance: FindingProvenance,
): DriftFinding | null {
  const [first, ...rest] = cycle;
  if (first === undefined) return null;
  const size = cycle.length;
  const message = typeOnly
    ? `part of a type-only import cycle among ${size} files — formed only by \`import type\`/\`export type\` edges, so it is not a runtime defect (see relatedFiles)`
    : `part of a circular import among ${size} files (see relatedFiles)`;
  return {
    check: "import-cycles",
    file: first,
    message,
    hint: typeOnly ? TYPE_ONLY_CYCLE_HINT : RUNTIME_CYCLE_HINT,
    relatedFiles: rest,
    details: { cycleSize: size, typeOnly },
    provenance,
  };
}

// In changed scope only cycles that touch a changed file are relevant (the graph
// itself is always whole-repo, since a cycle is a global property); current scope
// reports every cycle.
function scopeFilter(detectorScope: DetectorScope): (finding: DriftFinding) => boolean {
  if (detectorScope.scopeMode === "current") return () => true;
  const changed = new Set(changedFilesFromScope(detectorScope).map((file) => toPosix(file.path)));
  return (finding) =>
    changed.has(finding.file) || (finding.relatedFiles ?? []).some((file) => changed.has(file));
}

// --- diagnostic for an attempted-and-failed graph build (adapter contract §4) ---

export function buildGraphErrorFinding(error: string): DriftFinding {
  return {
    check: "import-cycles",
    file: ".",
    message: `import-cycles could not build the module graph (${error})`,
    hint: "report-only: re-run locally to inspect the failure; import-cycles is otherwise not reported for this run.",
  };
}

// --- strongly-connected components (Kosaraju, iterative) ---------------------
// Iterative (not recursive) so a deep import chain on a large repo cannot blow the
// call stack. Two passes: finish-order DFS, then DFS on the transposed graph in
// reverse finish order; each reverse-pass tree is one SCC.

function stronglyConnectedComponents(
  adjacency: ReadonlyMap<string, readonly string[]>,
): string[][] {
  const order = finishOrder(adjacency);
  const transpose = buildTranspose(adjacency);
  return assignComponents(order, transpose);
}

function finishOrder(adjacency: ReadonlyMap<string, readonly string[]>): string[] {
  const visited = new Set<string>();
  const order: string[] = [];
  for (const start of adjacency.keys()) {
    if (visited.has(start)) continue;
    const stack: Array<{ readonly node: string; index: number }> = [{ node: start, index: 0 }];
    visited.add(start);
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (top === undefined) break;
      const neighbors = adjacency.get(top.node) ?? [];
      const next = neighbors[top.index];
      top.index += 1;
      if (next === undefined) {
        order.push(top.node);
        stack.pop();
      } else if (!visited.has(next)) {
        visited.add(next);
        stack.push({ node: next, index: 0 });
      }
    }
  }
  return order;
}

function buildTranspose(adjacency: ReadonlyMap<string, readonly string[]>): Map<string, string[]> {
  const transpose = new Map<string, string[]>();
  for (const node of adjacency.keys()) transpose.set(node, []);
  for (const [from, neighbors] of adjacency) {
    for (const to of neighbors) transpose.get(to)?.push(from);
  }
  return transpose;
}

function assignComponents(
  order: readonly string[],
  transpose: ReadonlyMap<string, readonly string[]>,
): string[][] {
  const assigned = new Set<string>();
  const components: string[][] = [];
  for (let index = order.length - 1; index >= 0; index -= 1) {
    const root = order[index];
    if (root === undefined || assigned.has(root)) continue;
    const component: string[] = [];
    const stack = [root];
    assigned.add(root);
    while (stack.length > 0) {
      const node = stack.pop();
      if (node === undefined) continue;
      component.push(node);
      for (const next of transpose.get(node) ?? []) {
        if (!assigned.has(next)) {
          assigned.add(next);
          stack.push(next);
        }
      }
    }
    components.push(component);
  }
  return components;
}

// Re-export so the check module imports edge typing from one place.
export type { ModuleEdge };
