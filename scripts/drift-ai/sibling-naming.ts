// Sibling implementation naming classifier (prototype lane, task 47a). This is
// the library half of the sibling-naming overlay: it detects when two sibling
// filenames differ only by an implementation-variant marker token (`v2`, `old`,
// `legacy`, `new`, `copy`, `backup`, ...) over a shared base, and returns raw
// evidence -- shared base tokens, the matched marker(s), and risky-context
// caveats. It deliberately emits NO `DriftFinding` and NO advisory rows: a
// marker filename is naming evidence, never a deletion verdict. The user-facing
// overlay is task 47; this module only classifies and calibrates against the
// task-40b dead-code FP-trap corpus.

import path from "node:path";

import { toPosix, uniqSorted } from "./path-util.js";

export type SiblingMarkerKind = "version" | "lifecycle" | "copy-backup";

type SiblingMarkerPosition = "prefix" | "infix" | "suffix";

export type SiblingMarker = {
  readonly token: string;
  readonly kind: SiblingMarkerKind;
  readonly position: SiblingMarkerPosition;
};

// `plain-vs-marked`: one side adds only marker tokens over the other's full name.
// `marked-vs-marked`: both sides carry differing marker tokens over a shared base
// (e.g. `config-v2.ts` vs `config-v3.ts`). Neither relation claims a replacement.
type SiblingNamingRelation = "plain-vs-marked" | "marked-vs-marked";

export type SiblingNamingPair = {
  readonly leftPath: string;
  readonly rightPath: string;
  readonly sharedTokens: readonly string[];
  readonly leftMarkers: readonly SiblingMarker[];
  readonly rightMarkers: readonly SiblingMarker[];
  readonly relation: SiblingNamingRelation;
  readonly caveats: readonly string[];
};

export type SiblingNamingConfig = {
  readonly lifecycle: ReadonlySet<string>;
  readonly copyBackup: ReadonlySet<string>;
  readonly versionPattern: RegExp;
};

// Layered onto every pair so a downstream consumer can attach evidence the path
// alone cannot show (dynamic-import-only, reflection / string-keyed access). The
// task-40b corpus tests inject one to assert trap labels survive onto a pair.
export type SiblingCaveatLabeler = (filePath: string) => readonly string[];

export type SiblingNamingOptions = {
  readonly lifecycle?: Iterable<string>;
  readonly copyBackup?: Iterable<string>;
  readonly versionPattern?: RegExp;
  readonly caveatLabeler?: SiblingCaveatLabeler;
};

// Seed marker vocabulary. Configurable so task 47 can expose overrides only if a
// field run shows a repo's naming convention needs it.
const DEFAULT_SIBLING_LIFECYCLE_MARKERS: readonly string[] = [
  "old",
  "legacy",
  "new",
  "deprecated",
  "obsolete",
  "previous",
  "prev",
];

const DEFAULT_SIBLING_COPY_BACKUP_MARKERS: readonly string[] = [
  "copy",
  "backup",
  "bak",
  "orig",
  "original",
  "tmp",
  "temp",
  "draft",
  "wip",
];

// Version markers are a `v` + digits family (`v2`, `v10`); a bare trailing number
// (`user2`) is deliberately NOT a version marker to avoid obvious false positives.
const DEFAULT_SIBLING_VERSION_PATTERN = /^v\d+$/u;

const DEFAULT_LIFECYCLE_SET: ReadonlySet<string> = new Set(DEFAULT_SIBLING_LIFECYCLE_MARKERS);
const DEFAULT_COPY_BACKUP_SET: ReadonlySet<string> = new Set(DEFAULT_SIBLING_COPY_BACKUP_MARKERS);

// Carried by every pair: the standing reminder that a variant-marker filename is a
// fork *lead*, not proof one file replaces another and certainly not a deletion
// verdict. It enumerates the live contexts a marked sibling can legitimately be in.
export const SIBLING_NAMING_STANDING_CAVEAT =
  "a variant-marker filename (v2/old/legacy/new/copy/backup/...) is naming evidence, not a " +
  "deletion verdict: the marked file can be live public-API vocabulary, the current " +
  "implementation, dynamically imported, reached by reflection / string key, a framework " +
  "entrypoint, or test-only. Treat sibling naming as a fork lead to investigate, never as proof " +
  "one sibling replaces another.";

// Keeps a letter+digit version run (`v2`, `V2`) intact while still splitting
// camelCase and separator boundaries, unlike the ghost-files tokenizer which
// splits `v` from `2`.
const SIBLING_TOKEN_PATTERN = /[A-Za-z][a-z]*\d+|[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/gu;

const TEST_ONLY_PATTERN = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;
const BARREL_STEMS: ReadonlySet<string> = new Set(["index", "public-api", "barrel", "mod"]);
const FRAMEWORK_DIR_SEGMENTS: ReadonlySet<string> = new Set(["routes", "pages"]);
const FRAMEWORK_STEM_SUFFIX = /-(?:route|page|layout)$/u;

export function resolveSiblingNamingConfig(
  options: SiblingNamingOptions = {},
): SiblingNamingConfig {
  return {
    lifecycle: options.lifecycle === undefined ? DEFAULT_LIFECYCLE_SET : new Set(options.lifecycle),
    copyBackup:
      options.copyBackup === undefined ? DEFAULT_COPY_BACKUP_SET : new Set(options.copyBackup),
    versionPattern: options.versionPattern ?? DEFAULT_SIBLING_VERSION_PATTERN,
  };
}

export function tokenizeSiblingName(basename: string): string[] {
  const stem = stripExtension(basename);
  const tokens: string[] = [];
  for (const segment of stem.split(/[^A-Za-z0-9]+/u)) {
    if (segment.length === 0) continue;
    const matches = segment.match(SIBLING_TOKEN_PATTERN);
    const parts = matches !== null && matches.length > 0 ? matches : [segment];
    for (const part of parts) tokens.push(part.toLowerCase());
  }
  return tokens;
}

export function classifySiblingMarker(
  token: string,
  config: SiblingNamingConfig,
): SiblingMarkerKind | undefined {
  if (config.lifecycle.has(token)) return "lifecycle";
  if (config.copyBackup.has(token)) return "copy-backup";
  if (config.versionPattern.test(token)) return "version";
  return undefined;
}

// Risky-context labels derivable from path conventions alone. Dynamic-import and
// reflection contexts are intentionally absent here because a path cannot prove
// them; those arrive via an injected `caveatLabeler`.
export function siblingPathCaveats(filePath: string): string[] {
  const posix = toPosix(filePath);
  const base = path.posix.basename(posix);
  const segments = posix.split("/");
  const stem = stripExtension(base).toLowerCase();
  const caveats: string[] = [];
  if (TEST_ONLY_PATTERN.test(base)) caveats.push(contextCaveat("test-only", posix));
  if (BARREL_STEMS.has(stem)) caveats.push(contextCaveat("public-api", posix));
  if (
    segments.some((segment) => FRAMEWORK_DIR_SEGMENTS.has(segment)) ||
    FRAMEWORK_STEM_SUFFIX.test(stem)
  ) {
    caveats.push(contextCaveat("framework-entrypoint", posix));
  }
  return caveats;
}

export function classifySiblingPair(
  leftPath: string,
  rightPath: string,
  options: SiblingNamingOptions = {},
): SiblingNamingPair | undefined {
  return classifyPair(
    leftPath,
    rightPath,
    resolveSiblingNamingConfig(options),
    options.caveatLabeler,
  );
}

// Compares every basename in the supplied list pairwise. The caller controls
// grouping (task 47 buckets by directory like ghost-files); this stays O(n^2) and
// caller-bounded so the library half has no hidden caps to disclose.
export function findSiblingVariantPairs(
  paths: readonly string[],
  options: SiblingNamingOptions = {},
): SiblingNamingPair[] {
  const config = resolveSiblingNamingConfig(options);
  const sorted = uniqSorted(paths);
  const pairs: SiblingNamingPair[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const left = sorted[i];
      const right = sorted[j];
      if (left === undefined || right === undefined) continue;
      const pair = classifyPair(left, right, config, options.caveatLabeler);
      if (pair !== undefined) pairs.push(pair);
    }
  }
  return sortPairs(pairs);
}

function classifyPair(
  rawLeft: string,
  rawRight: string,
  config: SiblingNamingConfig,
  labeler: SiblingCaveatLabeler | undefined,
): SiblingNamingPair | undefined {
  const [leftPath, rightPath] = canonicalOrder(rawLeft, rawRight);
  const leftTokens = tokenizeSiblingName(path.posix.basename(toPosix(leftPath)));
  const rightTokens = tokenizeSiblingName(path.posix.basename(toPosix(rightPath)));
  const shared = multisetIntersection(leftTokens, rightTokens);
  if (!shared.some((token) => classifySiblingMarker(token, config) === undefined)) return undefined;
  const leftExtra = multisetDifference(leftTokens, rightTokens);
  const rightExtra = multisetDifference(rightTokens, leftTokens);
  if (!extrasAreAllMarkers(leftExtra, config) || !extrasAreAllMarkers(rightExtra, config)) {
    return undefined;
  }
  const leftMarkers = markersForSide(leftTokens, leftExtra, config);
  const rightMarkers = markersForSide(rightTokens, rightExtra, config);
  if (leftMarkers.length + rightMarkers.length === 0) return undefined;
  return {
    leftPath,
    rightPath,
    sharedTokens: shared,
    leftMarkers,
    rightMarkers,
    relation:
      leftMarkers.length > 0 && rightMarkers.length > 0 ? "marked-vs-marked" : "plain-vs-marked",
    caveats: collectCaveats(leftPath, rightPath, labeler),
  };
}

function extrasAreAllMarkers(extra: readonly string[], config: SiblingNamingConfig): boolean {
  return extra.every((token) => classifySiblingMarker(token, config) !== undefined);
}

function markersForSide(
  fileTokens: readonly string[],
  extra: readonly string[],
  config: SiblingNamingConfig,
): SiblingMarker[] {
  // Walk by position and consume the extra multiset by occurrence so a repeated
  // marker token (`old-x-old.ts`) attributes each occurrence to its real position
  // rather than collapsing every record onto the first `indexOf` hit.
  const remaining = countTokens(extra);
  const last = fileTokens.length - 1;
  const markers: SiblingMarker[] = [];
  for (let index = 0; index < fileTokens.length; index += 1) {
    const token = fileTokens[index];
    if (token === undefined) continue;
    const count = remaining.get(token) ?? 0;
    if (count === 0) continue;
    const kind = classifySiblingMarker(token, config);
    if (kind === undefined) continue;
    remaining.set(token, count - 1);
    markers.push({ token, kind, position: positionFor(index, last) });
  }
  return markers;
}

function positionFor(index: number, last: number): SiblingMarkerPosition {
  if (index <= 0) return "prefix";
  if (index === last) return "suffix";
  return "infix";
}

function collectCaveats(
  leftPath: string,
  rightPath: string,
  labeler: SiblingCaveatLabeler | undefined,
): string[] {
  const caveats = [
    SIBLING_NAMING_STANDING_CAVEAT,
    ...siblingPathCaveats(leftPath),
    ...siblingPathCaveats(rightPath),
    ...(labeler?.(leftPath) ?? []),
    ...(labeler?.(rightPath) ?? []),
  ];
  return dedupePreserveOrder(caveats);
}

function canonicalOrder(left: string, right: string): readonly [string, string] {
  return left.localeCompare(right, "en") <= 0 ? [left, right] : [right, left];
}

function contextCaveat(kind: string, posix: string): string {
  return `risky-context: ${kind} (${posix})`;
}

function sortPairs(pairs: readonly SiblingNamingPair[]): SiblingNamingPair[] {
  return [...pairs].sort(
    (left, right) =>
      left.leftPath.localeCompare(right.leftPath, "en") ||
      left.rightPath.localeCompare(right.rightPath, "en"),
  );
}

function stripExtension(basename: string): string {
  const ext = path.extname(basename);
  return ext.length > 0 ? basename.slice(0, -ext.length) : basename;
}

function dedupePreserveOrder(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

// Tokens of `a` accounted for by `b` (by multiplicity), in `a`'s order.
function multisetIntersection(a: readonly string[], b: readonly string[]): string[] {
  const remaining = countTokens(b);
  const out: string[] = [];
  for (const token of a) {
    const count = remaining.get(token) ?? 0;
    if (count > 0) {
      remaining.set(token, count - 1);
      out.push(token);
    }
  }
  return out;
}

// Tokens of `from` that `other` cannot account for by multiplicity, in `from`'s order.
function multisetDifference(from: readonly string[], other: readonly string[]): string[] {
  const remaining = countTokens(other);
  const out: string[] = [];
  for (const token of from) {
    const count = remaining.get(token) ?? 0;
    if (count > 0) remaining.set(token, count - 1);
    else out.push(token);
  }
  return out;
}

function countTokens(tokens: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
}
