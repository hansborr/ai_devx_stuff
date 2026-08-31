import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { minimatch } from "minimatch";
import { z } from "zod";

import { errorMessage } from "./error-message.js";

// Mutate-glob resolution for the supervised mutation runner
// (scripts/mutation-run.sh). The runner needs the exact set of worktree files a
// Stryker lane will *mutate* in place, because that set is the preflight
// cleanliness scope and the scope git alone can recover.
//
// Note what this is not: it is not the set of files an in-place run rewrites.
// Stryker's `disableTypeChecks` defaults to `true`, which makes its
// DisableTypeChecksPreprocessor prefix `// @ts-nocheck` onto *every* JS/TS-like
// file in the project, and Sandbox.sandboxFile then backs up and rewrites every
// file that changed. The full in-place write scope is therefore the whole tree,
// not these globs; `.stryker-tmp/backup-*` is the only complete restore source,
// and scripts/mutation-run.sh restores from it first. See that runner's header.
//
// Fidelity to Stryker matters here in one direction: resolving *fewer* files
// than Stryker mutates means preflight under-covers and a stranded mutant can
// hide in a file the runner never checked. So the matcher below is a deliberate
// transcription of Stryker 9's own semantics rather than a convenient
// approximation:
//
//   - @stryker-mutator/core/dist/src/config/file-matcher.js resolves both the
//     candidate and the pattern to absolute POSIX paths and matches with
//     minimatch, with hidden files disallowed (`dot: false`) for mutate globs.
//     This repo pins the same minimatch version Stryker depends on.
//   - fs/project-reader.js#resolveFileDescriptions walks the `mutate` array in
//     order: a plain pattern marks every match for mutation, a `!`-prefixed one
//     unmarks every match. Last write wins, so order is significant.
//   - The same file strips a `:<line-range>` suffix off a pattern before
//     matching (MUTATION_RANGE_REGEX). Ranges narrow *within* a file, so for a
//     whole-file question the file still counts as a target.
//
// The candidate list is supplied by the caller rather than crawled, so the
// runner can feed it `git ls-files` output: git-tracked files are exactly the
// ones `git restore` can bring back, which keeps the fallback rail honest.

/** Stryker's `IGNORE_PATTERN_CHARACTER`: the prefix that turns a mutate glob into an exclusion. */
const IGNORE_PATTERN_CHARACTER = "!";

/** Stryker's `MUTATION_RANGE_REGEX`: an optional `:<line[:col]>-<line[:col]>` suffix on a pattern. */
const MUTATION_RANGE_REGEX = /(.*?):\d+(?::\d+)?-\d+(?::\d+)?$/u;

const CONFIG_FILE_NAME_PREFIXES = ["", "."];
const CONFIG_FILE_NAME_SUFFIXES = [".conf", ".config"];
const CONFIG_FILE_NAME_EXTENSIONS = ["json", "js", "mjs", "cjs"];

/**
 * Stryker's own `SUPPORTED_CONFIG_FILE_NAMES`, in its lookup order — the list
 * `stryker run` walks when it is invoked without an explicit config path.
 */
export const SUPPORTED_STRYKER_CONFIG_FILE_NAMES: readonly string[] = Object.freeze(
  CONFIG_FILE_NAME_PREFIXES.flatMap((prefix) =>
    CONFIG_FILE_NAME_SUFFIXES.flatMap((suffix) =>
      CONFIG_FILE_NAME_EXTENSIONS.map((extension) => `${prefix}stryker${suffix}.${extension}`),
    ),
  ),
);

/** Every failure this module reports: an unreadable, unimportable, or malformed lane config. */
export class MutationTargetsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MutationTargetsError";
  }
}

/** The two lane-config fields the runner's rails depend on. */
export interface MutationLane {
  /** The config path as the caller named it, for diagnostics. */
  readonly configFile: string;
  /**
   * The lane's Stryker `mutate` globs, in order, or undefined when the config
   * omits them and leans on Stryker's own default. Only an in-place lane needs
   * them, so the omission is reported at the point of use rather than here: a
   * sandboxed lane never touches the worktree and must stay as runnable through
   * this runner as it was through a bare `stryker run`.
   */
  readonly mutate: readonly string[] | undefined;
  /** True when the lane rewrites the live worktree instead of a copied sandbox. */
  readonly inPlace: boolean;
}

const laneConfigSchema = z.object({
  mutate: z.array(z.string()).optional(),
  inPlace: z.boolean().default(false),
});

const laneModuleSchema = z.object({ default: laneConfigSchema });

/**
 * Resolve the config file `stryker run` would pick up with no explicit path,
 * relative to `cwd`. Returns the file name (not an absolute path) so callers
 * can echo it back the way an operator would type it.
 */
export function findDefaultStrykerConfigFile(cwd: string): string | undefined {
  return SUPPORTED_STRYKER_CONFIG_FILE_NAMES.find((name) => existsSync(path.resolve(cwd, name)));
}

/**
 * Import a Stryker lane config and read the two fields the runner needs.
 *
 * Importing the config — rather than re-declaring the globs next to the runner
 * — is the seam that keeps preflight and the lane in step: a glob edited in the
 * config is a glob the runner immediately covers.
 */
export async function loadMutationLane(configFile: string, cwd: string): Promise<MutationLane> {
  const absolute = path.resolve(cwd, configFile);
  let imported: unknown;
  try {
    imported = await import(pathToFileURL(absolute).href);
  } catch (error) {
    throw new MutationTargetsError(
      `cannot import Stryker lane config "${configFile}": ${errorMessage(error)}`,
    );
  }
  const parsed = laneModuleSchema.safeParse(imported);
  if (!parsed.success) {
    throw new MutationTargetsError(
      `Stryker lane config "${configFile}" must default-export an object with an optional ` +
        `string[] "mutate" and an optional boolean "inPlace".`,
    );
  }
  return {
    configFile,
    mutate: parsed.data.default.mutate,
    inPlace: parsed.data.default.inPlace,
  };
}

/** Stryker's `normalizeFileName`: file names are compared in POSIX form. */
function normalizeFileName(fileName: string): string {
  return fileName.replace(/\\/gu, "/");
}

function resolvePattern(pattern: string, cwd: string): string {
  const withoutRange = MUTATION_RANGE_REGEX.exec(pattern)?.[1] ?? pattern;
  return normalizeFileName(path.resolve(cwd, withoutRange));
}

/**
 * The subset of `candidates` a lane's `mutate` globs select, in candidate
 * order and de-duplicated. Candidates are returned exactly as they were passed
 * in (repo-relative, if that is how the caller supplied them).
 */
export function selectMutateTargets(
  candidates: readonly string[],
  mutatePatterns: readonly string[],
  cwd: string,
): string[] {
  const resolved = [...new Set(candidates)].map((candidate) => ({
    candidate,
    absolute: normalizeFileName(path.resolve(cwd, candidate)),
  }));
  const selected = new Map(resolved.map(({ candidate }) => [candidate, false]));

  for (const pattern of mutatePatterns) {
    const negated = pattern.startsWith(IGNORE_PATTERN_CHARACTER);
    const absolutePattern = resolvePattern(
      negated ? pattern.slice(IGNORE_PATTERN_CHARACTER.length) : pattern,
      cwd,
    );
    for (const { candidate, absolute } of resolved) {
      if (minimatch(absolute, absolutePattern, { dot: false })) selected.set(candidate, !negated);
    }
  }

  return resolved
    .filter(({ candidate }) => selected.get(candidate) === true)
    .map(({ candidate }) => candidate);
}

/**
 * Stryker's own `--mutate` parsing: `stryker-cli.js` hands the flag's value to
 * `createSplitter(',')`, which splits on commas and drops empties. The CLI value
 * *replaces* the config's `mutate` rather than extending it, and a repeated flag
 * replaces again, because that splitter ignores commander's previous value.
 */
export function parseMutateOverride(value: string): string[] {
  return value.split(",").filter((part) => part.length > 0);
}

/** Parse NUL-delimited path input (`git ls-files -z` output), dropping empty records. */
export function parseCandidatePaths(input: string): string[] {
  return input.split("\0").filter((part) => part.length > 0);
}

/** Render paths as NUL-delimited output (each record NUL-terminated), or "" for none. */
export function formatCandidatePaths(paths: readonly string[]): string {
  return paths.length === 0 ? "" : `${paths.join("\0")}\0`;
}
