// Custom ghost-file detector. Catches newly added/copied source files whose
// basenames look like accidental siblings of an existing module — the
// "agent created a parallel file instead of editing the existing one"
// failure mode that generic linters and duplicate scanners do not see.
//
// Pure logic (tokenize, singularize, findGhostMatches) is exported so the
// fixture coverage in ghost-files.test.ts can exercise the heuristic
// without touching the real filesystem. The runner only depends on an
// injectable directory listing so the same shape can be tested in
// isolation and wired into drift-ai.ts at the integration layer.

import { readdirSync } from "node:fs";
import path from "node:path";

import type { ChangedFile, DriftFinding } from "../drift-ai.js";

import { matchesAnyGlob } from "./config.js";
import type { DetectorScope } from "./scope.js";

const SOURCE_LIKE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

export const GHOST_FILES_DIRECTORY_PAIR_THRESHOLD = 300;
export const GHOST_FILES_BUCKET_CAP = 50;

// Tokens that frequently appear as decorative suffixes and should not be
// the only thing distinguishing two filenames. Compared after singularize
// so "helpers" and "schemas" collapse onto their singular forms.
const WEAK_TOKENS = new Set<string>([
  "helper",
  "util",
  "service",
  "router",
  "component",
  "type",
  "schema",
  "model",
  "manager",
  "handler",
]);

// Filenames that should never count as a ghost-file candidate or as a peer
// when judging another candidate. Matches both the new-file side (we don't
// flag "foo.test.ts" as a ghost of "foo.ts") and the peer side (we don't
// flag "foo.ts" as a ghost just because "foo.test.ts" exists).
const PEER_EXCLUDE_PATTERNS: readonly RegExp[] = [
  /\.test\.[cm]?[jt]sx?$/u,
  /\.spec\.[cm]?[jt]sx?$/u,
  /\.fixture\.[cm]?[jt]sx?$/u,
  /\.d\.ts$/u,
];

export const GHOST_FILES_REPAIR_HINT_PREFIX =
  "check whether the existing module should be extended. Run:";

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

export function tokenize(basename: string): string[] {
  const ext = path.extname(basename);
  const stem = ext.length > 0 ? basename.slice(0, -ext.length) : basename;
  if (stem.length === 0) return [];
  const segments = stem.split(/[^a-zA-Z0-9]+/u).filter((part) => part.length > 0);
  const tokens: string[] = [];
  for (const segment of segments) {
    const matches = segment.match(/[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|[0-9]+/gu);
    const parts = matches && matches.length > 0 ? matches : [segment];
    for (const part of parts) tokens.push(part.toLowerCase());
  }
  return tokens;
}

// Words that look like English plurals but are invariant or already singular.
// Without this guard "series" → "sery", "species" → "specy", which would
// then fail to match the legitimate plural form of the word.
const SINGULAR_INVARIANTS = new Set<string>(["series", "species", "news"]);

export function singularize(token: string): string {
  if (SINGULAR_INVARIANTS.has(token)) return token;
  if (token.length > 3 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  // Strip the full "es" only when it follows a sibilant (-shes, -ches,
  // -ses, -xes, -zes); a bare "-es" rule misfires on words like
  // "bytes" → "byt".
  if (token.length > 4 && /(?:s|x|z|sh|ch)es$/u.test(token)) return token.slice(0, -2);
  if (token.length > 2 && token.endsWith("s") && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }
  return token;
}

export function isExcludedSibling(filename: string): boolean {
  for (const pattern of PEER_EXCLUDE_PATTERNS) {
    if (pattern.test(filename)) return true;
  }
  return false;
}

function isExcludedPath(filePath: string): boolean {
  const posix = toPosix(filePath);
  const segments = posix.split("/");
  if (segments.includes("__tests__")) return true;
  if (segments.includes("fixtures") || segments.includes("__fixtures__")) return true;
  const basename = segments[segments.length - 1] ?? "";
  return isExcludedSibling(basename);
}

function isSourceLike(
  filename: string,
  sourceExtensions: ReadonlySet<string> = SOURCE_LIKE_EXTS,
): boolean {
  return sourceExtensions.has(path.extname(filename).toLowerCase());
}

function normalizedTokens(basename: string): string[] {
  return tokenize(basename).map(singularize);
}

export function strongTokens(tokens: readonly string[]): string[] {
  return tokens.filter((token) => !WEAK_TOKENS.has(token));
}

function uniqSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, "en"));
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

function intersection(a: readonly string[], b: readonly string[]): string[] {
  const lookup = new Set(b);
  const out: string[] = [];
  for (const item of a) {
    if (lookup.has(item) && !out.includes(item)) out.push(item);
  }
  return out;
}

// Bounded Levenshtein with an early-exit cap. Two changes is the most a
// real basename typo or singular/plural variant slips past the other two
// rules, and we already require length >= 4 to keep short names like
// "a.ts" and "b.ts" from matching by accident.
function levenshteinBounded(a: string, b: string, cap: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, index) => index);
  const curr = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    let rowMin = curr[0] ?? 0;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const left = curr[j - 1] ?? 0;
      const above = prev[j] ?? 0;
      const diag = prev[j - 1] ?? 0;
      const value = Math.min(left + 1, above + 1, diag + cost);
      curr[j] = value;
      if (value < rowMin) rowMin = value;
    }
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

// Common entry-point stems where co-located `index.ts`+`index.tsx` (or the
// equivalent `main.*` pattern) is intentional and should not be flagged.
const ENTRY_POINT_STEMS = new Set<string>(["index", "main"]);

function basenameStem(filename: string): string {
  const ext = path.extname(filename);
  return ext.length > 0 ? filename.slice(0, -ext.length) : filename;
}

export function findGhostMatches(
  newPath: string,
  peerPaths: readonly string[],
  sourceExtensions: ReadonlySet<string> = SOURCE_LIKE_EXTS,
): GhostFileMatch[] {
  const newBase = path.basename(newPath);
  if (isExcludedPath(newPath) || !isSourceLike(newBase, sourceExtensions)) return [];
  if (ENTRY_POINT_STEMS.has(basenameStem(newBase).toLowerCase())) return [];
  const newTokens = normalizedTokens(newBase);
  if (newTokens.length === 0) return [];
  const newStrong = strongTokens(newTokens);
  const newNormalized = newTokens.join("-");

  const matches: GhostFileMatch[] = [];
  for (const peerPath of peerPaths) {
    if (peerPath === newPath) continue;
    const peerBase = path.basename(peerPath);
    if (isExcludedPath(peerPath) || !isSourceLike(peerBase, sourceExtensions)) continue;
    const peerTokens = normalizedTokens(peerBase);
    if (peerTokens.length === 0) continue;
    const peerStrong = strongTokens(peerTokens);
    const peerNormalized = peerTokens.join("-");
    const kind = classifyMatch({ newNormalized, peerNormalized, newStrong, peerStrong });
    if (!kind) continue;
    matches.push({
      newPath,
      peerPath,
      kind,
      sharedTokens: intersection(newStrong, peerStrong),
    });
  }
  return matches;
}

export type DirectoryListing = (directory: string) => readonly string[];

export function defaultDirectoryListing(repoRoot: string): DirectoryListing {
  // Resolve once so the prefix check below uses the canonical form.
  const root = path.resolve(repoRoot);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return (directory) => {
    // Defense in depth: callers pass a directory derived from changed-file
    // paths, which are git-tracked today, but a `..` segment or absolute
    // path would otherwise let `path.join` (or `path.resolve` for absolutes)
    // walk outside the repo. Collapse first, then verify the result is
    // contained in the repo root before touching the filesystem.
    const target = path.resolve(root, directory);
    if (target !== root && !target.startsWith(rootWithSep)) return [];
    try {
      const entries = readdirSync(target, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right, "en"));
    } catch {
      return [];
    }
  };
}

export type RunGhostFilesCheckOptions = {
  readonly detectorScope: DetectorScope;
  readonly sourceExtensions?: ReadonlySet<string>;
  readonly excludeGlobs?: readonly string[];
  readonly listDirectory?: DirectoryListing;
  readonly inventoryByDir?: ReadonlyMap<string, readonly string[]>;
};

export function runGhostFilesCheck(options: RunGhostFilesCheckOptions): DriftFinding[] {
  const excludeGlobs = options.excludeGlobs ?? [];
  const sourceExtensions = options.sourceExtensions ?? SOURCE_LIKE_EXTS;
  if (options.detectorScope.scopeMode === "current") {
    return runCurrentGhostFilesCheck(options.inventoryByDir, excludeGlobs, sourceExtensions);
  }
  if (options.listDirectory === undefined) {
    throw new Error("runGhostFilesCheck requires listDirectory for changed scope.");
  }
  return runChangedGhostFilesCheck(options, excludeGlobs, sourceExtensions);
}

function runChangedGhostFilesCheck(
  options: RunGhostFilesCheckOptions,
  excludeGlobs: readonly string[],
  sourceExtensions: ReadonlySet<string>,
): DriftFinding[] {
  const listDirectory = options.listDirectory;
  if (listDirectory === undefined) {
    throw new Error("runGhostFilesCheck requires listDirectory for changed scope.");
  }
  const changedFiles = changedFilesFromScope(options.detectorScope);
  const newFiles = changedFiles
    .filter((file) => file.status === "added" || file.status === "copied")
    .map((file) => file.path)
    .filter((filePath) => isSourceLike(path.basename(filePath), sourceExtensions))
    .filter((filePath) => !matchesAnyGlob(filePath, excludeGlobs));
  if (newFiles.length === 0) return [];
  const newFileSet = new Set(newFiles);
  const ordered = [...newFiles].sort((left, right) => left.localeCompare(right, "en"));

  const findings: DriftFinding[] = [];
  const emittedPairs = new Set<string>();
  for (const newPath of ordered) {
    const directory = toPosix(path.dirname(newPath));
    const peerNames = listDirectory(directory);
    const peerPaths = peerNames
      .map((name) => (directory === "." ? name : `${directory}/${name}`))
      .filter((filePath) => isSourceLike(path.basename(filePath), sourceExtensions))
      .filter((filePath) => !matchesAnyGlob(filePath, excludeGlobs))
      .sort((left, right) => left.localeCompare(right, "en"));
    for (const match of findGhostMatches(newPath, peerPaths, sourceExtensions)) {
      // Each ghost relationship is symmetric; emit only the lex-smaller
      // primary so two added siblings produce a single finding.
      if (newFileSet.has(match.peerPath) && match.peerPath < match.newPath) continue;
      const key = pairKey(match.newPath, match.peerPath);
      if (emittedPairs.has(key)) continue;
      emittedPairs.add(key);
      findings.push({
        check: "ghost-files",
        file: match.newPath,
        message: ghostMessage(match),
        hint: repairHint(match.peerPath),
        relatedFiles: relatedFiles(match.newPath, match.peerPath),
      });
    }
  }
  return findings;
}

function runCurrentGhostFilesCheck(
  inventoryByDir: ReadonlyMap<string, readonly string[]> | undefined,
  excludeGlobs: readonly string[],
  sourceExtensions: ReadonlySet<string>,
): DriftFinding[] {
  if (inventoryByDir === undefined) {
    throw new Error("runGhostFilesCheck requires inventoryByDir for current scope.");
  }
  const findings: DriftFinding[] = [];
  for (const directory of currentInventoryDirectories(
    inventoryByDir,
    excludeGlobs,
    sourceExtensions,
  )) {
    findings.push(
      ...runCurrentDirectoryCheck(directory.path, directory.siblings, sourceExtensions),
    );
  }
  return sortFindings(findings);
}

type CurrentDirectoryInventory = {
  readonly path: string;
  readonly siblings: readonly string[];
};

function currentInventoryDirectories(
  inventoryByDir: ReadonlyMap<string, readonly string[]>,
  excludeGlobs: readonly string[],
  sourceExtensions: ReadonlySet<string>,
): CurrentDirectoryInventory[] {
  const grouped = new Map<string, string[]>();
  for (const filePaths of inventoryByDir.values()) {
    addCurrentInventoryFiles(grouped, filePaths, excludeGlobs, sourceExtensions);
  }
  return [...grouped.entries()]
    .map(([directory, siblings]) => ({ path: directory, siblings: uniqSorted(siblings) }))
    .filter((directory) => directory.siblings.length > 1)
    .sort((left, right) => left.path.localeCompare(right.path, "en"));
}

function addCurrentInventoryFiles(
  grouped: Map<string, string[]>,
  filePaths: readonly string[],
  excludeGlobs: readonly string[],
  sourceExtensions: ReadonlySet<string>,
): void {
  for (const filePath of filePaths) {
    const normalized = toPosix(filePath);
    if (!isCurrentInventoryCandidate(normalized, excludeGlobs, sourceExtensions)) continue;
    const directory = path.posix.dirname(normalized);
    const siblings = grouped.get(directory) ?? [];
    siblings.push(normalized);
    grouped.set(directory, siblings);
  }
}

function isCurrentInventoryCandidate(
  filePath: string,
  excludeGlobs: readonly string[],
  sourceExtensions: ReadonlySet<string>,
): boolean {
  if (matchesAnyGlob(filePath, excludeGlobs)) return false;
  if (isExcludedPath(filePath)) return false;
  return isSourceLike(path.posix.basename(filePath), sourceExtensions);
}

function runCurrentDirectoryCheck(
  directory: string,
  siblings: readonly string[],
  sourceExtensions: ReadonlySet<string>,
): DriftFinding[] {
  if (siblings.length <= GHOST_FILES_DIRECTORY_PAIR_THRESHOLD) {
    return runPairwise(siblings, sourceExtensions, new Set<string>());
  }
  return runBucketedDirectory(directory, siblings, sourceExtensions);
}

function runPairwise(
  siblings: readonly string[],
  sourceExtensions: ReadonlySet<string>,
  emittedPairs: Set<string>,
): DriftFinding[] {
  const ordered = uniqSorted(siblings);
  const findings: DriftFinding[] = [];
  for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < ordered.length; rightIndex += 1) {
      addCurrentPairFinding(
        findings,
        ordered[leftIndex] ?? "",
        ordered[rightIndex] ?? "",
        sourceExtensions,
        emittedPairs,
      );
    }
  }
  return findings;
}

function addCurrentPairFinding(
  findings: DriftFinding[],
  left: string,
  right: string,
  sourceExtensions: ReadonlySet<string>,
  emittedPairs: Set<string>,
): void {
  if (left.length === 0 || right.length === 0) return;
  const key = pairKey(left, right);
  if (emittedPairs.has(key)) return;
  const match = tryFindGhostMatchEitherDirection(left, right, sourceExtensions);
  if (match === undefined) return;
  emittedPairs.add(key);
  findings.push(currentPairFinding(match));
}

function tryFindGhostMatchEitherDirection(
  left: string,
  right: string,
  sourceExtensions: ReadonlySet<string>,
): GhostFileMatch | undefined {
  const [leftMatch] = findGhostMatches(left, [right], sourceExtensions);
  if (leftMatch !== undefined) return leftMatch;
  const [rightMatch] = findGhostMatches(right, [left], sourceExtensions);
  return rightMatch;
}

type TokenBucket = {
  readonly key: string;
  readonly files: readonly string[];
};

type OversizedBucket = {
  readonly key: string;
  readonly size: number;
};

type TokenizedFile = {
  readonly filePath: string;
  readonly normalized: string;
  readonly strong: readonly string[];
};

function runBucketedDirectory(
  directory: string,
  siblings: readonly string[],
  sourceExtensions: ReadonlySet<string>,
): DriftFinding[] {
  const findings: DriftFinding[] = [];
  const emittedPairs = new Set<string>();
  const oversized: OversizedBucket[] = [];
  for (const bucket of tokenBuckets(siblings)) {
    if (bucket.files.length <= GHOST_FILES_BUCKET_CAP) {
      findings.push(...runPairwise(bucket.files, sourceExtensions, emittedPairs));
    } else {
      oversized.push({ key: bucket.key, size: bucket.files.length });
    }
  }
  findings.push(...oversizedBucketFindings(directory, oversized));
  return findings;
}

function tokenBuckets(siblings: readonly string[]): TokenBucket[] {
  const buckets = new Map<string, Set<string>>();
  for (const file of siblings.map(tokenizeFileForBuckets)) {
    addTokenBucketMember(buckets, `identical-normalized:${file.normalized}`, file.filePath);
    for (const token of uniqSorted(file.strong)) {
      addTokenBucketMember(buckets, `strong:${token}`, file.filePath);
    }
  }
  return [...buckets.entries()].map(toTokenBucket).sort(compareBucket);
}

function tokenizeFileForBuckets(filePath: string): TokenizedFile {
  const tokens = normalizedTokens(path.posix.basename(filePath));
  return {
    filePath,
    normalized: tokens.join("-"),
    strong: strongTokens(tokens),
  };
}

function addTokenBucketMember(
  buckets: Map<string, Set<string>>,
  key: string,
  filePath: string,
): void {
  if (key.endsWith(":")) return;
  const bucket = buckets.get(key) ?? new Set<string>();
  bucket.add(filePath);
  buckets.set(key, bucket);
}

function toTokenBucket([key, files]: readonly [string, Set<string>]): TokenBucket {
  return { key, files: uniqSorted([...files]) };
}

function compareBucket(left: TokenBucket, right: TokenBucket): number {
  return left.key.localeCompare(right.key, "en");
}

function oversizedBucketFindings(
  directory: string,
  oversized: readonly OversizedBucket[],
): DriftFinding[] {
  if (oversized.length === 0) return [];
  if (oversized.length >= 3) return [collapsedOversizedBucketFinding(directory, oversized)];
  return [...oversized]
    .sort(compareOversizedBucket)
    .map((bucket) => oversizedBucketFinding(directory, bucket));
}

function oversizedBucketFinding(directory: string, bucket: OversizedBucket): DriftFinding {
  return {
    check: "ghost-files",
    file: directory,
    message: `directory ${directory} has bucket '${bucket.key}' with ${bucket.size} entries (cap ${GHOST_FILES_BUCKET_CAP}); skipping pairwise comparison.`,
    hint: oversizedBucketHint(),
  };
}

function collapsedOversizedBucketFinding(
  directory: string,
  oversized: readonly OversizedBucket[],
): DriftFinding {
  return {
    check: "ghost-files",
    file: directory,
    message: `directory ${directory} has ${oversized.length} oversized buckets (cap ${GHOST_FILES_BUCKET_CAP}); largest: ${largestBucketSummary(oversized)}.`,
    hint: oversizedBucketHint(),
  };
}

function largestBucketSummary(oversized: readonly OversizedBucket[]): string {
  return [...oversized]
    .sort(compareLargestOversizedBucket)
    .slice(0, 5)
    .map((bucket) => `${bucket.key}(${bucket.size})`)
    .join(", ");
}

function compareOversizedBucket(left: OversizedBucket, right: OversizedBucket): number {
  return left.key.localeCompare(right.key, "en");
}

function compareLargestOversizedBucket(left: OversizedBucket, right: OversizedBucket): number {
  return right.size - left.size || left.key.localeCompare(right.key, "en");
}

function changedFilesFromScope(detectorScope: DetectorScope): ChangedFile[] {
  const files: ChangedFile[] = [];
  for (const file of detectorScope.files) {
    if (file.scope !== "changed") continue;
    files.push({
      path: file.path,
      status: file.status,
      ...(file.previousPath === undefined ? {} : { previousPath: file.previousPath }),
    });
  }
  return files;
}

function ghostMessage(match: GhostFileMatch): string {
  const tokens = match.sharedTokens.length > 0 ? match.sharedTokens.join(", ") : "(low overlap)";
  return `looks like a sibling of ${match.peerPath} (${match.kind}; shared tokens: ${tokens})`;
}

function repairHint(peerPath: string): string {
  return `${GHOST_FILES_REPAIR_HINT_PREFIX} bun run code:intel -- dependents ${peerPath}`;
}

function currentPairFinding(match: GhostFileMatch): DriftFinding {
  const pair = orderedPair(match.newPath, match.peerPath);
  return {
    check: "ghost-files",
    file: pair.left,
    message: currentPairMessage(pair.left, pair.right, match),
    hint: currentPairHint(pair.left, pair.right),
    relatedFiles: [pair.left, pair.right],
  };
}

function currentPairMessage(left: string, right: string, match: GhostFileMatch): string {
  const tokens = match.sharedTokens.length > 0 ? match.sharedTokens.join(", ") : "(low overlap)";
  return `${left} ↔ ${right} -- suspicious sibling pair (${match.kind}; shared tokens: ${tokens})`;
}

function currentPairHint(left: string, right: string): string {
  return [
    "review whether the pair should be merged, renamed, or documented as intentionally separate.",
    `Run: bun run code:intel -- dependents ${left}; bun run code:intel -- dependents ${right}`,
  ].join(" ");
}

function oversizedBucketHint(): string {
  return "rerun with --root <narrower path> or tighten ignore globs in drift-ai.config.json.";
}

function pairKey(left: string, right: string): string {
  const pair = orderedPair(left, right);
  return `${pair.left}\u0000${pair.right}`;
}

function relatedFiles(left: string, right: string): readonly string[] {
  const pair = orderedPair(left, right);
  return [pair.left, pair.right];
}

function orderedPair(
  left: string,
  right: string,
): { readonly left: string; readonly right: string } {
  return left <= right ? { left, right } : { left: right, right: left };
}

function sortFindings(findings: readonly DriftFinding[]): DriftFinding[] {
  return [...findings].sort(
    (left, right) =>
      left.file.localeCompare(right.file, "en") || left.message.localeCompare(right.message, "en"),
  );
}

function toPosix(filePath: string): string {
  return filePath.replace(/\\/gu, "/").split(path.sep).join("/");
}
