import { Minimatch } from "minimatch";

// The glob-bearing subset shared by a registry ratchet and a committed baseline
// test, so the single matcher serves both without importing either concrete
// type. Both expose `files`/`ignores` as relative-glob arrays.
export interface RatchetGlobScope {
  readonly files: readonly string[];
  readonly ignores: readonly string[];
}

// ESLint flat config resolves `files`/`ignores` with minimatch and `dot: true`.
// The gate collects the same file set by hand, so it MUST resolve patterns with
// the identical engine and options — any divergence is a file the gate and
// ESLint disagree about, i.e. silent debt growth. `dot: true` is the load-
// bearing option: without it dot-prefixed paths silently drop out of coverage.
const MINIMATCH_OPTIONS = { dot: true } as const;

// One compiled matcher per pattern. `matchesAny` runs once per (file, pattern)
// pair across a whole sweep, so compiling on every call was O(files × patterns)
// regex builds; the options are fixed, so the pattern string is a complete key.
const compiledPatterns = new Map<string, Minimatch>();

function compile(pattern: string): Minimatch {
  const cached = compiledPatterns.get(pattern);
  if (cached !== undefined) return cached;
  const matcher = new Minimatch(pattern, MINIMATCH_OPTIONS);
  compiledPatterns.set(pattern, matcher);
  return matcher;
}

// Kept on the exported surface for callers that want the compiled RegExp form.
// minimatch returns `false` only for the handful of patterns it cannot reduce
// to a single RegExp (e.g. a bare `**`); real ratchet globs always reduce, so
// that case is an invariant violation rather than a value to paper over — use
// `matchesAny`/`matchesRatchet` for full match semantics on any pattern.
export function globToRegExp(pattern: string): RegExp {
  const regExp = compile(pattern).makeRe();
  if (regExp === false) {
    throw new Error(`ratchet-globs: glob cannot be compiled to a single RegExp: ${pattern}`);
  }
  return regExp;
}

export function matchesAny(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => compile(pattern).match(path));
}

export function matchesRatchet(ratchet: RatchetGlobScope, trackedFile: string): boolean {
  return matchesAny(trackedFile, ratchet.files) && !matchesAny(trackedFile, ratchet.ignores);
}

export function matchingTrackedFiles(
  ratchet: RatchetGlobScope,
  trackedFiles: readonly string[],
): readonly string[] {
  return trackedFiles.filter((trackedFile) => matchesRatchet(ratchet, trackedFile));
}
