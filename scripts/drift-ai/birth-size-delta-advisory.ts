import {
  boundedHistoryAdvisoryFields,
  boundedHistoryDisclosure,
  positiveInt,
} from "./advisory-format-helpers.js";
import { analyzeBirthSizeDeltas, birthBlobFailureCount } from "./birth-size-delta-analysis.js";
import {
  BIRTH_SIZE_DELTA_SUBCOMMAND,
  type BirthBlobReadCaps,
  type BirthSizeDeltaAdvisory,
  type BirthSizeDeltaRow,
  type BirthSizeDeltaSection,
  type BuildBirthSizeDeltaAdvisoryInput,
  DEFAULT_BIRTH_SIZE_DELTA_BLOB_TIMEOUT_MS,
  DEFAULT_BIRTH_SIZE_DELTA_MAX_BLOB_BYTES,
  DEFAULT_BIRTH_SIZE_DELTA_MAX_BLOB_READS,
  DEFAULT_BIRTH_SIZE_DELTA_TOP,
} from "./birth-size-delta-types.js";
import {
  BRANCH_POINTS_METRIC_DEFINITION,
  BRANCH_POINTS_METRIC_NAME,
  BRANCH_POINTS_METRIC_VERSION,
} from "./branch-points.js";
import { outputCapErrorMessage, timeoutErrorMessage } from "./command-error-classification.js";
import { buildPrototypeAdvisory, type PrototypeCap } from "./prototype-advisory.js";

export {
  formatBirthSizeDeltaAdvisoryJson,
  formatBirthSizeDeltaAdvisoryText,
} from "./birth-size-delta-format.js";
export type {
  BirthBlobReadCaps,
  BirthBlobReader,
  BirthBlobReadResult,
  BirthBlobRequest,
  BirthSizeDeltaAdvisory,
  BirthSizeDeltaBirth,
  BirthSizeDeltaBirthBurst,
  BirthSizeDeltaBlobState,
  BirthSizeDeltaChurn,
  BirthSizeDeltaMetric,
  BirthSizeDeltaRow,
  BirthSizeDeltaSection,
  BuildBirthSizeDeltaAdvisoryInput,
  CurrentBlobReader,
} from "./birth-size-delta-types.js";
export {
  BIRTH_SIZE_DELTA_SUBCOMMAND,
  DEFAULT_BIRTH_SIZE_DELTA_BLOB_TIMEOUT_MS,
  DEFAULT_BIRTH_SIZE_DELTA_MAX_BLOB_BYTES,
  DEFAULT_BIRTH_SIZE_DELTA_MAX_BLOB_READS,
  DEFAULT_BIRTH_SIZE_DELTA_TOP,
} from "./birth-size-delta-types.js";

const CANDIDATE_KIND = "path-birth size deltas";

export function buildBirthSizeDeltaAdvisory(
  input: BuildBirthSizeDeltaAdvisoryInput,
): BirthSizeDeltaAdvisory {
  const top = positiveInt(input.top, DEFAULT_BIRTH_SIZE_DELTA_TOP);
  const maxBlobReads = positiveInt(input.maxBlobReads, DEFAULT_BIRTH_SIZE_DELTA_MAX_BLOB_READS);
  const blobReadCaps = resolveBlobReadCaps(input);
  const analysis = analyzeBirthSizeDeltas(input, maxBlobReads);
  const section = sectionForRows(analysis.rows, top);
  const historyFields = boundedHistoryAdvisoryFields(input.history);
  const advisory = buildPrototypeAdvisory({
    subcommand: BIRTH_SIZE_DELTA_SUBCOMMAND,
    prerequisites: [currentInventoryPrerequisite(input), ...historyFields.prerequisites],
    caps: capsForRun(historyFields.caps, section, analysis.pathHistoryCandidateCount, {
      blobReadCaps,
      maxBlobReads,
      top,
    }),
    degradations: historyFields.degradations,
    sections: [section],
  });
  return {
    ...advisory,
    history: boundedHistoryDisclosure(input.history),
    currentFileCount: input.currentFiles.length,
    pathHistoryCandidateCount: analysis.pathHistoryCandidateCount,
    blobReadCount: analysis.blobReadCount,
    maxBlobReads,
    blobReadCaps,
    metricDefinitions: {
      effectiveLoc:
        "comment-aware line scanner count of lines with code outside comments and blanks",
      bytes: "UTF-8 byte length of the blob text read for this run",
    },
    complexityMetric: {
      name: BRANCH_POINTS_METRIC_NAME,
      version: BRANCH_POINTS_METRIC_VERSION,
      definition: BRANCH_POINTS_METRIC_DEFINITION,
    },
  };
}

function sectionForRows(rows: readonly BirthSizeDeltaRow[], top: number): BirthSizeDeltaSection {
  return {
    candidateKind: CANDIDATE_KIND,
    totalCandidates: rows.length,
    emptyReason:
      rows.length === 0 ? "no current source file had path history in scanned commits." : null,
    entries: rows.slice(0, top),
  };
}

function currentInventoryPrerequisite(
  input: BuildBirthSizeDeltaAdvisoryInput,
): BirthSizeDeltaAdvisory["prerequisites"][number] {
  return {
    name: "current source inventory",
    satisfied: true,
    detail: `read ${input.currentFiles.length} current source file path(s) from the target repo inventory`,
  };
}

function capsForRun(
  historyCaps: readonly PrototypeCap[],
  section: BirthSizeDeltaSection,
  pathHistoryCandidateCount: number,
  caps: {
    readonly blobReadCaps: BirthBlobReadCaps;
    readonly maxBlobReads: number;
    readonly top: number;
  },
): readonly PrototypeCap[] {
  return [
    ...historyCaps,
    blobReadCap(caps.maxBlobReads, pathHistoryCandidateCount, section.totalCandidates),
    blobOutputCap(caps.blobReadCaps.maxOutputBytes, section.entries),
    blobTimeoutCap(caps.blobReadCaps.timeoutMs, section.entries),
    rowsCap(caps.top, section),
  ];
}

function resolveBlobReadCaps(input: BuildBirthSizeDeltaAdvisoryInput): BirthBlobReadCaps {
  return {
    maxOutputBytes: input.blobReadCaps?.maxOutputBytes ?? DEFAULT_BIRTH_SIZE_DELTA_MAX_BLOB_BYTES,
    timeoutMs: input.blobReadCaps?.timeoutMs ?? DEFAULT_BIRTH_SIZE_DELTA_BLOB_TIMEOUT_MS,
  };
}

function blobReadCap(limit: number, totalCandidates: number, readCount: number): PrototypeCap {
  const hit = totalCandidates > readCount;
  return {
    label: "birth-size blob-read rows",
    limit,
    hit,
    detail: hit
      ? `read current and birth blobs for ${readCount} of ${totalCandidates} path-history candidate(s); rows are ranked within the read subset`
      : null,
  };
}

function blobOutputCap(limit: number, rows: readonly BirthSizeDeltaRow[]): PrototypeCap {
  const hitCount = birthBlobFailureCount(rows, outputCapErrorMessage);
  return {
    label: "birth blob output bytes per read",
    limit,
    hit: hitCount > 0,
    detail: hitCount > 0 ? `${hitCount} birth blob read(s) exceeded the per-read output cap` : null,
  };
}

function blobTimeoutCap(limit: number, rows: readonly BirthSizeDeltaRow[]): PrototypeCap {
  const hitCount = birthBlobFailureCount(rows, timeoutErrorMessage);
  return {
    label: "birth blob timeout per read (ms)",
    limit,
    hit: hitCount > 0,
    detail: hitCount > 0 ? `${hitCount} birth blob read(s) exceeded the per-read timeout` : null,
  };
}

function rowsCap(top: number, section: BirthSizeDeltaSection): PrototypeCap {
  const hit = section.totalCandidates > section.entries.length;
  return {
    label: "rows",
    limit: top,
    hit,
    detail: hit
      ? `showed ${section.entries.length} of ${section.totalCandidates} candidate rows`
      : null,
  };
}
