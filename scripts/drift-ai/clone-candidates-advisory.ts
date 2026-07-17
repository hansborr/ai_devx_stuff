import { formatPercent, plural, positiveInt } from "./advisory-format-helpers.js";
import {
  type CloneCandidate,
  type CloneCandidateOptions,
  type CloneCandidateResult,
  generateCloneCandidates,
} from "./clone-candidates.js";
import {
  buildCloneCandidateSiblingOverlay,
  type CloneCandidateSiblingNamingOverlay,
  type CloneCandidateSiblingOverlayContext,
  cloneCandidateSiblingOverlayContext,
  formatCloneCandidateSiblingOverlay,
} from "./clone-candidates-sibling-overlay.js";
import type { GhostFileAllowedPair } from "./config.js";
import type { MinHashConfig, ResolvedMinHashConfig } from "./minhash-lsh.js";
import {
  compareNearDuplicateFunctions,
  DEFAULT_NEAR_DUPLICATE_MIN_LINES,
  DEFAULT_NEAR_DUPLICATE_MIN_TOKENS,
  DEFAULT_NEAR_DUPLICATE_SIMILARITY,
  DEFAULT_NEAR_DUPLICATE_TOKEN_BAND_RATIO,
  findNearDuplicatePairs,
  type NearDuplicateFunction,
  type NearDuplicateFunctionRef,
} from "./near-duplicates.js";
import {
  appendPrototypeSection,
  buildPrototypeAdvisory,
  formatPrototypeAdvisoryJson,
  formatPrototypeHeader,
  type PrototypeAdvisory,
  type PrototypeCap,
  type PrototypeSection,
} from "./prototype-advisory.js";
import type { SiblingCaveatLabeler } from "./sibling-naming.js";

export const CLONE_CANDIDATES_SUBCOMMAND = "clone-candidates";
export const DEFAULT_CLONE_CANDIDATES_TOP = 20;

export type CloneCandidateAdvisoryInput = {
  readonly functions: readonly NearDuplicateFunction[];
  readonly top?: number;
  readonly minLines?: number;
  readonly minTokens?: number;
  readonly similarityThreshold?: number;
  readonly tokenBandRatio?: number;
  readonly maxFunctions?: number;
  readonly minhash?: Partial<MinHashConfig>;
  readonly siblingAllowedPairs?: readonly GhostFileAllowedPair[];
  readonly siblingCaveatLabeler?: SiblingCaveatLabeler;
};

type CloneCandidateEngineConfig = {
  readonly shingleSize: number;
  readonly bands: number;
  readonly rowsPerBand: number;
  readonly signatureLength: number;
  readonly maxShinglesPerFunction: number;
  readonly maxCandidatePairs: number;
};

type CloneCandidateAdvisoryRow = {
  readonly rank: number;
  readonly candidateSource: "minhash-lsh";
  readonly comparator: "ts-morph";
  readonly comparatorAgreed: boolean;
  readonly left: NearDuplicateFunctionRef;
  readonly right: NearDuplicateFunctionRef;
  readonly estimatedSimilarity: number;
  readonly comparatorSimilarity: number | null;
  readonly threshold: number;
  readonly lineImpact: number;
  readonly score: number | null;
  readonly engineConfig: CloneCandidateEngineConfig;
  readonly siblingNaming?: CloneCandidateSiblingNamingOverlay;
};

export type CloneCandidateAdvisorySection = PrototypeSection<CloneCandidateAdvisoryRow>;
export type CloneCandidateAdvisory = PrototypeAdvisory<CloneCandidateAdvisorySection>;

export function buildCloneCandidateAdvisory(
  input: CloneCandidateAdvisoryInput,
): CloneCandidateAdvisory {
  const result = generateCloneCandidates(input.functions, candidateOptions(input));
  const rows = buildRows(result, input);
  return buildPrototypeAdvisory({
    subcommand: CLONE_CANDIDATES_SUBCOMMAND,
    caps: capsForResult(result),
    sections: [
      {
        candidateKind: "MinHash/LSH function clone candidates",
        totalCandidates: rows.length,
        emptyReason:
          rows.length === 0
            ? "no MinHash/LSH candidate pairs passed the current size floors and banding config."
            : null,
        entries: rows.slice(0, positiveInt(input.top, DEFAULT_CLONE_CANDIDATES_TOP)),
      },
    ],
  });
}

export function formatCloneCandidateAdvisoryJson(advisory: CloneCandidateAdvisory): string {
  return formatPrototypeAdvisoryJson(advisory);
}

export function formatCloneCandidateAdvisoryText(advisory: CloneCandidateAdvisory): string {
  const lines = formatPrototypeHeader(advisory);
  for (const section of advisory.sections) {
    lines.push("");
    appendPrototypeSection(lines, section, renderRow);
  }
  return lines.join("\n");
}

function candidateOptions(input: CloneCandidateAdvisoryInput): CloneCandidateOptions {
  return {
    minLines: input.minLines ?? DEFAULT_NEAR_DUPLICATE_MIN_LINES,
    minTokens: input.minTokens ?? DEFAULT_NEAR_DUPLICATE_MIN_TOKENS,
    ...(input.maxFunctions === undefined ? {} : { maxFunctions: input.maxFunctions }),
    ...(input.minhash === undefined ? {} : { minhash: input.minhash }),
  };
}

function buildRows(
  result: CloneCandidateResult,
  input: CloneCandidateAdvisoryInput,
): CloneCandidateAdvisoryRow[] {
  const byRef = new Map(input.functions.map((fn) => [functionKey(fn), fn]));
  const threshold = input.similarityThreshold ?? DEFAULT_NEAR_DUPLICATE_SIMILARITY;
  const agreedPairKeys = new Set(
    findNearDuplicatePairs(input.functions, {
      minLines: input.minLines ?? DEFAULT_NEAR_DUPLICATE_MIN_LINES,
      minTokens: input.minTokens ?? DEFAULT_NEAR_DUPLICATE_MIN_TOKENS,
      similarityThreshold: threshold,
      tokenBandRatio: input.tokenBandRatio ?? DEFAULT_NEAR_DUPLICATE_TOKEN_BAND_RATIO,
    }).map(candidatePairKey),
  );
  const rowContext: RowContext = {
    byRef,
    agreedPairKeys,
    minhashConfig: result.minhashConfig,
    siblingContext: cloneCandidateSiblingOverlayContext({
      allowedPairs: input.siblingAllowedPairs,
      caveatLabeler: input.siblingCaveatLabeler,
    }),
    threshold,
  };
  return result.candidates
    .map((candidate, index) => rowForCandidate(candidate, index + 1, rowContext))
    .filter((row): row is CloneCandidateAdvisoryRow => row !== null);
}

type RowContext = {
  readonly byRef: ReadonlyMap<string, NearDuplicateFunction>;
  readonly agreedPairKeys: ReadonlySet<string>;
  readonly minhashConfig: ResolvedMinHashConfig;
  readonly siblingContext: CloneCandidateSiblingOverlayContext;
  readonly threshold: number;
};

function rowForCandidate(
  candidate: CloneCandidate,
  rank: number,
  context: RowContext,
): CloneCandidateAdvisoryRow | null {
  const left = context.byRef.get(functionKey(candidate.left));
  const right = context.byRef.get(functionKey(candidate.right));
  if (left === undefined || right === undefined) return null;
  const compared = compareNearDuplicateFunctions(left, right);
  const comparatorSimilarity = compared?.similarity ?? null;
  const lineImpact =
    compared?.lineImpact ?? Math.max(candidate.left.lineCount, candidate.right.lineCount);
  const row: CloneCandidateAdvisoryRow = {
    rank,
    candidateSource: "minhash-lsh",
    comparator: "ts-morph",
    comparatorAgreed: context.agreedPairKeys.has(candidatePairKey(candidate)),
    left: candidate.left,
    right: candidate.right,
    estimatedSimilarity: candidate.estimatedSimilarity,
    comparatorSimilarity,
    threshold: context.threshold,
    lineImpact,
    score: compared?.score ?? null,
    engineConfig: {
      shingleSize: context.minhashConfig.shingleSize,
      bands: context.minhashConfig.bands,
      rowsPerBand: context.minhashConfig.rowsPerBand,
      signatureLength: context.minhashConfig.signatureLength,
      maxShinglesPerFunction: context.minhashConfig.maxShinglesPerDocument,
      maxCandidatePairs: context.minhashConfig.maxCandidatePairs,
    },
  };
  const siblingNaming = buildCloneCandidateSiblingOverlay(row, context.siblingContext);
  return siblingNaming === undefined ? row : { ...row, siblingNaming };
}

function capsForResult(result: CloneCandidateResult): PrototypeCap[] {
  return [
    {
      label: "functions",
      limit: result.caps.maxFunctions,
      hit: result.truncation.functionsTruncated,
      detail: result.truncation.functionsTruncated
        ? `considered ${result.truncation.consideredFunctions} of ${result.truncation.eligibleFunctions} eligible functions`
        : null,
    },
    {
      label: "shingles per function",
      limit: result.caps.maxShinglesPerFunction,
      hit: result.truncation.shingleTruncatedFunctions > 0,
      detail:
        result.truncation.shingleTruncatedFunctions > 0
          ? `${result.truncation.shingleTruncatedFunctions} functions exceeded the shingle cap`
          : null,
    },
    {
      label: "candidate pairs",
      limit: result.caps.maxCandidatePairs,
      hit: result.truncation.candidatePairsTruncated,
      detail: result.truncation.candidatePairsTruncated
        ? `stopped after ${result.candidates.length} emitted MinHash/LSH candidate ${plural(
            "pair",
            result.candidates.length,
          )}`
        : null,
    },
  ];
}

function renderRow(row: CloneCandidateAdvisoryRow): readonly string[] {
  const lines = [
    `#${row.rank} ${formatRef(row.left)} <=> ${formatRef(row.right)}`,
    `source ${row.candidateSource}: estimate ${formatPercent(
      row.estimatedSimilarity,
      1,
    )}; config shingle ${row.engineConfig.shingleSize}, bands ${row.engineConfig.bands} x rows ${row.engineConfig.rowsPerBand}, signature ${row.engineConfig.signatureLength}`,
    `comparator ${row.comparator}: agreed ${row.comparatorAgreed ? "yes" : "no"}; ${formatComparator(row)}`,
    "inspect: compare both functions before extracting shared flow.",
  ];
  if (row.siblingNaming !== undefined) {
    lines.push(...formatCloneCandidateSiblingOverlay(row.siblingNaming));
  }
  return lines;
}

function formatComparator(row: CloneCandidateAdvisoryRow): string {
  if (row.comparatorSimilarity === null)
    return `no comparable score; threshold ${formatPercent(row.threshold, 1)}`;
  const relation = row.comparatorSimilarity >= row.threshold ? ">=" : "<";
  const score = row.score === null ? "" : `; score ${row.score.toFixed(2)}`;
  const selected = row.comparatorAgreed ? "; selected by engine" : "; not selected by engine";
  return `similarity ${formatPercent(row.comparatorSimilarity, 1)} ${relation} threshold ${formatPercent(
    row.threshold,
    1,
  )}${score}${selected}`;
}

function formatRef(ref: NearDuplicateFunctionRef): string {
  return `${ref.filePath}:${ref.startLine}-${ref.endLine} ${ref.name}`;
}

function functionKey(ref: NearDuplicateFunctionRef): string {
  return `${ref.filePath}:${ref.startLine}:${ref.name}`;
}

function candidatePairKey(pair: Pick<CloneCandidate, "left" | "right">): string {
  return [functionKey(pair.left), functionKey(pair.right)].sort().join(" <=> ");
}
