// Coldspot lens: files that have gone STILL while at least one independent
// amplifier suggests the stillness is concealment rather than quality. Stability
// is the normal, desirable state of production code, so a naive "hasn't changed
// lately" sort is 80–95% of the tree and pure noise. The gate fixes that:
//
//   age > AGE_THRESHOLD  AND  revisions <= REVISION_FLOOR  AND  ≥1 amplifier fired.
//
// The threshold logic mirrors churn's median-standout but INVERTED (a coldspot
// stands out by being unusually OLD relative to the in-window touched set) and
// amplifier-gated — NEVER a fixed top-N. A file in the list without an amplifier
// must not appear. Evidence, not verdicts: each row names WHICH amplifier(s) fired,
// carries the raw numbers, and a copy-paste `git log` inspect command.
//
// Aggregation lives in `coldspots-aggregate.ts`; the four amplifiers in
// `coldspots-amplifiers.ts`. This module owns the thresholds, the gate, and row
// assembly. The collector (`hotspots-history.ts`) is reused UNCHANGED. Squash repos
// degrade write-once-birth-burst; blobless clones degrade large-file-cold; both are
// disclosed on the section.

import {
  ageDaysOf,
  aggregateFiles,
  directoryCommits,
  type FileAggregate,
  lastRepoCommitMsByAuthor,
  median,
} from "./coldspots-aggregate.js";
import { type AmplifierThresholds, fireAmplifiers } from "./coldspots-amplifiers.js";
import {
  COLDSPOT_IN_WINDOW_CANDIDATE_MODEL,
  type ColdspotAmplifierKind,
  type ColdspotRow,
  type ColdspotSection,
  type ColdspotThresholds,
} from "./coldspots-format.js";
import { buildCommitIntentOverlay } from "./commit-intent.js";
import { aggregateAuthors, recentSubjects, shellQuoteArg } from "./hotspots-actionability.js";
import { type CollectedHistory, type CommitRecord, newestTimestamp } from "./hotspots-history.js";

// --- thresholds (named, overridable) ----------------------------------------

export const DEFAULT_COLDSPOT_AGE_THRESHOLD_DAYS = 30; // absolute floor: a coldspot must be quiet at least this long.
export const DEFAULT_COLDSPOT_REVISION_FLOOR = 2; // a coldspot is barely touched in-window.
export const DEFAULT_COLDSPOT_AGE_STANDOUT_FACTOR = 2; // inverted churn: age ≥ factor × median touched-set age.
export const DEFAULT_NEIGHBORHOOD_CHURN_RATIO = 4; // K: dir_churn / file_churn for stale-in-hot-neighborhood.
export const DEFAULT_BIRTH_BURST_FILES = 8; // N: files in the birth commit.
export const DEFAULT_BIRTH_BURST_LINES = 200; // M: lines added in the birth commit.
export const DEFAULT_GONE_SILENT_DAYS = 60; // dominant author's last repo-wide commit older than this.
export const DEFAULT_LARGE_FILE_CHURN_LINES = 400; // size proxy: accumulated added+deleted across the window.

export type ReduceColdspotOptions = {
  readonly top: number;
  readonly ageThresholdDays?: number;
  readonly revisionFloor?: number;
  readonly ageStandoutFactor?: number;
  readonly neighborhoodChurnRatio?: number;
  readonly birthBurstFiles?: number;
  readonly birthBurstLines?: number;
  readonly goneSilentDays?: number;
  readonly largeFileChurnLines?: number;
};

type ResolvedThresholds = AmplifierThresholds & {
  readonly ageThresholdDays: number;
  readonly revisionFloor: number;
  readonly ageStandoutFactor: number;
};

export function reduceColdspot(
  history: CollectedHistory,
  options: ReduceColdspotOptions,
): ColdspotSection {
  const resolved = resolveThresholds(options);
  const referenceMs = newestTimestamp(history.records);
  // Squash degrades write-once-birth-burst; blobless degrades large-file-cold.
  const squashed = history.squashReason !== null;
  const aggregates = aggregateFiles(history.records);
  const dirCommits = directoryCommits(history.records);
  const lastRepoCommitByAuthor = lastRepoCommitMsByAuthor(history.records);

  const ages = [...aggregates.values()]
    .map((aggregate) => ageDaysOf(referenceMs, aggregate.newestTouchMs))
    .filter((age): age is number => age !== null);
  const medianAgeDays = median(ages);
  // Inverted median-standout: a coldspot must be at least factor × the median
  // touched-set age, AND past the absolute floor — so a uniformly-old window does
  // not surface everything.
  const ageStandout = Math.max(
    resolved.ageThresholdDays,
    resolved.ageStandoutFactor * medianAgeDays,
  );

  const qualified = [...aggregates.entries()]
    .map(([path, aggregate]) =>
      buildRow({
        path,
        aggregate,
        history,
        referenceMs,
        resolved,
        ageStandout,
        squashed,
        dirCommits,
        lastRepoCommitByAuthor,
      }),
    )
    .filter((row): row is ColdspotRow => row !== null)
    .sort(compareRows);
  // `--top` is only a DISPLAY cap; the amplifier/threshold gate above is the real
  // filter. Carry the full qualified count so the renderers can disclose truncation
  // (drift:ai never presents a capped subset as if complete).
  const rows = qualified.slice(0, options.top);

  return {
    lens: "coldspot",
    thresholds: thresholdsFor(resolved, medianAgeDays),
    candidateModel: COLDSPOT_IN_WINDOW_CANDIDATE_MODEL,
    amplifiersInPlay: liveAmplifiers(squashed, history.linesAvailable),
    degradations: collectDegradations(squashed, history.linesAvailable),
    totalQualified: qualified.length,
    emptyReason: rows.length === 0 ? emptyReason(aggregates.size) : null,
    entries: rows,
  };
}

type BuildRowContext = {
  readonly path: string;
  readonly aggregate: FileAggregate;
  readonly history: CollectedHistory;
  readonly referenceMs: number | null;
  readonly resolved: ResolvedThresholds;
  readonly ageStandout: number;
  readonly squashed: boolean;
  readonly dirCommits: Map<string, number>;
  readonly lastRepoCommitByAuthor: Map<string, number>;
};

function buildRow(context: BuildRowContext): ColdspotRow | null {
  const { path, aggregate, resolved, referenceMs } = context;
  const ageDays = ageDaysOf(referenceMs, aggregate.newestTouchMs);
  if (ageDays === null) return null;
  // Gate part 1+2: absolute age floor + inverted-median standout, AND revision floor.
  if (ageDays <= resolved.ageThresholdDays || ageDays < context.ageStandout) return null;
  if (aggregate.revisions > resolved.revisionFloor) return null;

  const amplifiers = fireAmplifiers({
    path,
    aggregate,
    history: context.history,
    referenceMs,
    ageDays,
    thresholds: resolved,
    squashed: context.squashed,
    dirCommits: context.dirCommits,
    lastRepoCommitByAuthor: context.lastRepoCommitByAuthor,
  });
  if (amplifiers.length === 0) return null; // Gate part 3: ≥1 amplifier or it is not surfaced.

  const touches = (record: CommitRecord): boolean =>
    record.files.some((file) => file.path === path);
  const subjects = recentSubjects(context.history.records, touches);
  return {
    path,
    ageDays,
    revisions: aggregate.revisions,
    churnLines: aggregate.churnLines,
    amplifiers,
    score: amplifiers.length * 100000 + ageDays, // amplifier count dominates; age breaks ties.
    authors: aggregateAuthors(context.history.records, touches),
    recentSubjects: subjects,
    commitIntent: buildCommitIntentOverlay(subjects),
    inspectCommand: `git log --oneline -- ${shellQuoteArg(path)}`,
    baseline: null,
  };
}

function resolveThresholds(options: ReduceColdspotOptions): ResolvedThresholds {
  return {
    ageThresholdDays: options.ageThresholdDays ?? DEFAULT_COLDSPOT_AGE_THRESHOLD_DAYS,
    revisionFloor: options.revisionFloor ?? DEFAULT_COLDSPOT_REVISION_FLOOR,
    ageStandoutFactor: options.ageStandoutFactor ?? DEFAULT_COLDSPOT_AGE_STANDOUT_FACTOR,
    neighborhoodChurnRatio: options.neighborhoodChurnRatio ?? DEFAULT_NEIGHBORHOOD_CHURN_RATIO,
    birthBurstFiles: options.birthBurstFiles ?? DEFAULT_BIRTH_BURST_FILES,
    birthBurstLines: options.birthBurstLines ?? DEFAULT_BIRTH_BURST_LINES,
    goneSilentDays: options.goneSilentDays ?? DEFAULT_GONE_SILENT_DAYS,
    largeFileChurnLines: options.largeFileChurnLines ?? DEFAULT_LARGE_FILE_CHURN_LINES,
  };
}

function thresholdsFor(resolved: ResolvedThresholds, medianAgeDays: number): ColdspotThresholds {
  return {
    ageThresholdDays: resolved.ageThresholdDays,
    revisionFloor: resolved.revisionFloor,
    ageStandoutFactor: resolved.ageStandoutFactor,
    medianAgeDays,
    neighborhoodChurnRatio: resolved.neighborhoodChurnRatio,
    birthBurstFiles: resolved.birthBurstFiles,
    birthBurstLines: resolved.birthBurstLines,
    goneSilentDays: resolved.goneSilentDays,
    largeFileChurnLines: resolved.largeFileChurnLines,
  };
}

function collectDegradations(squashed: boolean, linesAvailable: boolean): string[] {
  const notes: string[] = [];
  if (squashed) {
    notes.push(
      "write-once-birth-burst disabled: squash-merge workflow suspected, so a single in-window revision is not meaningful.",
    );
  }
  if (!linesAvailable) {
    notes.push(
      "large-file-cold disabled: line counts unavailable on a blobless partial clone, so the size proxy cannot be computed.",
    );
  }
  return notes;
}

function liveAmplifiers(squashed: boolean, linesAvailable: boolean): ColdspotAmplifierKind[] {
  const live: ColdspotAmplifierKind[] = ["stale-in-hot-neighborhood", "gone-silent-author"];
  if (!squashed) live.push("write-once-birth-burst");
  if (linesAvailable) live.push("large-file-cold");
  return live;
}

// Higher score first (more amplifiers, then older); ties break on path for
// determinism — same shape as the hotspots lenses.
function compareRows(left: ColdspotRow, right: ColdspotRow): number {
  if (right.score !== left.score) return right.score - left.score;
  return left.path.localeCompare(right.path, "en");
}

function emptyReason(touchedFiles: number): string {
  if (touchedFiles === 0) {
    return "no files changed in-window, so the in-window-touched coldspot candidate set is empty; current files with no in-window commits are outside this lens.";
  }
  return "no in-window coldspots (no in-window-touched file is old + barely-touched with an amplifier firing; current files with no in-window commits are outside this lens).";
}
