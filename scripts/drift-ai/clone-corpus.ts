// Loader and evaluator for the labeled clone-detection benchmark corpus under
// fixtures/clone-corpus/. It runs the in-process ts-morph near-duplicate engine
// against the corpus and reports precision/recall-style counts against the labels.
//
// This is prototype tooling for comparing clone engines before promoting one (see
// docs/agent_notes/backlog/drift-ai-next-items tasks 41a/41/41b/41c). It is not
// wired into the drift report and sets no quality gate: the labels are
// engine-agnostic ground truth, and the current engine's score is a recorded
// baseline, not a pass/fail bar.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isRecord } from "./config-readers.js";
import { DriftAiError } from "./errors.js";
import {
  extractNearDuplicateFunctions,
  findNearDuplicatePairs,
  type NearDuplicateCompareOptions,
  type NearDuplicateFunction,
} from "./near-duplicates.js";
import { toPosix } from "./path-util.js";

// A function reference, formatted `<corpus-relative-path>#<functionName>`.
export type CloneCorpusFunctionId = string;

type CloneCorpusPairLabel = {
  readonly a: CloneCorpusFunctionId;
  readonly b: CloneCorpusFunctionId;
  readonly category: string;
  readonly note?: string;
};

export type CloneCorpusLabels = {
  readonly version: number;
  readonly description: string;
  readonly clonePairs: readonly CloneCorpusPairLabel[];
  readonly nonPairs: readonly CloneCorpusPairLabel[];
};

export type CloneCorpusFunction = {
  readonly id: CloneCorpusFunctionId;
  readonly filePath: string;
  readonly name: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly lineCount: number;
  readonly tokenCount: number;
};

export type DetectedClonePair = {
  readonly a: CloneCorpusFunctionId;
  readonly b: CloneCorpusFunctionId;
  readonly similarity: number;
  readonly lineImpact: number;
};

type CloneCorpusCategoryRecall = {
  readonly detected: number;
  readonly total: number;
};

// Engine-agnostic confusion-matrix scoring of a detected pair list against the
// corpus labels. Shared by every engine evaluated on this corpus (the ts-morph
// baseline below and the MinHash/LSH candidate prototype) so precision/recall is
// computed one way.
export type LabeledPairScore = {
  // Pair keys (see pairKey) grouped by confusion-matrix cell.
  readonly truePositives: readonly string[];
  readonly falseNegatives: readonly string[];
  readonly falsePositives: readonly string[];
  // The two FP subsets: labeled non-pairs wrongly flagged, and pairs flagged that
  // are in neither label list (a surprise the corpus did not anticipate).
  readonly flaggedNonPairs: readonly string[];
  readonly unexpectedPairs: readonly string[];
  // Label references that did not resolve to an extracted function (corpus drift).
  readonly unknownFunctionRefs: readonly string[];
  readonly counts: {
    readonly clonePairs: number;
    readonly nonPairs: number;
    readonly truePositives: number;
    readonly falseNegatives: number;
    readonly falsePositives: number;
  };
  readonly precision: number;
  readonly recall: number;
  readonly recallByCategory: Readonly<Record<string, CloneCorpusCategoryRecall>>;
};

export type CloneCorpusEvaluation = LabeledPairScore & {
  readonly labels: CloneCorpusLabels;
  readonly functions: readonly CloneCorpusFunction[];
  readonly detected: readonly DetectedClonePair[];
};

const PERCENT_DECIMALS = 1000;
const CORPUS_SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([".ts", ".tsx"]);

export const DEFAULT_CLONE_CORPUS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "clone-corpus",
);

export function loadCloneCorpusLabels(corpusDir = DEFAULT_CLONE_CORPUS_DIR): CloneCorpusLabels {
  const labelsPath = path.join(corpusDir, "labels.json");
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(labelsPath, "utf8"));
  } catch (err) {
    throw new DriftAiError(
      `clone-corpus labels '${labelsPath}' could not be read: ${message(err)}`,
    );
  }
  if (!isRecord(raw)) throw new DriftAiError("clone-corpus labels must be a JSON object.");
  const labels: CloneCorpusLabels = {
    version: readVersion(raw["version"]),
    description: readString(raw["description"], "description"),
    clonePairs: readPairs(raw["clonePairs"], "clonePairs"),
    nonPairs: readPairs(raw["nonPairs"], "nonPairs"),
  };
  assertDistinctPairs(labels);
  return labels;
}

// Each function pair may appear at most once across clonePairs and nonPairs. A
// duplicate (or the same pair labeled both a clone and a non-clone) would land in
// both the positive and negative sets and silently corrupt precision/recall, so
// reject it at load time rather than letting the corpus drift into contradiction.
function assertDistinctPairs(labels: CloneCorpusLabels): void {
  const seen = new Set<string>();
  for (const pair of [...labels.clonePairs, ...labels.nonPairs]) {
    const key = pairKey(pair.a, pair.b);
    if (seen.has(key)) {
      throw new DriftAiError(`clone-corpus labels list the pair '${key}' more than once.`);
    }
    seen.add(key);
  }
}

// Extract every named function the ts-morph engine sees, keyed by `path#name`.
export function extractCloneCorpusFunctions(
  corpusDir = DEFAULT_CLONE_CORPUS_DIR,
): CloneCorpusFunction[] {
  const functions = extractNearDuplicateCorpusFunctions(corpusDir);
  return functions.map((fn) => ({
    id: cloneCorpusFunctionId(fn.filePath, fn.name),
    filePath: fn.filePath,
    name: fn.name,
    startLine: fn.startLine,
    endLine: fn.endLine,
    lineCount: fn.lineCount,
    tokenCount: fn.tokenCount,
  }));
}

// Run the ts-morph engine and return the cross-function pairs it flags, with each
// side mapped back to its `path#name` id.
export function detectCloneCorpusPairs(
  corpusDir = DEFAULT_CLONE_CORPUS_DIR,
  options: NearDuplicateCompareOptions = {},
): DetectedClonePair[] {
  const functions = extractNearDuplicateCorpusFunctions(corpusDir);
  return findNearDuplicatePairs(functions, options).map((pair) => {
    const [a, b] = sortIds(
      cloneCorpusFunctionId(pair.left.filePath, pair.left.name),
      cloneCorpusFunctionId(pair.right.filePath, pair.right.name),
    );
    return { a, b, similarity: pair.similarity, lineImpact: pair.lineImpact };
  });
}

export function evaluateCloneCorpus(
  corpusDir = DEFAULT_CLONE_CORPUS_DIR,
  options: NearDuplicateCompareOptions = {},
): CloneCorpusEvaluation {
  const labels = loadCloneCorpusLabels(corpusDir);
  const functions = extractCloneCorpusFunctions(corpusDir);
  const detected = detectCloneCorpusPairs(corpusDir, options);
  const known = new Set(functions.map((fn) => fn.id));
  return {
    labels,
    functions,
    detected,
    ...scoreDetectedPairsAgainstLabels(detected, labels, known),
  };
}

// Score any engine's detected pairs against the corpus labels. `detected` only
// needs the two function ids per pair; `knownFunctionIds` is the set of ids the
// engine could actually see, used to surface label references that no longer
// resolve to a function (corpus drift).
export function scoreDetectedPairsAgainstLabels(
  detected: readonly { readonly a: CloneCorpusFunctionId; readonly b: CloneCorpusFunctionId }[],
  labels: CloneCorpusLabels,
  knownFunctionIds: ReadonlySet<CloneCorpusFunctionId>,
): LabeledPairScore {
  const unknownFunctionRefs = collectUnknownRefs(labels, knownFunctionIds);
  const positives = new Set(labels.clonePairs.map((pair) => pairKey(pair.a, pair.b)));
  const negatives = new Set(labels.nonPairs.map((pair) => pairKey(pair.a, pair.b)));
  const detectedKeys = new Set(detected.map((pair) => pairKey(pair.a, pair.b)));

  const truePositives = [...detectedKeys].filter((key) => positives.has(key)).sort();
  const falseNegatives = [...positives].filter((key) => !detectedKeys.has(key)).sort();
  const falsePositives = [...detectedKeys].filter((key) => !positives.has(key)).sort();
  const flaggedNonPairs = falsePositives.filter((key) => negatives.has(key));
  const unexpectedPairs = falsePositives.filter((key) => !negatives.has(key));

  return {
    truePositives,
    falseNegatives,
    falsePositives,
    flaggedNonPairs,
    unexpectedPairs,
    unknownFunctionRefs,
    counts: {
      clonePairs: positives.size,
      nonPairs: negatives.size,
      truePositives: truePositives.length,
      falseNegatives: falseNegatives.length,
      falsePositives: falsePositives.length,
    },
    precision: ratio(truePositives.length, truePositives.length + falsePositives.length),
    recall: ratio(truePositives.length, truePositives.length + falseNegatives.length),
    recallByCategory: recallByCategory(labels.clonePairs, detectedKeys),
  };
}

// The corpus's named functions as full near-duplicate fingerprints (with the
// `features`/`statementFeatures` arrays). extractCloneCorpusFunctions returns the
// lighter id-keyed view; engines that need the fingerprint features (the MinHash
// candidate prototype) use this.
export function extractCloneCorpusNearDuplicateFunctions(
  corpusDir = DEFAULT_CLONE_CORPUS_DIR,
): NearDuplicateFunction[] {
  return extractNearDuplicateCorpusFunctions(corpusDir);
}

function extractNearDuplicateCorpusFunctions(corpusDir: string): NearDuplicateFunction[] {
  return listCorpusSourceFiles(corpusDir).flatMap((relativePath) =>
    extractNearDuplicateFunctions(
      relativePath,
      readFileSync(path.join(corpusDir, relativePath), "utf8"),
    ),
  );
}

function listCorpusSourceFiles(corpusDir: string): string[] {
  return readdirSync(corpusDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && CORPUS_SOURCE_EXTENSIONS.has(path.extname(entry.name)))
    .map((entry) => toPosix(entry.name))
    .sort();
}

function collectUnknownRefs(labels: CloneCorpusLabels, known: ReadonlySet<string>): string[] {
  const refs = [...labels.clonePairs, ...labels.nonPairs].flatMap((pair) => [pair.a, pair.b]);
  return [...new Set(refs.filter((ref) => !known.has(ref)))].sort();
}

function recallByCategory(
  clonePairs: readonly CloneCorpusPairLabel[],
  detectedKeys: ReadonlySet<string>,
): Record<string, CloneCorpusCategoryRecall> {
  const byCategory: Record<string, CloneCorpusCategoryRecall> = {};
  for (const pair of clonePairs) {
    const prior = byCategory[pair.category] ?? { detected: 0, total: 0 };
    byCategory[pair.category] = {
      detected: prior.detected + (detectedKeys.has(pairKey(pair.a, pair.b)) ? 1 : 0),
      total: prior.total + 1,
    };
  }
  return byCategory;
}

// The `<corpus-relative-path>#<functionName>` id labels.json references. Exported
// so engines that surface their own function refs (the MinHash candidate
// prototype) can map them onto label ids before scoring.
export function cloneCorpusFunctionId(filePath: string, name: string): CloneCorpusFunctionId {
  return `${filePath}#${name}`;
}

function sortIds(a: string, b: string): readonly [string, string] {
  return a.localeCompare(b, "en") <= 0 ? [a, b] : [b, a];
}

function pairKey(a: string, b: string): string {
  const [first, second] = sortIds(a, b);
  return `${first} <=> ${second}`;
}

function ratio(numerator: number, denominator: number): number {
  // Vacuous-true convention: precision with nothing detected (and recall on an
  // empty corpus) report 1. Read precision alongside recall — an engine that
  // detects nothing shows precision 1 but recall 0, so the gap stays visible.
  if (denominator === 0) return 1;
  return Math.round((numerator / denominator) * PERCENT_DECIMALS) / PERCENT_DECIMALS;
}

function readVersion(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0) {
    throw new DriftAiError("clone-corpus labels 'version' must be a positive integer.");
  }
  return raw;
}

function readString(raw: unknown, keyPath: string): string {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new DriftAiError(`clone-corpus labels '${keyPath}' must be a non-empty string.`);
  }
  return raw;
}

function readPairs(raw: unknown, keyPath: string): CloneCorpusPairLabel[] {
  if (!Array.isArray(raw)) {
    throw new DriftAiError(`clone-corpus labels '${keyPath}' must be an array.`);
  }
  return raw.map((item, index) => readPair(item, `${keyPath}[${index}]`));
}

function readPair(raw: unknown, keyPath: string): CloneCorpusPairLabel {
  if (!isRecord(raw)) throw new DriftAiError(`clone-corpus labels '${keyPath}' must be an object.`);
  const a = readString(raw["a"], `${keyPath}.a`);
  const b = readString(raw["b"], `${keyPath}.b`);
  if (a === b)
    throw new DriftAiError(`clone-corpus labels '${keyPath}' must reference two functions.`);
  const note = raw["note"];
  return {
    a,
    b,
    category: readString(raw["category"], `${keyPath}.category`),
    ...(note === undefined ? {} : { note: readString(note, `${keyPath}.note`) }),
  };
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
