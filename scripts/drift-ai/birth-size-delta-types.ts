import type { BoundedHistoryDisclosure } from "./advisory-format-helpers.js";
import type { BoundedFullHistory } from "./bounded-full-history.js";
import type { BranchPointFunction, BranchPointMeasurer } from "./branch-points.js";
import type { PrototypeAdvisory, PrototypeSection } from "./prototype-advisory.js";

export const BIRTH_SIZE_DELTA_SUBCOMMAND = "birth-size-delta";
export const DEFAULT_BIRTH_SIZE_DELTA_TOP = 20;
export const DEFAULT_BIRTH_SIZE_DELTA_MAX_BLOB_READS = 100;
export const DEFAULT_BIRTH_SIZE_DELTA_MAX_BLOB_BYTES = 1024 * 1024;
export const DEFAULT_BIRTH_SIZE_DELTA_BLOB_TIMEOUT_MS = 2_000;

export type BirthBlobRequest = {
  readonly commit: string;
  readonly path: string;
};

export type BirthBlobReadCaps = {
  readonly maxOutputBytes: number;
  readonly timeoutMs: number;
};

export type BirthBlobReadResult =
  | { readonly ok: true; readonly source: string }
  | { readonly ok: false; readonly reason: string };

export type BirthBlobReader = (request: BirthBlobRequest) => BirthBlobReadResult;
export type CurrentBlobReader = (path: string) => string | undefined;

export type BirthSizeDeltaMetric = {
  readonly birth: number | null;
  readonly current: number | null;
  readonly delta: number | null;
};

export type BirthSizeDeltaBlobState = {
  readonly available: boolean;
  readonly reason: string | null;
};

export type BirthSizeDeltaBirth = {
  readonly commit: string;
  readonly authorName: string;
  readonly authorEmail: string;
  readonly authorDate: string;
  readonly subject: string;
};

export type BirthSizeDeltaBirthBurst = {
  readonly fileCount: number;
  readonly linesAdded: number | null;
  readonly linesAvailable: boolean;
};

export type BirthSizeDeltaChurn = {
  readonly commits: number;
  readonly linesChanged: number | null;
};

// Branch-points overlay for one row. `branchPoints` carries the then-vs-now totals and
// delta; `birthParsed`/`currentParsed` disclose whether each blob was available AND
// parsed, so an unparsed or missing blob reads as a degradation rather than a zero count.
// `topFunctions` are the heaviest contributing scopes in the CURRENT blob.
export type BirthSizeDeltaComplexity = {
  readonly branchPoints: BirthSizeDeltaMetric;
  readonly birthParsed: boolean;
  readonly currentParsed: boolean;
  readonly topFunctions: readonly BranchPointFunction[];
};

export type BirthSizeDeltaRow = {
  readonly rank: number;
  readonly path: string;
  readonly birth: BirthSizeDeltaBirth;
  readonly birthBlob: BirthSizeDeltaBlobState;
  readonly currentBlob: BirthSizeDeltaBlobState;
  readonly birthBurst: BirthSizeDeltaBirthBurst;
  readonly bytes: BirthSizeDeltaMetric;
  readonly effectiveLoc: BirthSizeDeltaMetric;
  readonly complexity: BirthSizeDeltaComplexity;
  readonly churnSinceBirth: BirthSizeDeltaChurn;
  readonly inspectCommand: string;
  readonly blobCommand: string;
  readonly caveats: readonly string[];
};

export type BirthSizeDeltaSection = PrototypeSection<BirthSizeDeltaRow>;

export type BirthSizeDeltaAdvisory = PrototypeAdvisory<BirthSizeDeltaSection> & {
  readonly history: BoundedHistoryDisclosure;
  readonly currentFileCount: number;
  readonly pathHistoryCandidateCount: number;
  readonly blobReadCount: number;
  readonly maxBlobReads: number;
  readonly blobReadCaps: BirthBlobReadCaps;
  readonly metricDefinitions: {
    readonly effectiveLoc: string;
    readonly bytes: string;
  };
  readonly complexityMetric: {
    readonly name: string;
    readonly version: number;
    readonly definition: string;
  };
};

export type BuildBirthSizeDeltaAdvisoryInput = {
  readonly history: BoundedFullHistory;
  readonly currentFiles: readonly string[];
  readonly readCurrentBlob: CurrentBlobReader;
  readonly readBirthBlob: BirthBlobReader;
  readonly top?: number;
  readonly maxBlobReads?: number;
  readonly blobReadCaps?: BirthBlobReadCaps;
  // Optional branch-points measurement seam (defaults to the real ts-morph parse).
  readonly measureComplexity?: BranchPointMeasurer;
};
