import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { DriftAiError } from "./errors.js";

const AUTO_CONFIG_FILENAME = "drift-ai.config.json";

export type DriftAiIgnoreConfig = {
  readonly segments: readonly string[];
  readonly prefixes: readonly string[];
  readonly globs: readonly string[];
};

type DriftAiDuplicatesConfig = {
  readonly minLines?: number;
  readonly excludeGlobs: readonly string[];
};

type DriftAiCommentsConfig = {
  readonly excludePrefixes: readonly string[];
};

type DriftAiGhostFilesConfig = {
  readonly excludeGlobs: readonly string[];
  readonly currentAllowedPairs: readonly GhostFileAllowedPair[];
};

export type GhostFileAllowedPair = {
  readonly files: readonly [string, string];
};

type DriftAiChecksConfig = {
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

export const DEFAULT_DRIFT_AI_CONFIG: DriftAiConfig = {
  roots: [],
  additionalSourceExtensions: [],
  ignore: {
    segments: [
      "node_modules",
      "vendor",
      "dist",
      "build",
      "coverage",
      ".next",
      "out",
      "target",
      "reports",
      "tmp",
      "generated",
      ".git",
      ".husky",
    ],
    prefixes: [".claude/worktrees/"],
    globs: [],
  },
  checks: {
    duplicates: { excludeGlobs: [] },
    comments: { excludePrefixes: [] },
    "ghost-files": { excludeGlobs: [], currentAllowedPairs: [] },
  },
};

type UnknownRecord = Record<string, unknown>;

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

export function parseDriftAiConfig(raw: unknown, displayPath = "config"): DriftAiConfig {
  if (!isRecord(raw)) {
    throw new DriftAiError(`drift:ai config '${displayPath}' must be a JSON object.`);
  }
  assertKnownKeys(raw, ["roots", "additionalSourceExtensions", "ignore", "checks"], displayPath);

  let config = cloneDefaultConfig();
  if (raw["roots"] !== undefined) {
    config = {
      ...config,
      roots: readStringArray(raw["roots"], `${displayPath}.roots`).map(normalizeRoot),
    };
  }
  if (raw["additionalSourceExtensions"] !== undefined) {
    config = {
      ...config,
      additionalSourceExtensions: uniqSorted(
        readStringArray(
          raw["additionalSourceExtensions"],
          `${displayPath}.additionalSourceExtensions`,
        ).map((value) => normalizeExtension(value, `${displayPath}.additionalSourceExtensions`)),
      ),
    };
  }
  if (raw["ignore"] !== undefined) {
    config = {
      ...config,
      ignore: parseIgnoreConfig(raw["ignore"], `${displayPath}.ignore`, config.ignore),
    };
  }
  if (raw["checks"] !== undefined) {
    config = {
      ...config,
      checks: parseChecksConfig(raw["checks"], `${displayPath}.checks`, config.checks),
    };
  }
  return config;
}

function parseIgnoreConfig(
  raw: unknown,
  keyPath: string,
  defaults: DriftAiIgnoreConfig,
): DriftAiIgnoreConfig {
  if (!isRecord(raw)) throw new DriftAiError(`drift:ai config '${keyPath}' must be an object.`);
  assertKnownKeys(raw, ["segments", "prefixes", "globs"], keyPath);
  return {
    segments:
      raw["segments"] === undefined
        ? defaults.segments
        : uniqSorted([
            ...defaults.segments,
            ...readStringArray(raw["segments"], `${keyPath}.segments`).map(normalizeSegment),
          ]),
    prefixes:
      raw["prefixes"] === undefined
        ? defaults.prefixes
        : uniqSorted([
            ...defaults.prefixes,
            ...readStringArray(raw["prefixes"], `${keyPath}.prefixes`).map(normalizePrefix),
          ]),
    globs:
      raw["globs"] === undefined
        ? defaults.globs
        : uniqSorted([
            ...defaults.globs,
            ...readStringArray(raw["globs"], `${keyPath}.globs`).map(normalizeGlob),
          ]),
  };
}

function parseChecksConfig(
  raw: unknown,
  keyPath: string,
  defaults: DriftAiChecksConfig,
): DriftAiChecksConfig {
  if (!isRecord(raw)) throw new DriftAiError(`drift:ai config '${keyPath}' must be an object.`);
  assertKnownKeys(raw, ["duplicates", "comments", "ghost-files"], keyPath);
  return {
    duplicates:
      raw["duplicates"] === undefined
        ? defaults.duplicates
        : parseDuplicatesConfig(raw["duplicates"], `${keyPath}.duplicates`, defaults.duplicates),
    comments:
      raw["comments"] === undefined
        ? defaults.comments
        : parseCommentsConfig(raw["comments"], `${keyPath}.comments`, defaults.comments),
    "ghost-files":
      raw["ghost-files"] === undefined
        ? defaults["ghost-files"]
        : parseGhostFilesConfig(
            raw["ghost-files"],
            `${keyPath}.ghost-files`,
            defaults["ghost-files"],
          ),
  };
}

function parseDuplicatesConfig(
  raw: unknown,
  keyPath: string,
  defaults: DriftAiDuplicatesConfig,
): DriftAiDuplicatesConfig {
  if (!isRecord(raw)) throw new DriftAiError(`drift:ai config '${keyPath}' must be an object.`);
  assertKnownKeys(raw, ["minLines", "excludeGlobs"], keyPath);
  const minLines =
    raw["minLines"] === undefined
      ? defaults.minLines
      : parsePositiveInt(raw["minLines"], `${keyPath}.minLines`);
  return {
    ...(minLines === undefined ? {} : { minLines }),
    excludeGlobs:
      raw["excludeGlobs"] === undefined
        ? defaults.excludeGlobs
        : uniqSorted([
            ...defaults.excludeGlobs,
            ...readStringArray(raw["excludeGlobs"], `${keyPath}.excludeGlobs`).map(normalizeGlob),
          ]),
  };
}

function parseCommentsConfig(
  raw: unknown,
  keyPath: string,
  defaults: DriftAiCommentsConfig,
): DriftAiCommentsConfig {
  if (!isRecord(raw)) throw new DriftAiError(`drift:ai config '${keyPath}' must be an object.`);
  assertKnownKeys(raw, ["excludePrefixes"], keyPath);
  return {
    excludePrefixes:
      raw["excludePrefixes"] === undefined
        ? defaults.excludePrefixes
        : uniqSorted([
            ...defaults.excludePrefixes,
            ...readStringArray(raw["excludePrefixes"], `${keyPath}.excludePrefixes`).map(
              normalizePrefix,
            ),
          ]),
  };
}

function parseGhostFilesConfig(
  raw: unknown,
  keyPath: string,
  defaults: DriftAiGhostFilesConfig,
): DriftAiGhostFilesConfig {
  if (!isRecord(raw)) throw new DriftAiError(`drift:ai config '${keyPath}' must be an object.`);
  assertKnownKeys(raw, ["excludeGlobs", "currentAllowedPairs"], keyPath);
  return {
    excludeGlobs:
      raw["excludeGlobs"] === undefined
        ? defaults.excludeGlobs
        : uniqSorted([
            ...defaults.excludeGlobs,
            ...readStringArray(raw["excludeGlobs"], `${keyPath}.excludeGlobs`).map(normalizeGlob),
          ]),
    currentAllowedPairs:
      raw["currentAllowedPairs"] === undefined
        ? defaults.currentAllowedPairs
        : uniqAllowedPairs([
            ...defaults.currentAllowedPairs,
            ...readAllowedPairs(raw["currentAllowedPairs"], `${keyPath}.currentAllowedPairs`),
          ]),
  };
}

function cloneDefaultConfig(): DriftAiConfig {
  return {
    roots: [...DEFAULT_DRIFT_AI_CONFIG.roots],
    additionalSourceExtensions: [...DEFAULT_DRIFT_AI_CONFIG.additionalSourceExtensions],
    ignore: {
      segments: [...DEFAULT_DRIFT_AI_CONFIG.ignore.segments],
      prefixes: [...DEFAULT_DRIFT_AI_CONFIG.ignore.prefixes],
      globs: [...DEFAULT_DRIFT_AI_CONFIG.ignore.globs],
    },
    checks: {
      duplicates: {
        ...DEFAULT_DRIFT_AI_CONFIG.checks.duplicates,
        excludeGlobs: [...DEFAULT_DRIFT_AI_CONFIG.checks.duplicates.excludeGlobs],
      },
      comments: {
        excludePrefixes: [...DEFAULT_DRIFT_AI_CONFIG.checks.comments.excludePrefixes],
      },
      "ghost-files": {
        excludeGlobs: [...DEFAULT_DRIFT_AI_CONFIG.checks["ghost-files"].excludeGlobs],
        currentAllowedPairs: [...DEFAULT_DRIFT_AI_CONFIG.checks["ghost-files"].currentAllowedPairs],
      },
    },
  };
}

function assertKnownKeys(raw: UnknownRecord, allowed: readonly string[], keyPath: string): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(raw)) {
    if (!allowedSet.has(key)) {
      throw new DriftAiError(`drift:ai config '${keyPath}' has unknown key '${key}'.`);
    }
  }
}

function readStringArray(raw: unknown, keyPath: string): string[] {
  if (!Array.isArray(raw)) throw new DriftAiError(`drift:ai config '${keyPath}' must be an array.`);
  return raw.map((item, index) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new DriftAiError(`drift:ai config '${keyPath}[${index}]' must be a non-empty string.`);
    }
    return item;
  });
}

function readAllowedPairs(raw: unknown, keyPath: string): GhostFileAllowedPair[] {
  if (!Array.isArray(raw)) throw new DriftAiError(`drift:ai config '${keyPath}' must be an array.`);
  return raw.map((item, index) => readAllowedPair(item, `${keyPath}[${index}]`));
}

function readAllowedPair(raw: unknown, keyPath: string): GhostFileAllowedPair {
  if (!Array.isArray(raw) || raw.length !== 2) {
    throw new DriftAiError(`drift:ai config '${keyPath}' must be a two-path array.`);
  }
  const paths = raw.map((item, index) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new DriftAiError(`drift:ai config '${keyPath}[${index}]' must be a non-empty string.`);
    }
    return normalizePairPath(item, `${keyPath}[${index}]`);
  });
  const left = paths[0];
  const right = paths[1];
  if (left === undefined || right === undefined) {
    throw new DriftAiError(`drift:ai config '${keyPath}' must be a two-path array.`);
  }
  if (left === right) {
    throw new DriftAiError(`drift:ai config '${keyPath}' must contain two distinct paths.`);
  }
  return { files: left < right ? [left, right] : [right, left] };
}

function parsePositiveInt(raw: unknown, keyPath: string): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0) {
    throw new DriftAiError(`drift:ai config '${keyPath}' must be a positive integer.`);
  }
  return raw;
}

function normalizeRoot(value: string): string {
  const collapsed = collapseRepoPath(value);
  if (pathEscapesRepo(collapsed)) {
    throw new DriftAiError(`drift:ai config root '${value}' must stay inside the repo.`);
  }
  return collapsed;
}

function normalizeSegment(value: string): string {
  const trimmed = value.trim();
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    throw new DriftAiError(`drift:ai config ignore segment '${value}' must be one path segment.`);
  }
  return trimmed;
}

function normalizePrefix(value: string): string {
  let normalized = value.split(path.sep).join("/").trim();
  while (normalized.startsWith("./")) normalized = normalized.slice(2);
  if (normalized.length === 0) {
    throw new DriftAiError("drift:ai config ignore prefixes must not be empty.");
  }
  return normalized;
}

function normalizeGlob(value: string): string {
  const normalized = value.split(path.sep).join("/").trim();
  if (normalized.length === 0) {
    throw new DriftAiError("drift:ai config globs must not be empty.");
  }
  return normalized;
}

function normalizePairPath(value: string, keyPath: string): string {
  const collapsed = collapseRepoPath(value);
  if (pathEscapesRepo(collapsed)) {
    throw new DriftAiError(`drift:ai config '${keyPath}' must stay inside the repo.`);
  }
  return collapsed;
}

function normalizeExtension(value: string, keyPath: string): string {
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length <= 1 ||
    !normalized.startsWith(".") ||
    normalized.includes("/") ||
    normalized.includes("\\")
  ) {
    throw new DriftAiError(
      `drift:ai config '${keyPath}' entries must be extensions with a leading dot.`,
    );
  }
  return normalized;
}

export function normalizeRepoPath(value: string): string {
  let normalized = value.split(path.sep).join("/").trim();
  while (normalized.startsWith("./")) normalized = normalized.slice(2);
  while (normalized.endsWith("/") && normalized !== "/") normalized = normalized.slice(0, -1);
  return normalized;
}

export function collapseRepoPath(value: string): string {
  const normalized = normalizeRepoPath(value.replace(/\\/gu, "/"));
  if (normalized.length === 0) return ".";
  return path.posix.normalize(normalized);
}

export function pathEscapesRepo(value: string): boolean {
  return value === ".." || value.startsWith("../") || value.startsWith("/");
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

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, "en"));
}

function uniqAllowedPairs(values: readonly GhostFileAllowedPair[]): GhostFileAllowedPair[] {
  const byKey = new Map<string, GhostFileAllowedPair>();
  for (const pair of values) {
    byKey.set(`${pair.files[0]}\u0000${pair.files[1]}`, pair);
  }
  return [...byKey.values()].sort(
    (left, right) =>
      left.files[0].localeCompare(right.files[0], "en") ||
      left.files[1].localeCompare(right.files[1], "en"),
  );
}
