import type { PathProbe } from "./adapter-support.js";
import type { FileReader } from "./comments.js";
import type { DriftAiConfig } from "./config.js";
import type { JscpdRunner } from "./duplicates-runner.js";
import type { DirectoryListing } from "./ghost-files.js";
import type { GitRunner } from "./git-changed-scope.js";
import type { ModuleGraphRunner } from "./import-cycles-graph.js";
import type { KnipRunner } from "./knip-runner.js";
import type { NearDuplicateRunner } from "./near-duplicates-runner.js";
import type { DetectorScope } from "./scope.js";
import type { SuppressionsGitRunner } from "./suppressions.js";
import type { CliOptions, DriftCheckId, DriftFinding, SkipReasonCode } from "./types.js";

export type CheckOutcome =
  | { readonly status: "ran"; readonly findings: readonly DriftFinding[] }
  | { readonly status: "skipped"; readonly reason: string; readonly code?: SkipReasonCode };

// The injectable runner seam every check resolves its services from. Tests and
// `runDriftAi` callers override these; production plugins fall back to their own
// default factories. This is the only surface that grows when a new adapter adds
// a dependency — the per-check run context (`CheckRunContext`) does not.
export type CheckOverrides = {
  readonly jscpd?: JscpdRunner;
  readonly knip?: KnipRunner;
  readonly moduleGraph?: ModuleGraphRunner;
  readonly nearDuplicates?: NearDuplicateRunner;
  readonly listDirectory?: DirectoryListing;
  readonly readFile?: FileReader;
  readonly suppressionsGit?: SuppressionsGitRunner;
  readonly git?: GitRunner;
  readonly pathExists?: PathProbe;
  // Absolute-path existence probe for external-tool executable resolution
  // (jscpd/knip bin lookup). Overridable so tool-unavailable paths are testable
  // without depending on the tools checkout's installed binaries.
  readonly binExists?: (absolutePath: string) => boolean;
};

// What a plugin reads to resolve its own services (plugin-owned setup hook input).
// Small and stable: a new check reads what it needs from `overrides`/`cli` without
// adding fields here.
export type CheckServiceEnv = {
  readonly repoRoot: string;
  readonly overrides: CheckOverrides;
  readonly cli: CliOptions;
  readonly reportCache?: Map<string, unknown>;
};

// Common run state shared by every check, independent of any adapter. Kept central
// on purpose (the plan's "keep common run state central").
export type CheckRunState = {
  readonly detectorScope: DetectorScope;
  readonly inventoryByDir: ReadonlyMap<string, readonly string[]> | null;
  readonly repoRoot: string;
  readonly suppressionDiffRef: string | null;
  readonly config: DriftAiConfig;
  readonly roots: readonly string[];
  readonly sourceExtensions: ReadonlySet<string>;
  readonly warnStderr: (message: string) => void;
};

// What `buildReport` receives: common run state plus the service-resolution env.
// Services are resolved per-plugin inside `runWithSelectedConfig`, so this stays
// adapter-agnostic.
export type CheckRunInput = CheckRunState & {
  readonly env: CheckServiceEnv;
};

// What a check's `run`/`preflight` receive: common run state plus the services this
// check resolved for itself. `S` is the plugin's own service shape.
export type CheckRunContext<S = unknown> = CheckRunState & {
  readonly services: S;
};

// A preflight that decides to skip may return a bare human reason, or a reason
// paired with a machine-readable code (adapter contract §4 — adapters carry one).
export type PreflightSkip = { readonly reason: string; readonly code?: SkipReasonCode };

// The runtime-free metadata + config surface a check contributes: its identity,
// CLI usage token, default-set membership, and config parse/select/default logic.
// A check's `*-check-config.ts` owns this object; it is consumed by BOTH the
// lightweight metadata registry (`check-metadata.ts` — check enumeration, config
// parsing, default config) and the runtime plugin (`*-check.ts`). Keeping it free
// of runtime-adapter imports lets config/CLI code list checks and parse config
// without loading the tool runners / graph builders.
export type CheckConfigMetadata<C, Id extends DriftCheckId = DriftCheckId> = {
  readonly id: Id;
  readonly usage: string;
  readonly defaultConfig: C;
  readonly parseConfig: (raw: unknown, keyPath: string) => C;
  readonly selectConfig: (config: DriftAiConfig) => C;
  // Opt-out of the no-`--check` default set (still runs under `--check all` or
  // explicit `--check <id>`). Used by tool-backed adapters whose engine analyzes
  // the whole project graph on every run, so they should not slow the routine
  // changed-scope run. Treated as true when omitted.
  readonly runByDefault?: boolean;
};

export type CheckPluginDefinition<
  C,
  S,
  Id extends DriftCheckId = DriftCheckId,
> = CheckConfigMetadata<C, Id> & {
  // Plugin-owned setup hook: resolve this check's adapter-specific services from
  // the run env. Called lazily — only for a SELECTED check, and only when the
  // check is actually about to run — so an unselected check never pays for
  // expensive resolution (spawning/locating a tool, building a graph).
  readonly resolveServices: (env: CheckServiceEnv) => S;
  readonly preflight?: (ctx: CheckRunContext<S>, config: C) => PreflightSkip | string | undefined;
  readonly run: (ctx: CheckRunContext<S>, config: C) => CheckOutcome;
};

export type CheckPlugin<C, S, Id extends DriftCheckId = DriftCheckId> = CheckPluginDefinition<
  C,
  S,
  Id
> & {
  readonly runWithSelectedConfig: (input: CheckRunInput) => CheckOutcome;
};

export function defineCheckPlugin<C, S, Id extends DriftCheckId>(
  plugin: CheckPluginDefinition<C, S, Id>,
): CheckPlugin<C, S, Id> {
  return {
    ...plugin,
    runWithSelectedConfig: (input) => {
      const config = plugin.selectConfig(input.config);
      const { env, ...state } = input;
      const services = plugin.resolveServices(env);
      const ctx: CheckRunContext<S> = { ...state, services };
      const preflight = plugin.preflight?.(ctx, config);
      if (preflight !== undefined) return skipFromPreflight(preflight);
      // No try/catch: adapters model every expected tool/config failure as a
      // `skipped` outcome or a diagnostic finding, so anything `plugin.run`
      // throws is an unexpected detector bug. Let it propagate (runner.ts maps
      // sentinel errors to exit codes; anything else crashes loudly) rather than
      // masking it as an expected skip.
      return plugin.run(ctx, config);
    },
  };
}

function skipFromPreflight(preflight: PreflightSkip | string): CheckOutcome {
  if (typeof preflight === "string") return { status: "skipped", reason: preflight };
  return {
    status: "skipped",
    reason: preflight.reason,
    ...(preflight.code === undefined ? {} : { code: preflight.code }),
  };
}
