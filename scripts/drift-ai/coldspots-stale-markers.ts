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
import { DAY_MS } from "./time-constants.js";

// Empirical anchor (Morlion): the median such marker lives ~246 days, and ~62% of
// live ones are over a year old. 180d is a conservative "aged enough to be worth a
// look" floor below that median.
export const DEFAULT_STALE_MARKER_AGE_THRESHOLD_DAYS = 180;

export type ReduceStaleMarkersOptions = {
  readonly files: readonly string[]; // repo-relative candidate paths (already scope/ignore-filtered)
  readonly readFile: (path: string) => string | undefined;
  readonly git: GitRunner; // anchored when constructed by the caller; used for status/blame
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

// Why a marker-bearing file's blame was skipped, so the disclosure can name the cause
// and the count splits stay separate. `dirty` = uncommitted changes shown by status;
// `hidden-index` = an assume-unchanged/skip-worktree flag (or an unverifiable probe)
// that lets the worktree diverge from HEAD without showing in status.
type BlameSkipReason = "dirty" | "hidden-index";

type BuiltRow = {
  readonly row: StaleMarkerRow;
  readonly blameSkip: BlameSkipReason | null;
};

export function reduceStaleMarkers(options: ReduceStaleMarkersOptions): StaleMarkerSection {
  const ageThresholdDays = options.ageThresholdDays ?? DEFAULT_STALE_MARKER_AGE_THRESHOLD_DAYS;
  const scans = scanFiles(options.files, options.readFile);
  const builtRows = scans.map((scan) => buildRow(scan, options));
  const dirtyMarkerFiles = builtRows.filter((built) => built.blameSkip === "dirty").length;
  const hiddenIndexMarkerFiles = builtRows.filter(
    (built) => built.blameSkip === "hidden-index",
  ).length;
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
    degradations: degradations(options.agesAvailable, dirtyMarkerFiles, hiddenIndexMarkerFiles),
    totalQualified: qualified.length,
    emptyReason:
      entries.length === 0
        ? emptyReason(scans.length, options.agesAvailable, dirtyMarkerFiles, hiddenIndexMarkerFiles)
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
  // Only probe blame safety when ages are even available (a blobless clone skips blame
  // wholesale upstream), so the extra git calls stay gated behind marker-bearing files.
  const blameSkip = options.agesAvailable ? blameSkipReason(options.git, scan.path) : null;
  const fileAgesAvailable = options.agesAvailable && blameSkip === null;
  const blame = fileAgesAvailable
    ? blameLineIntroductions({ git: options.git, path: scan.path })
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
    blameSkip,
  };
}

// A marker-bearing file is unsafe to blame against HEAD when its worktree can diverge
// from HEAD. Ordinary uncommitted changes show in `git status`; git hidden-index flags
// (assume-unchanged/skip-worktree) suppress that very status signal, so they need a
// separate probe. Either way blame line numbers may no longer match HEAD. The dirty
// check runs first because it is the common case and lets us skip the second probe.
function blameSkipReason(git: GitRunner, path: string): BlameSkipReason | null {
  if (markerFileDirty(git, path)) return "dirty";
  if (markerFileHiddenIndex(git, path)) return "hidden-index";
  return null;
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

// `git ls-files -v` prints a one-char tag before each path: `S` flags skip-worktree,
// and a lowercase tag flags assume-unchanged (it lowercases whatever the base tag would
// be, e.g. `h`, `s`). Both let the worktree drift from HEAD without `git status` noticing,
// so the blamed line numbers can no longer be trusted to match the working-tree markers.
function markerFileHiddenIndex(git: GitRunner, path: string): boolean {
  try {
    const output = git(["ls-files", "-v", "--", path]);
    return output.split("\n").some(isHiddenIndexTag);
  } catch {
    // Same conservative posture as the dirty check: a failed probe cannot prove the
    // worktree matches HEAD, so treat the file as unsafe to blame.
    return true;
  }
}

function isHiddenIndexTag(line: string): boolean {
  if (line.length < 2 || line[1] !== " ") return false;
  const tag = line[0] ?? "";
  return tag === "S" || (tag >= "a" && tag <= "z");
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

function degradations(
  agesAvailable: boolean,
  dirtyMarkerFiles: number,
  hiddenIndexMarkerFiles: number,
): string[] {
  const notes: string[] = [];
  if (!agesAvailable) {
    notes.push(
      "marker ages unavailable: blobless partial clone, so git blame is skipped (it would lazily fetch blobs); marker counts still surface.",
    );
  }
  if (dirtyMarkerFiles > 0) {
    notes.push(
      `marker ages unavailable for ${markerFileLabel(dirtyMarkerFiles)} with uncommitted changes; skipped git blame to avoid matching working-tree marker lines to HEAD.`,
    );
  }
  if (hiddenIndexMarkerFiles > 0) {
    notes.push(
      `marker ages unavailable for ${markerFileLabel(hiddenIndexMarkerFiles)} with git assume-unchanged/skip-worktree flags; skipped git blame because the working tree can diverge from HEAD without showing in git status.`,
    );
  }
  return notes;
}

function markerFileLabel(count: number): string {
  return count === 1 ? "1 marker-bearing file" : `${count} marker-bearing files`;
}

function emptyReason(
  filesWithMarkers: number,
  agesAvailable: boolean,
  dirtyMarkerFiles: number,
  hiddenIndexMarkerFiles: number,
): string {
  if (filesWithMarkers === 0) return "no stale markers found in the scanned files.";
  if (!agesAvailable) return "no stale markers this scan.";
  const skipped = blameSkipClause(dirtyMarkerFiles, hiddenIndexMarkerFiles);
  if (skipped !== null) {
    return `no stale markers this scan (no clean marker file has a marker older than the age threshold; ${skipped}).`;
  }
  return "no stale markers this scan (no file has a marker older than the age threshold).";
}

// Joins the per-reason "N marker-bearing file(s) ... skipped blame" clauses for the
// empty-reason line, or null when nothing was skipped.
function blameSkipClause(dirtyMarkerFiles: number, hiddenIndexMarkerFiles: number): string | null {
  const clauses: string[] = [];
  if (dirtyMarkerFiles > 0) {
    clauses.push(`${markerFileLabel(dirtyMarkerFiles)} with uncommitted changes skipped blame`);
  }
  if (hiddenIndexMarkerFiles > 0) {
    clauses.push(
      `${markerFileLabel(hiddenIndexMarkerFiles)} with assume-unchanged/skip-worktree flags skipped blame`,
    );
  }
  return clauses.length === 0 ? null : clauses.join("; ");
}
