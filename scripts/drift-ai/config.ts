import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { makeDefaultDriftAiConfig, parseDriftAiConfig } from "./config-parsing.js";
import type { EnvDefineMatrix } from "./env-define-types.js";
export {
  collapseRepoPath,
  DEFAULT_DRIFT_AI_CONFIG,
  parseDriftAiConfig,
  pathEscapesRepo,
} from "./config-parsing.js";
import { DriftAiError } from "./errors.js";

export type DriftAiIgnoreConfig = {
  readonly segments: readonly string[];
  readonly prefixes: readonly string[];
  readonly globs: readonly string[];
};

export type DriftAiDuplicatesConfig = {
  readonly minLines?: number;
  readonly minTokens?: number;
  readonly mode?: "mild" | "weak";
  readonly excludeGlobs: readonly string[];
};

export type DriftAiCommentsConfig = {
  readonly excludePrefixes: readonly string[];
};

// commented-out-code: a run of at least `minLines` consecutive pure-comment lines
// whose stripped text parses cleanly as operative code is flagged. `excludePrefixes`
// drops whole path prefixes (e.g. a generated dir) from the scan.
export type DriftAiCommentedOutCodeConfig = {
  readonly minLines: number;
  readonly excludePrefixes: readonly string[];
};

// module-doc-paths: `excludeGlobs` skips whole MODULE.md docs from the scan (the
// escape hatch for a doc whose path-reference style the resolver cannot follow).
export type DriftAiModuleDocPathsConfig = {
  readonly excludeGlobs: readonly string[];
};

export type DriftAiGhostFilesConfig = {
  readonly excludeGlobs: readonly string[];
  readonly currentAllowedPairs: readonly GhostFileAllowedPair[];
  readonly weakTokens: readonly string[];
  readonly entryPointStems: readonly string[];
  // Current-scope only: weak tokens whose difference marks an intentional role
  // split (e.g. a `foo-types.ts`/`foo-schema.ts` companion, or parallel
  // `duplicate-schemas`/`duplicate-types` detectors) rather than a ghost sibling.
  // Such current-state pairs are suppressed; changed scope still reports a freshly
  // added companion.
  readonly roleMarkerTokens: readonly string[];
  // Optional override for the ghost-files FIX hint's "find dependents" template
  // (a `{path}` placeholder is substituted with each file path). Absent means the
  // repo-agnostic DEFAULT_DEPENDENTS_HINT is used. Lets a repo wire in its own
  // tooling without baking a Musi command into the portable default.
  readonly dependentsHint?: string;
};

export type DriftAiNearDuplicatesConfig = {
  readonly engine: "ts-morph" | "similarity-ts";
  readonly minLines: number;
  readonly minTokens: number;
  readonly similarityThreshold: number;
  readonly tokenBandRatio: number;
  readonly excludeGlobs: readonly string[];
};

// duplicate-types: minimum prop count below which an interface/type-literal shape
// is too trivial to report (a noise filter, not adjudication).
export type DriftAiDuplicateTypesConfig = {
  readonly minProps: number;
  readonly excludeGlobs: readonly string[];
};

// duplicate-schemas: minimum key count below which a normalized z.object schema is
// too trivial to report.
export type DriftAiDuplicateSchemasConfig = {
  readonly minKeys: number;
  readonly excludeGlobs: readonly string[];
};

// duplicate-literals: a literal must appear in at least `minDistinctFiles` files.
// Strings must be at least `minLength` chars. Raw numeric literals are skipped
// unless `includeNumbers` is true, and then must satisfy `minNumberDigits`.
// `skipTestTitleStrings` drops literals in test-title call positions
// (describe/it/test) — all noise filters.
export type DriftAiDuplicateLiteralsConfig = {
  readonly minDistinctFiles: number;
  readonly minLength: number;
  readonly includeNumbers: boolean;
  readonly minNumberDigits: number;
  readonly skipTestTitleStrings: boolean;
  readonly excludeGlobs: readonly string[];
};

// duplicate-constants: a module-level `const` initialized to the same non-trivial
// literal value across at least `minDistinctFiles` files (a missed shared
// constant). `minLength` applies the same trivial-string filter as literals, and
// `minNumberDigits` filters trivial numeric constants.
export type DriftAiDuplicateConstantsConfig = {
  readonly minDistinctFiles: number;
  readonly minLength: number;
  readonly minNumberDigits: number;
  readonly excludeGlobs: readonly string[];
};

export type GhostFileAllowedPair = {
  readonly files: readonly [string, string];
};

// coverage: opt-in artifact-source declarations for the coverage evidence layer
// (tasks 42a-42c). Each artifact is a path to a coverage report (resolved
// relative to the repo root) plus a free-text label such as unit/e2e/smoke/prod.
// Task 42a only parses these into structured evidence; no check, subcommand, or
// advisory output reads them yet. This is top-level config, not a `checks` entry,
// because coverage is an evidence source rather than a finding-producing check.
export type DriftAiCoverageArtifactConfig = {
  readonly path: string;
  readonly label: string;
};

export type DriftAiCoverageConfig = {
  readonly artifacts: readonly DriftAiCoverageArtifactConfig[];
};

// envDefine: opt-in, deployment-specific assumed values for env/define reads,
// consumed by the prototype `env-branches` advisory (tasks 43a-43). Each table
// maps a key to an assumed value plus a free-text `source` describing where the
// value comes from (e.g. "prod deploy", "vite define"). Provider-specific tables
// (processEnv/importMetaEnv/bunEnv) override the provider-agnostic `env` fallback;
// `defines` covers bundler-defined constants. Report-only and never inferred from
// deployment defaults, so an unlisted key stays "unknown" rather than guessed.
// This is top-level config, not a `checks` entry, because it is an evidence source
// (an assumed-value matrix) for an advisory subcommand, not a finding-producing
// check. The shape is the task-43a `EnvDefineMatrix`; after parsing, every
// assumption carries a normalized `source`.
export type DriftAiEnvDefineConfig = EnvDefineMatrix;

export type DriftAiChecksConfig = {
  readonly duplicates: DriftAiDuplicatesConfig;
  readonly comments: DriftAiCommentsConfig;
  // Opt-in refactor-residue sensor for tombstoned code blocks left in comments
  // (distinct from the `comments` ratio sensor); drift:ai's own analysis,
  // report-only.
  readonly "commented-out-code": DriftAiCommentedOutCodeConfig;
  readonly "ghost-files": DriftAiGhostFilesConfig;
  readonly suppressions: Record<string, never>;
  // Opt-in MODULE.md backtick file-path freshness sensor (drift:ai's own analysis;
  // report-only, path existence across candidate bases).
  readonly "module-doc-paths": DriftAiModuleDocPathsConfig;
  // Tier-1 pass-through over the target's own knip; the verdict and its scoping
  // come from the target's knip config, so the drift-side check takes no options.
  readonly "orphan-files": Record<string, never>;
  // Tier-1 pass-through over knip's duplicate export aliases category. Kept
  // separate from drift's jscpd-backed `duplicates` source-clone check.
  readonly "knip-duplicates": Record<string, never>;
  // Config-honoring structural adapter over the target's tsconfig (it honors the
  // target's path aliases for resolution), but cycles are verdict-free, so the
  // drift-side check takes no options.
  readonly "import-cycles": Record<string, never>;
  // Opt-in advisory server layer-direction sensor over the same resolved module
  // graph. It starts with two Musi server rules and carries drift-baseline
  // provenance, so the drift-side check takes no options.
  readonly "layer-direction": Record<string, never>;
  // Measurement-ish adapter over drift:ai-authored function-similarity
  // thresholds. Findings carry `drift-baseline` provenance.
  readonly "near-duplicates": DriftAiNearDuplicatesConfig;
  // Exact structural-hash analyzers over non-function shapes (drift:ai's own
  // structural analysis; findings carry `drift-baseline` provenance).
  readonly "duplicate-types": DriftAiDuplicateTypesConfig;
  readonly "duplicate-schemas": DriftAiDuplicateSchemasConfig;
  readonly "duplicate-literals": DriftAiDuplicateLiteralsConfig;
  readonly "duplicate-constants": DriftAiDuplicateConstantsConfig;
  // Tier-1 pass-through over the target's own knip, surfacing the symbol-level
  // reachability categories orphan-files leaves alone (exports/types/enum &
  // namespace members). The verdict and its scoping come from the target's knip
  // config, so the drift-side check takes no options.
  readonly "unused-exports": Record<string, never>;
};

export type DriftAiConfig = {
  readonly roots: readonly string[];
  readonly additionalSourceExtensions: readonly string[];
  readonly ignore: DriftAiIgnoreConfig;
  readonly checks: DriftAiChecksConfig;
  readonly coverage: DriftAiCoverageConfig;
  readonly envDefine: DriftAiEnvDefineConfig;
};

export type LoadedDriftAiConfig = {
  readonly config: DriftAiConfig;
  readonly configPath: string | null;
};

const AUTO_CONFIG_FILENAME = "drift-ai.config.json";

export type LoadDriftAiConfigOptions = {
  readonly repoRoot: string;
  readonly configPath?: string;
};

export function loadDriftAiConfig(options: LoadDriftAiConfigOptions): LoadedDriftAiConfig {
  const explicit = options.configPath !== undefined;
  const target = explicit
    ? path.resolve(process.cwd(), options.configPath)
    : path.join(options.repoRoot, AUTO_CONFIG_FILENAME);
  const displayPath = explicit ? options.configPath : AUTO_CONFIG_FILENAME;

  if (!existsSync(target)) {
    if (explicit) {
      throw new DriftAiError(`drift:ai config '${options.configPath}' does not exist.`);
    }
    return { config: makeDefaultDriftAiConfig(), configPath: null };
  }

  let text: string;
  try {
    text = readFileSync(target, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new DriftAiError(`drift:ai config '${displayPath}' could not be read: ${message}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new DriftAiError(`drift:ai config '${displayPath}' is not valid JSON: ${message}`);
  }

  return {
    config: parseDriftAiConfig(raw, displayPath),
    configPath: displayPath,
  };
}
