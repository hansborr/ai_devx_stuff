import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { makeDefaultDriftAiConfig, parseDriftAiConfig } from "./config-parsing.js";
export {
  globsForIgnoredPaths,
  matchesAnyGlob,
  pathHasAnyPrefix,
  pathHasAnySegment,
} from "./config-match.js";
export {
  collapseRepoPath,
  DEFAULT_DRIFT_AI_CONFIG,
  normalizeRepoPath,
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
  readonly excludeGlobs: readonly string[];
};

export type DriftAiCommentsConfig = {
  readonly excludePrefixes: readonly string[];
};

export type DriftAiGhostFilesConfig = {
  readonly excludeGlobs: readonly string[];
  readonly currentAllowedPairs: readonly GhostFileAllowedPair[];
  readonly weakTokens: readonly string[];
  readonly entryPointStems: readonly string[];
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

export type GhostFileAllowedPair = {
  readonly files: readonly [string, string];
};

export type DriftAiChecksConfig = {
  readonly duplicates: DriftAiDuplicatesConfig;
  readonly comments: DriftAiCommentsConfig;
  readonly "ghost-files": DriftAiGhostFilesConfig;
  readonly suppressions: Record<string, never>;
  // Tier-1 pass-through over the target's own knip; the verdict and its scoping
  // come from the target's knip config, so the drift-side check takes no options.
  readonly "orphan-files": Record<string, never>;
  // Config-honoring structural adapter over the target's tsconfig (it honors the
  // target's path aliases for resolution), but cycles are verdict-free, so the
  // drift-side check takes no options.
  readonly "import-cycles": Record<string, never>;
  // Measurement-ish adapter over drift:ai-authored function-similarity
  // thresholds. Findings carry `drift-baseline` provenance.
  readonly "near-duplicates": DriftAiNearDuplicatesConfig;
};

export type DriftAiConfig = {
  readonly roots: readonly string[];
  readonly additionalSourceExtensions: readonly string[];
  readonly ignore: DriftAiIgnoreConfig;
  readonly checks: DriftAiChecksConfig;
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
