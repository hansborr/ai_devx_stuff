// Module-graph builder for the import-cycles adapter: the injected I/O seam that
// owns all ts-morph / TypeScript-compiler work (filesystem walk, per-file nearest
// tsconfig resolution, import/export/dynamic-import extraction, module resolution).
// Cycle detection and check integration are pure and live in import-cycles.ts.
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

export type ModuleGraphRunnerInput = {
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

// Placeholder used when import-cycles is not selected (so we never walk the tree
// or load tsconfigs on an unrelated run). The check is excluded from the enabled
// set in that case, so this is never actually invoked; it fails loudly if it is.
export function unresolvedModuleGraphRunner(error: string): ModuleGraphRunner {
  return () => ({ ok: false, error });
}

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
    host: moduleResolutionHost(repoRoot),
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
  for (const spec of extractSpecifiers(absFile)) {
    const candidate = isResolutionCandidate(spec.text, aliasHeads);
    if (candidate) candidates += 1;
    const resolution = resolveSpecifier(spec, absFile, options, state);
    if (resolution.kind === "edge") {
      mergeEdge(out, resolution.to, spec.typeOnly);
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
  spec: Specifier,
  containingFile: string,
  options: ts.CompilerOptions,
  state: GraphBuildState,
): SpecifierResolution {
  const result = ts.resolveModuleName(spec.text, containingFile, options, state.host, state.cache);
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

type Specifier = { readonly text: string; readonly typeOnly: boolean };

// Extract top-level import/export-from specifiers + dynamic import() calls from a
// file's AST (no type-check). `import type` / `export type` and type-only named
// bindings are flagged so the cycle classifier can tell a runtime edge from one
// that exists only in the type system.
function extractSpecifiers(absFile: string): Specifier[] {
  const text = readFileSync(absFile, "utf8");
  const scriptKind =
    absFile.endsWith(".tsx") || absFile.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(absFile, text, ts.ScriptTarget.Latest, false, scriptKind);
  const out: Specifier[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && isStringLiteralLike(node.moduleSpecifier)) {
      out.push({ text: node.moduleSpecifier.text, typeOnly: isImportTypeOnly(node) });
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      isStringLiteralLike(node.moduleSpecifier)
    ) {
      out.push({ text: node.moduleSpecifier.text, typeOnly: isExportTypeOnly(node) });
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 &&
      isStringLiteralLike(node.arguments[0])
    ) {
      // Dynamic import() is always a runtime edge.
      out.push({ text: node.arguments[0].text, typeOnly: false });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

function isStringLiteralLike(node: ts.Node | undefined): node is ts.StringLiteralLike {
  return (
    node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
  );
}

// `import type ...` (whole-clause) or `import { type a, type b }` (every binding
// type-only) is a type-only edge. A default/namespace import or any value binding
// makes it a runtime edge.
function isImportTypeOnly(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (clause === undefined) return false; // bare `import "x"` side-effect import
  if (clause.phaseModifier === ts.SyntaxKind.TypeKeyword) return true; // `import type ...`
  if (clause.name !== undefined) return false; // default import is a value binding
  const bindings = clause.namedBindings;
  if (bindings === undefined) return false;
  if (ts.isNamespaceImport(bindings)) return false;
  if (bindings.elements.length === 0) return false;
  return bindings.elements.every((element) => element.isTypeOnly);
}

function isExportTypeOnly(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return true;
  const clause = node.exportClause;
  if (clause === undefined) return false; // `export * from` re-exports values
  if (!ts.isNamedExports(clause)) return false;
  if (clause.elements.length === 0) return false;
  return clause.elements.every((element) => element.isTypeOnly);
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

// realpath is intentionally omitted: it only canonicalizes symlinks, which for our
// graph would only matter inside node_modules (skipped). Source-tree resolution
// stays consistent because we always relativize against the same repoRoot.
function moduleResolutionHost(repoRoot: string): ts.ModuleResolutionHost {
  return {
    fileExists: (file) => ts.sys.fileExists(file),
    readFile: (file) => ts.sys.readFile(file),
    directoryExists: (dir) => ts.sys.directoryExists(dir),
    getCurrentDirectory: () => repoRoot,
    getDirectories: (dir) => ts.sys.getDirectories(dir),
  };
}
