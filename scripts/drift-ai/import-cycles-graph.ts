// Module-graph builder for the import-cycles adapter: the injected I/O seam
// that owns the filesystem walk, per-file nearest tsconfig resolution, module
// resolution, partiality accounting, and edge merging. Extraction and
// runtime-vs-type classification of import/export/dynamic-import references
// live in the shared kernel, scripts/lib/ts-module-refs.ts. Cycle detection
// and check integration are pure and live in import-cycles.ts.
//
// The spike (docs/agent_notes/.../31-import-cycles-plugin.md) picked option (c):
// raw `ts.resolveModuleName` over per-file nearest tsconfigs. It resolves the
// target's path aliases offline (no target install needed), so this is fast
// (~0.65s / 1715 files) and honors a monorepo's per-package alias maps without a
// single global tsconfig. New I/O goes behind an injected runner with a `default*`
// factory and is faked in tests, mirroring KnipRunner / GitRunner.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { ts } from "ts-morph";

import { extractModuleRefs, type ModuleRef } from "../lib/ts-module-refs.js";
import type { DriftAiIgnoreConfig } from "./config.js";
import {
  type AliasHead,
  explicitTsconfigSkipReason,
  loadedTsconfigCount,
  loadTsconfig,
  type TsconfigLoadState,
} from "./import-cycles-tsconfig.js";
import { toPosix } from "./path-util.js";
import { walkAbsoluteSourceFiles } from "./source-walk.js";
import { tsSysModuleResolutionHost } from "./ts-source-util.js";
import type { SkipReasonCode } from "./types.js";

// A directed edge in the module graph. `typeOnly` is true only when EVERY import
// of `to` from the source file is a type-only import/export (an edge that does not
// exist at runtime). Used to classify a cycle as type-only vs. a runtime defect.
export type ModuleEdge = { readonly to: string; readonly typeOnly: boolean };

export type ModuleGraph = {
  // Repo-relative posix file path -> outgoing edges (targets also in the graph).
  readonly edges: ReadonlyMap<string, readonly ModuleEdge[]>;
  // Relative / alias specifiers — those that SHOULD resolve to a repo file. The
  // partiality metric (import-cycles.ts) is unresolved / candidate over these;
  // bare external (npm / workspace-package) specifiers are excluded.
  readonly candidateCount: number;
  readonly unresolvedCount: number;
  // Number of source files walked into the graph.
  readonly fileCount: number;
  // How many distinct tsconfigs governed resolution. Zero means no tsconfig was
  // found for any file (not a TS project) -> the caller skips no-target-config.
  readonly tsconfigCount: number;
};

export type ModuleGraphResult =
  | { readonly ok: true; readonly graph: ModuleGraph }
  // Expected config absence/invalidity -> skipped check, not a diagnostic finding.
  | { readonly ok: false; readonly reason: string; readonly code?: SkipReasonCode }
  // The engine threw building the graph -> attempted-and-failed (one diagnostic).
  | { readonly ok: false; readonly error: string };

type ModuleGraphRunnerInput = {
  readonly repoRoot: string;
  // Configured source roots (repo-relative). Empty walks the whole repoRoot.
  readonly roots: readonly string[];
  // Explicit --tsconfig override (ladder rung 1), or null for per-file nearest
  // tsconfig discovery (ladder rung 2, the monorepo default).
  readonly tsconfigOverride: string | null;
  readonly sourceExtensions: ReadonlySet<string>;
  readonly ignore: DriftAiIgnoreConfig;
};

export type ModuleGraphRunner = (input: ModuleGraphRunnerInput) => ModuleGraphResult;

export function defaultModuleGraphRunner(): ModuleGraphRunner {
  return (input) => {
    try {
      return buildGraph(input);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };
}

// --- graph construction -----------------------------------------------------

// Shared, mutable-cache state threaded through the per-file edge collection so the
// hot loop stays a single concern (keeps buildGraph's branching low).
type GraphBuildState = {
  readonly repoRoot: string;
  readonly fileSet: ReadonlySet<string>;
  readonly host: ts.ModuleResolutionHost;
  readonly cache: ts.ModuleResolutionCache;
  readonly tsconfigs: Map<string, TsconfigLoadState>;
  readonly tsconfigForDir: Map<string, string | null>;
  readonly override: string | null;
};

type FileEdges = {
  readonly edges: ModuleEdge[];
  readonly candidates: number;
  readonly unresolved: number;
};

function buildGraph(input: ModuleGraphRunnerInput): ModuleGraphResult {
  const repoRoot = path.resolve(input.repoRoot);
  const files = walkAbsoluteSourceFiles({ ...input, repoRoot });
  const state: GraphBuildState = {
    repoRoot,
    fileSet: new Set(files.map((abs) => toPosix(path.relative(repoRoot, abs)))),
    host: tsSysModuleResolutionHost(repoRoot),
    cache: ts.createModuleResolutionCache(repoRoot, (value) => value),
    tsconfigs: new Map(),
    tsconfigForDir: new Map(),
    override: resolveOverridePath(repoRoot, input.tsconfigOverride),
  };
  if (state.override !== null) {
    const loaded = loadTsconfig(state.override, state.tsconfigs);
    if (loaded.kind !== "loaded") {
      return {
        ok: false,
        code: "no-target-config",
        reason: explicitTsconfigSkipReason(input.tsconfigOverride ?? state.override, loaded),
      };
    }
  }

  const edges = new Map<string, readonly ModuleEdge[]>();
  let candidateCount = 0;
  let unresolvedCount = 0;
  for (const absFile of files) {
    const result = collectFileEdges(absFile, state);
    edges.set(toPosix(path.relative(repoRoot, absFile)), result.edges);
    candidateCount += result.candidates;
    unresolvedCount += result.unresolved;
  }

  return {
    ok: true,
    graph: {
      edges,
      candidateCount,
      unresolvedCount,
      fileCount: files.length,
      tsconfigCount: loadedTsconfigCount(state.tsconfigs),
    },
  };
}

function collectFileEdges(absFile: string, state: GraphBuildState): FileEdges {
  const { options, aliasHeads } = resolveContextFor(absFile, state);
  const out = new Map<string, ModuleEdge>();
  let candidates = 0;
  let unresolved = 0;
  for (const ref of extractSpecifiers(absFile)) {
    const candidate = isResolutionCandidate(ref.specifier, aliasHeads);
    if (candidate) candidates += 1;
    const resolution = resolveSpecifier(ref.specifier, absFile, options, state);
    if (resolution.kind === "edge") {
      mergeEdge(out, resolution.to, ref.typeOnly);
    } else if (resolution.kind === "unresolved" && candidate) {
      // Only a genuine resolution FAILURE counts toward partiality. A specifier
      // that resolved fine but landed outside the graph (node_modules, a .d.ts, or
      // a repo file outside the walked set) is external, not a broken graph — so
      // a broad `paths: { "*": [...] }` alias can't inflate the ratio with installed
      // externals like `react` and falsely trip resolution-too-partial.
      unresolved += 1;
    }
  }
  return { edges: [...out.values()], candidates, unresolved };
}

// An edge is type-only only if EVERY import of `to` from this file is type-only;
// a single runtime import makes the merged edge a runtime edge.
function mergeEdge(out: Map<string, ModuleEdge>, to: string, typeOnly: boolean): void {
  const prior = out.get(to);
  out.set(to, { to, typeOnly: prior === undefined ? typeOnly : prior.typeOnly && typeOnly });
}

function resolveContextFor(
  absFile: string,
  state: GraphBuildState,
): { readonly options: ts.CompilerOptions; readonly aliasHeads: readonly AliasHead[] } {
  const tsconfigPath =
    state.override ?? nearestTsconfig(path.dirname(absFile), state.repoRoot, state.tsconfigForDir);
  const resolved = tsconfigPath === null ? null : loadTsconfig(tsconfigPath, state.tsconfigs);
  if (resolved?.kind !== "loaded") return { options: {}, aliasHeads: [] };
  return { options: resolved.config.options, aliasHeads: resolved.config.aliasHeads };
}

function resolveOverridePath(repoRoot: string, override: string | null): string | null {
  if (override === null) return null;
  return path.isAbsolute(override) ? override : path.resolve(repoRoot, override);
}

// The three outcomes of resolving one specifier, kept distinct so the partiality
// metric counts only true failures:
//   - `edge`       resolved to an analyzable repo file inside the walked set;
//   - `external`   resolved fine, but outside the graph (node_modules, a .d.ts, or
//                  a repo file outside the walked set) — not a failure;
//   - `unresolved` resolveModuleName found nothing — a genuine resolution failure.
type SpecifierResolution =
  | { readonly kind: "edge"; readonly to: string }
  | { readonly kind: "external" }
  | { readonly kind: "unresolved" };

function resolveSpecifier(
  specifier: string,
  containingFile: string,
  options: ts.CompilerOptions,
  state: GraphBuildState,
): SpecifierResolution {
  const result = ts.resolveModuleName(specifier, containingFile, options, state.host, state.cache);
  const resolvedFileName = result.resolvedModule?.resolvedFileName;
  if (resolvedFileName === undefined) return { kind: "unresolved" };
  if (resolvedFileName.includes("/node_modules/")) return { kind: "external" };
  if (resolvedFileName.endsWith(".d.ts")) return { kind: "external" };
  const relative = path.relative(state.repoRoot, resolvedFileName);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return { kind: "external" };
  const to = toPosix(relative);
  // Resolved to a real repo file, but one outside the analyzed roots — still a
  // successful resolution, just not an in-graph edge.
  if (!state.fileSet.has(to)) return { kind: "external" };
  return { kind: "edge", to };
}

// A specifier we expect to resolve to a repo file: a relative import, or one that
// matches a tsconfig path-alias head. Bare external (npm / workspace-package)
// specifiers are excluded so they don't inflate the partiality denominator.
function isResolutionCandidate(spec: string, aliasHeads: readonly AliasHead[]): boolean {
  if (spec.startsWith(".")) return true;
  return aliasHeads.some((alias) =>
    alias.exact ? spec === alias.head : alias.head.length === 0 || spec.startsWith(alias.head),
  );
}

// Parse one file (no type-check) and hand classification to the shared kernel:
// scripts/lib/ts-module-refs.ts owns what counts as a runtime import edge.
// Reading, scriptKind selection, and parsing stay here — per-stack policy.
function extractSpecifiers(absFile: string): readonly ModuleRef[] {
  const text = readFileSync(absFile, "utf8");
  const scriptKind =
    absFile.endsWith(".tsx") || absFile.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(absFile, text, ts.ScriptTarget.Latest, false, scriptKind);
  return extractModuleRefs(source);
}

// --- tsconfig discovery + parsing -------------------------------------------

function nearestTsconfig(
  startDir: string,
  repoRoot: string,
  cache: Map<string, string | null>,
): string | null {
  const cached = cache.get(startDir);
  if (cached !== undefined) return cached;
  let dir = startDir;
  let found: string | null = null;
  for (;;) {
    const candidate = path.join(dir, "tsconfig.json");
    if (existsSync(candidate)) {
      found = candidate;
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir || dir === repoRoot) break;
    dir = parent;
  }
  cache.set(startDir, found);
  return found;
}
