import path from "node:path";

import {
  arraysEqual,
  intersection,
  isExcludedPath,
  isSourceLike,
  normalizedTokens,
  SOURCE_LIKE_EXTS,
  strongTokens,
  uniqSorted,
} from "./ghost-files-tokens.js";

export type GhostFileMatchKind =
  | "identical-normalized"
  | "weak-suffix-variant"
  | "near-edit-distance";

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

const ENTRY_POINT_STEMS = new Set<string>(["index", "main"]);

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
): GhostCandidate | undefined {
  const base = path.basename(filePath);
  if (isExcludedPath(filePath) || !isSourceLike(base, sourceExtensions)) return undefined;
  const tokens = normalizedTokens(base);
  if (tokens.length === 0) return undefined;
  return { tokens, strong: strongTokens(tokens), normalized: tokens.join("-") };
}

export function findGhostMatches(
  newPath: string,
  peerPaths: readonly string[],
  sourceExtensions: ReadonlySet<string> = SOURCE_LIKE_EXTS,
): GhostFileMatch[] {
  const newCandidate = prepareGhostCandidate(newPath, sourceExtensions);
  if (!newCandidate) return [];
  if (ENTRY_POINT_STEMS.has(basenameStem(path.basename(newPath)).toLowerCase())) return [];

  const matches: GhostFileMatch[] = [];
  for (const peerPath of peerPaths) {
    if (peerPath === newPath) continue;
    const peerCandidate = prepareGhostCandidate(peerPath, sourceExtensions);
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
