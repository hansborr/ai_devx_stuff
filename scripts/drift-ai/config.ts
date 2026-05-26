import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { cloneDefaultConfig, normalizeRepoPath, parseDriftAiConfig } from "./config-parsing.js";
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
};

export type GhostFileAllowedPair = {
  readonly files: readonly [string, string];
};

export type DriftAiChecksConfig = {
  readonly duplicates: DriftAiDuplicatesConfig;
  readonly comments: DriftAiCommentsConfig;
  readonly "ghost-files": DriftAiGhostFilesConfig;
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
    return { config: cloneDefaultConfig(), configPath: null };
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

export function pathHasAnySegment(filePath: string, segments: ReadonlySet<string>): boolean {
  return normalizeRepoPath(filePath)
    .split("/")
    .some((segment) => segments.has(segment));
}

export function pathHasAnyPrefix(filePath: string, prefixes: readonly string[]): boolean {
  const normalized = normalizeRepoPath(filePath);
  return prefixes.some((prefix) => normalized.startsWith(prefix));
}

export function matchesAnyGlob(filePath: string, globs: readonly string[]): boolean {
  if (globs.length === 0) return false;
  const normalized = normalizeRepoPath(filePath);
  return globs.some((glob) => globToRegExp(glob).test(normalized));
}

export function globsForIgnoredPaths(ignore: DriftAiIgnoreConfig): string[] {
  return uniqSorted([
    ...ignore.segments.map((segment) => `**/${segment}/**`),
    ...ignore.prefixes.map((prefix) => `${prefix.endsWith("/") ? prefix : `${prefix}/`}**`),
    ...ignore.globs,
  ]);
}

function globToRegExp(glob: string): RegExp {
  let out = "^";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    const next = glob[index + 1];
    if (char === "*" && next === "*") {
      const after = glob[index + 2];
      if (after === "/") {
        out += "(?:.*/)?";
        index += 2;
      } else {
        out += ".*";
        index += 1;
      }
      continue;
    }
    if (char === "*") {
      out += "[^/]*";
      continue;
    }
    if (char === "?") {
      out += "[^/]";
      continue;
    }
    out += escapeRegExp(char ?? "");
  }
  out += "$";
  return new RegExp(out, "u");
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.]/gu, "\\$&");
}

function uniqSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, "en"));
}
