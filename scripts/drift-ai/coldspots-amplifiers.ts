// The four coldspot amplifiers. A coldspot is only surfaced when ≥1 of these fires
// (the reducer enforces the age/revision gate first). All are git+fs only, derived
// from the SAME collected history. Each returns a self-documenting `ColdspotAmplifier`
// (kind + legible detail + raw numbers) or null when it does not fire.
//
// Degradations are handled by the reducer disclosing them and by two amplifiers
// declining to fire: write-once-birth-burst on a squash repo (single-revision is
// meaningless), large-file-cold on a blobless clone (no line counts).

import { dirnameOf, type FileAggregate, round2 } from "./coldspots-aggregate.js";
import type { ColdspotAmplifier } from "./coldspots-format.js";
import { aggregateAuthors } from "./hotspots-actionability.js";
import type { CollectedHistory, CommitRecord } from "./hotspots-history.js";

export type AmplifierThresholds = {
  readonly neighborhoodChurnRatio: number;
  readonly birthBurstFiles: number;
  readonly birthBurstLines: number;
  readonly goneSilentDays: number;
  readonly largeFileChurnLines: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export type AmplifierContext = {
  readonly path: string;
  readonly aggregate: FileAggregate;
  readonly history: CollectedHistory;
  readonly referenceMs: number | null;
  readonly ageDays: number;
  readonly thresholds: AmplifierThresholds;
  readonly squashed: boolean;
  readonly dirCommits: Map<string, number>; // distinct commits touching each dir
  readonly lastRepoCommitByAuthor: Map<string, number>;
};

export function fireAmplifiers(context: AmplifierContext): ColdspotAmplifier[] {
  const fired: ColdspotAmplifier[] = [];
  for (const amplifier of [
    staleInHotNeighborhood,
    writeOnceBirthBurst,
    goneSilentAuthor,
    largeFileCold,
  ]) {
    const result = amplifier(context);
    if (result !== null) fired.push(result);
  }
  return fired;
}

// Amplifier 1 (strongest): the file's directory churns while the file does not.
// Directory churn is the count of DISTINCT COMMITS touching the dir (comparable to
// the file's own revision count), so a one-time multi-file scaffold no longer reads
// as an actively churning neighborhood.
function staleInHotNeighborhood(context: AmplifierContext): ColdspotAmplifier | null {
  const { path, aggregate, thresholds, dirCommits } = context;
  const dir = dirnameOf(path);
  if (dir === "") return null;
  const dirChurn = dirCommits.get(dir) ?? 0;
  const fileChurn = aggregate.revisions;
  if (fileChurn <= 0) return null;
  const ratio = dirChurn / fileChurn;
  if (ratio < thresholds.neighborhoodChurnRatio) return null;
  return {
    kind: "stale-in-hot-neighborhood",
    detail: `dir '${dir || "."}' has ${dirChurn} commits vs this file's ${fileChurn} revisions (ratio ${round2(
      ratio,
    )} >= ${thresholds.neighborhoodChurnRatio})`,
    numbers: { dirCommits: dirChurn, fileRevisions: fileChurn, ratio: round2(ratio) },
  };
}

// Amplifier 2: introduced in a genuinely large multi-file commit and never
// meaningfully touched since — the "agent scaffolded a module in one run and nobody
// revisited it" signal. Requires the birth commit to be BOTH multi-file AND
// substantial (commit-wide added lines), so a solo large edit does not fire. The
// line count is COMMIT-WIDE (the whole scaffold), not just this file's slice.
// Degrades to OFF on squash repos (single-revision is meaningless).
function writeOnceBirthBurst(context: AmplifierContext): ColdspotAmplifier | null {
  if (context.squashed) return null;
  const { aggregate, thresholds } = context;
  if (aggregate.revisions > 1) return null; // "meaningfully touched since" → not write-once.
  const bigByFiles = aggregate.birthFileCount >= thresholds.birthBurstFiles;
  const bigByLines = aggregate.birthLinesAdded >= thresholds.birthBurstLines;
  if (!bigByFiles || !bigByLines) return null;
  return {
    kind: "write-once-birth-burst",
    detail: `born in a ${aggregate.birthFileCount}-file / ${aggregate.birthLinesAdded}-line(+) commit-wide scaffold and untouched since (revisions ${aggregate.revisions})`,
    numbers: {
      birthFileCount: aggregate.birthFileCount,
      birthCommitLinesAdded: aggregate.birthLinesAdded,
      revisions: aggregate.revisions,
    },
  };
}

// Amplifier 3: the file's dominant author's most-recent repo-wide commit (in the
// window) is older than the gone-silent threshold — orphaned ownership / bus factor.
function goneSilentAuthor(context: AmplifierContext): ColdspotAmplifier | null {
  const { path, history, referenceMs, ageDays, thresholds, lastRepoCommitByAuthor } = context;
  if (referenceMs === null) return null;
  const touches = (record: CommitRecord): boolean =>
    record.files.some((file) => file.path === path);
  const dominant = aggregateAuthors(history.records, touches, 1)[0];
  if (dominant === undefined) return null;
  const lastCommitMs = lastRepoCommitByAuthor.get(dominant.name);
  if (lastCommitMs === undefined) return null; // a co-author-only hand has no %an commit to measure.
  const silentDays = Math.max(0, Math.ceil((referenceMs - lastCommitMs) / DAY_MS));
  if (silentDays < thresholds.goneSilentDays) return null;
  return {
    kind: "gone-silent-author",
    detail: `dominant author '${dominant.name}' last committed repo-wide ${silentDays}d ago (>= ${thresholds.goneSilentDays}d); file age ${ageDays}d`,
    numbers: { dominantAuthorSilentDays: silentDays, fileAgeDays: ageDays },
  };
}

// Amplifier 4 (secondary): size proxy = accumulated churn (added+deleted) across
// the window. A larger cold file is higher-stakes. Off on blobless clones.
function largeFileCold(context: AmplifierContext): ColdspotAmplifier | null {
  if (!context.history.linesAvailable) return null;
  const { aggregate, thresholds } = context;
  if (aggregate.churnLines < thresholds.largeFileChurnLines) return null;
  return {
    kind: "large-file-cold",
    detail: `accumulated churn ${aggregate.churnLines} lines (size proxy) >= ${thresholds.largeFileChurnLines}`,
    numbers: { churnLines: aggregate.churnLines, threshold: thresholds.largeFileChurnLines },
  };
}
