import path from "node:path";

import {
  arraysEqual,
  DEFAULT_GHOST_FILE_WEAK_TOKENS,
  intersection,
  isExcludedPath,
  normalizedTokens,
  strongTokens,
} from "./ghost-files-tokens.js";
import { isSourceLike, uniqSorted } from "./path-util.js";
import { BUILT_IN_SOURCE_EXTENSIONS } from "./scope.js";

type GhostFileMatchKind = "identical-normalized" | "weak-suffix-variant" | "near-edit-distance";

export type GhostFileMatch = {
  readonly newPath: string;
  readonly peerPath: string;
  readonly kind: GhostFileMatchKind;
  readonly sharedTokens: readonly string[];
};

function computeLevenshteinRow(
  a: string,
  b: string,
  i: number,
  prev: readonly number[],
  curr: number[],
): number {
  curr[0] = i;
  let rowMin = i;
  for (let j = 1; j <= b.length; j += 1) {
    const cost = a[i - 1] === b[j - 1] ? 0 : 1;
    const left = curr[j - 1] ?? 0;
    const above = prev[j] ?? 0;
    const diag = prev[j - 1] ?? 0;
    const value = Math.min(left + 1, above + 1, diag + cost);
    curr[j] = value;
    if (value < rowMin) rowMin = value;
  }
  return rowMin;
}

function levenshteinBounded(a: string, b: string, cap: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, index) => index);
  const curr = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const rowMin = computeLevenshteinRow(a, b, i, prev, curr);
    if (rowMin > cap) return cap + 1;
    prev = [...curr];
  }
  return prev[b.length] ?? 0;
}

type MatchInputs = {
  readonly newNormalized: string;
  readonly peerNormalized: string;
  readonly newStrong: readonly string[];
  readonly peerStrong: readonly string[];
};

function classifyMatch(inputs: MatchInputs): GhostFileMatchKind | undefined {
  if (inputs.newNormalized === inputs.peerNormalized) return "identical-normalized";
  const sharedStrong = intersection(inputs.newStrong, inputs.peerStrong);
  if (sharedStrong.length === 0) return undefined;
  const newStrongUniq = uniqSorted(inputs.newStrong);
  const peerStrongUniq = uniqSorted(inputs.peerStrong);
  if (arraysEqual(newStrongUniq, peerStrongUniq)) return "weak-suffix-variant";
  if (
    inputs.newNormalized.length >= 4 &&
    inputs.peerNormalized.length >= 4 &&
    levenshteinBounded(inputs.newNormalized, inputs.peerNormalized, 2) <= 2
  ) {
    return "near-edit-distance";
  }
  return undefined;
}

export const DEFAULT_GHOST_FILE_ENTRY_POINT_STEMS: readonly string[] = ["index", "main"];

const DEFAULT_ENTRY_POINT_STEM_SET: ReadonlySet<string> = new Set(
  DEFAULT_GHOST_FILE_ENTRY_POINT_STEMS,
);
const DEFAULT_WEAK_TOKEN_SET: ReadonlySet<string> = new Set(DEFAULT_GHOST_FILE_WEAK_TOKENS);

export type GhostFileMatchOptions = {
  readonly weakTokens?: ReadonlySet<string>;
  readonly entryPointStems?: ReadonlySet<string>;
};

export type GhostFileTuning = {
  readonly weakTokens: ReadonlySet<string>;
  readonly entryPointStems: ReadonlySet<string>;
};

function basenameStem(filename: string): string {
  const ext = path.extname(filename);
  return ext.length > 0 ? filename.slice(0, -ext.length) : filename;
}

type GhostCandidate = {
  readonly tokens: readonly string[];
  readonly strong: readonly string[];
  readonly normalized: string;
};

function prepareGhostCandidate(
  filePath: string,
  sourceExtensions: ReadonlySet<string>,
  weakTokens: ReadonlySet<string>,
): GhostCandidate | undefined {
  const base = path.basename(filePath);
  if (isExcludedPath(filePath) || !isSourceLike(base, sourceExtensions)) return undefined;
  const tokens = normalizedTokens(base);
  if (tokens.length === 0) return undefined;
  return { tokens, strong: strongTokens(tokens, weakTokens), normalized: tokens.join("-") };
}

export function findGhostMatches(
  newPath: string,
  peerPaths: readonly string[],
  sourceExtensions: ReadonlySet<string> = BUILT_IN_SOURCE_EXTENSIONS,
  options: GhostFileMatchOptions = {},
): GhostFileMatch[] {
  const resolvedOptions = resolveMatchOptions(options);
  const newCandidate = prepareGhostCandidate(newPath, sourceExtensions, resolvedOptions.weakTokens);
  if (!newCandidate) return [];
  if (isEntryPointCandidate(newPath, resolvedOptions.entryPointStems)) return [];

  const matches: GhostFileMatch[] = [];
  for (const peerPath of peerPaths) {
    if (peerPath === newPath) continue;
    const peerCandidate = prepareGhostCandidate(
      peerPath,
      sourceExtensions,
      resolvedOptions.weakTokens,
    );
    if (!peerCandidate) continue;
    const kind = classifyMatch({
      newNormalized: newCandidate.normalized,
      peerNormalized: peerCandidate.normalized,
      newStrong: newCandidate.strong,
      peerStrong: peerCandidate.strong,
    });
    if (!kind) continue;
    matches.push({
      newPath,
      peerPath,
      kind,
      sharedTokens: intersection(newCandidate.strong, peerCandidate.strong),
    });
  }
  return matches;
}

function resolveMatchOptions(options: GhostFileMatchOptions): GhostFileTuning {
  return {
    weakTokens: options.weakTokens ?? DEFAULT_WEAK_TOKEN_SET,
    entryPointStems: options.entryPointStems ?? DEFAULT_ENTRY_POINT_STEM_SET,
  };
}

function isEntryPointCandidate(filePath: string, entryPointStems: ReadonlySet<string>): boolean {
  return entryPointStems.has(basenameStem(path.basename(filePath)).toLowerCase());
}
