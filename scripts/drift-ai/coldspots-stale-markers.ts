// Stale-markers lens: an AI-specific "promised and forgotten" signal (spec: the
// "Companion lens — stale-marker aging" in docs/agent_notes/backlog/
// drift-ai-next-checks-brainstorm.md). Scans source files for the maintenance-marker
// keywords listed in STALE_MARKER_KINDS, restricted to comment regions, ages each by
// its git-blame introduction date, and surfaces a file when its OLDEST marker crosses
// an age threshold. Evidence, not verdicts: a marker is never claimed wrong, only
// disclosed as aged.
//
// Cost + degradation discipline (matching how thrash discloses blame cost and the
// coldspot lens discloses its degradations):
//   - blame is gated behind the cheap in-memory scan — only files that actually
//     contain a marker are blamed.
//   - on a blobless partial clone blame is skipped entirely (it would lazily fetch
//     blobs and hang); the lens still surfaces marker COUNTS but discloses that ages
//     are unavailable rather than guessing.
//   - marker-bearing files with uncommitted changes are not blamed against HEAD:
//     working-tree line numbers may have shifted, so they degrade to age-unknown and
//     cannot clear the stale age gate.
//   - a single marker line blame can't resolve degrades to age-unknown for that
//     marker without dropping the file's other markers.
//
// Scanning lives in `coldspots-markers.ts`; blame parsing in `coldspots-blame.ts`.

import { blameLineIntroductions, type LineIntroduction } from "./coldspots-blame.js";
import type { StaleMarkerOrigin, StaleMarkerRow, StaleMarkerSection } from "./coldspots-format.js";
import {
  scanStaleMarkers,
  STALE_MARKER_KINDS,
  type StaleMarker,
  type StaleMarkerKind,
} from "./coldspots-markers.js";
import type { GitRunner } from "./git-changed-scope.js";
import { shellQuoteArg } from "./hotspots-actionability.js";

// Empirical anchor (Morlion): the median such marker lives ~246 days, and ~62% of
// live ones are over a year old. 180d is a conservative "aged enough to be worth a
// look" floor below that median.
export const DEFAULT_STALE_MARKER_AGE_THRESHOLD_DAYS = 180;

const DAY_MS = 24 * 60 * 60 * 1000;

export type ReduceStaleMarkersOptions = {
  readonly files: readonly string[]; // repo-relative candidate paths (already scope/ignore-filtered)
  readonly readFile: (path: string) => string | undefined;
  readonly git: GitRunner; // anchored at repoRoot by the caller; used for status/blame
  readonly repoRoot: string;
  readonly agesAvailable: boolean; // false on a blobless clone → skip blame, disclose
  readonly nowMs: number; // reference "now" for aging
  readonly ageThresholdDays?: number;
  readonly top?: number;
};

// `first` + `rest` express the non-empty invariant (scanFiles only keeps files with
// ≥1 marker) in the type, so the reducer never indexes a possibly-empty array.
type FileScan = {
  readonly path: string;
  readonly first: StaleMarker;
  readonly rest: readonly StaleMarker[];
  readonly all: readonly StaleMarker[];
};

type BuiltRow = {
  readonly row: StaleMarkerRow;
  readonly skippedDirtyBlame: boolean;
};

export function reduceStaleMarkers(options: ReduceStaleMarkersOptions): StaleMarkerSection {
  const ageThresholdDays = options.ageThresholdDays ?? DEFAULT_STALE_MARKER_AGE_THRESHOLD_DAYS;
  const scans = scanFiles(options.files, options.readFile);
  const builtRows = scans.map((scan) => buildRow(scan, options));
  const dirtyMarkerFiles = builtRows.filter((built) => built.skippedDirtyBlame).length;
  const qualified = builtRows
    .map((built) => built.row)
    .filter((row) => qualifies(row, ageThresholdDays, options.agesAvailable))
    .sort(compareRows);
  // `--top` is a DISPLAY cap only; the age gate above is the real filter. Carry the
  // full qualified count so the renderers disclose truncation rather than presenting
  // a capped subset as complete.
  const entries = options.top === undefined ? qualified : qualified.slice(0, options.top);
  return {
    lens: "stale-markers",
    thresholds: { ageThresholdDays },
    markerKinds: STALE_MARKER_KINDS,
    agesAvailable: options.agesAvailable,
    referenceDate: new Date(options.nowMs).toISOString().slice(0, 10),
    filesScanned: options.files.length,
    degradations: degradations(options.agesAvailable, dirtyMarkerFiles),
    totalQualified: qualified.length,
    emptyReason:
      entries.length === 0
        ? emptyReason(scans.length, options.agesAvailable, dirtyMarkerFiles)
        : null,
    entries,
  };
}

// Scan only readable files; keep just those with ≥1 marker so blame is gated behind
// the cheap scan.
function scanFiles(
  files: readonly string[],
  readFile: (path: string) => string | undefined,
): FileScan[] {
  const scans: FileScan[] = [];
  for (const path of files) {
    const source = readFile(path);
    if (source === undefined) continue;
    const markers = scanStaleMarkers(source);
    const [first, ...rest] = markers;
    if (first !== undefined) scans.push({ path, first, rest, all: markers });
  }
  return scans;
}

function buildRow(scan: FileScan, options: ReduceStaleMarkersOptions): BuiltRow {
  const skippedDirtyBlame = options.agesAvailable && markerFileDirty(options.git, scan.path);
  const fileAgesAvailable = options.agesAvailable && !skippedDirtyBlame;
  const blame = fileAgesAvailable
    ? blameLineIntroductions({ git: options.git, repoRoot: options.repoRoot, path: scan.path })
    : new Map<number, LineIntroduction>();
  const oldest = oldestMarker(scan.first, scan.rest, blame, fileAgesAvailable);
  const ageDays = oldestAgeDays(oldest, blame, options.nowMs, fileAgesAvailable);
  return {
    row: {
      path: scan.path,
      oldestMarkerAgeDays: ageDays,
      oldestMarker: toOrigin(oldest, blame, fileAgesAvailable),
      countsByType: countByType(scan.all),
      totalMarkers: scan.all.length,
      inspectCommand: `git blame -L ${oldest.lineNumber},${oldest.lineNumber} -- ${shellQuoteArg(scan.path)}`,
      score: ageDays ?? 0,
      baseline: null,
    },
    skippedDirtyBlame,
  };
}

function markerFileDirty(git: GitRunner, path: string): boolean {
  try {
    return git(["status", "--porcelain", "--untracked-files=all", "--", path]).trim().length > 0;
  } catch {
    // If the safety check cannot prove the worktree path matches HEAD, avoid blame
    // rather than risk attributing a shifted marker line to an unrelated commit.
    return true;
  }
}

// The oldest marker is the one with the earliest introduction date. When ages are
// available we rank by blame time (markers with no resolvable time sort last); when
// they are not, we keep source order (the first marker) since age is unknown anyway.
// `first` is passed explicitly so the non-empty invariant (scanFiles drops files
// with no markers) is expressed in the type without an index assertion.
function oldestMarker(
  first: StaleMarker,
  rest: readonly StaleMarker[],
  blame: Map<number, LineIntroduction>,
  agesAvailable: boolean,
): StaleMarker {
  if (!agesAvailable) return first;
  let oldest = first;
  let oldestMs = introducedMs(first, blame);
  for (const marker of rest) {
    const ms = introducedMs(marker, blame);
    if (ms !== null && (oldestMs === null || ms < oldestMs)) {
      oldest = marker;
      oldestMs = ms;
    }
  }
  return oldest;
}

function introducedMs(
  marker: StaleMarker | undefined,
  blame: Map<number, LineIntroduction>,
): number | null {
  if (marker === undefined) return null;
  const intro = blame.get(marker.lineNumber);
  if (intro === undefined || Number.isNaN(intro.introducedAtMs)) return null;
  return intro.introducedAtMs;
}

function oldestAgeDays(
  oldest: StaleMarker,
  blame: Map<number, LineIntroduction>,
  nowMs: number,
  agesAvailable: boolean,
): number | null {
  if (!agesAvailable) return null;
  const ms = introducedMs(oldest, blame);
  if (ms === null) return null;
  return Math.max(0, Math.floor((nowMs - ms) / DAY_MS));
}

function toOrigin(
  oldest: StaleMarker,
  blame: Map<number, LineIntroduction>,
  agesAvailable: boolean,
): StaleMarkerOrigin {
  const intro = agesAvailable ? blame.get(oldest.lineNumber) : undefined;
  const ms =
    intro === undefined || Number.isNaN(intro.introducedAtMs) ? null : intro.introducedAtMs;
  return {
    kind: oldest.kind,
    lineNumber: oldest.lineNumber,
    text: oldest.text,
    author: intro?.author ?? null,
    sha: intro?.sha ?? null,
    introducedAt: ms === null ? null : new Date(ms).toISOString().slice(0, 10),
  };
}

function countByType(markers: readonly StaleMarker[]): Record<StaleMarkerKind, number> {
  const counts: Record<StaleMarkerKind, number> = {
    TODO: 0,
    FIXME: 0,
    HACK: 0,
    XXX: 0,
    "@deprecated": 0,
  };
  for (const marker of markers) counts[marker.kind] += 1;
  return counts;
}

// When ages are available a row qualifies only if its oldest marker cleared the
// threshold (an unknown age cannot clear it, so it is dropped). On a blobless clone
// ages are unknown for everyone, so every file with a marker qualifies — the counts
// are the evidence and the missing ages are disclosed on the section.
function qualifies(row: StaleMarkerRow, ageThresholdDays: number, agesAvailable: boolean): boolean {
  if (!agesAvailable) return true;
  return row.oldestMarkerAgeDays !== null && row.oldestMarkerAgeDays > ageThresholdDays;
}

// Oldest first; ties break on path for determinism (same shape as the other lenses).
function compareRows(left: StaleMarkerRow, right: StaleMarkerRow): number {
  if (right.score !== left.score) return right.score - left.score;
  return left.path.localeCompare(right.path, "en");
}

function degradations(agesAvailable: boolean, dirtyMarkerFiles: number): string[] {
  const notes: string[] = [];
  if (!agesAvailable) {
    notes.push(
      "marker ages unavailable: blobless partial clone, so git blame is skipped (it would lazily fetch blobs); marker counts still surface.",
    );
  }
  if (dirtyMarkerFiles > 0) {
    const fileLabel =
      dirtyMarkerFiles === 1 ? "1 marker-bearing file" : `${dirtyMarkerFiles} marker-bearing files`;
    notes.push(
      `marker ages unavailable for ${fileLabel} with uncommitted changes; skipped git blame to avoid matching working-tree marker lines to HEAD.`,
    );
  }
  return notes;
}

function emptyReason(
  filesWithMarkers: number,
  agesAvailable: boolean,
  dirtyMarkerFiles: number,
): string {
  if (filesWithMarkers === 0) return "no stale markers found in the scanned files.";
  if (!agesAvailable) return "no stale markers this scan.";
  if (dirtyMarkerFiles > 0) {
    const fileLabel =
      dirtyMarkerFiles === 1 ? "1 marker-bearing file" : `${dirtyMarkerFiles} marker-bearing files`;
    return `no stale markers this scan (no clean marker file has a marker older than the age threshold; ${fileLabel} with uncommitted changes skipped blame).`;
  }
  return "no stale markers this scan (no file has a marker older than the age threshold).";
}
