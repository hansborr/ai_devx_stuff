// Author/agent fragmentation lens: files touched by many distinct hands in the
// window. Commit authors and Co-authored-by trailers both count; trailers are
// how agent hands surface in squash-heavy workflows.

import { buildPathRowActionability } from "./hotspots-actionability.js";
import type { FragmentationHotspot, FragmentationSection } from "./hotspots-format.js";
import type { CollectedHistory, CommitRecord } from "./hotspots-history.js";

const DEFAULT_FRAGMENTATION_MIN_HANDS = 3;
const HAND_SAMPLE_LIMIT = 12;

export type ReduceFragmentationOptions = {
  readonly top: number;
  readonly minHands?: number;
};

type FragmentationAggregate = {
  readonly authors: Set<string>;
  readonly trailers: Set<string>;
  revisions: number;
};

type FragmentationCandidate = {
  readonly path: string;
  readonly distinctHands: number;
  readonly authorHands: number;
  readonly trailerHands: number;
  readonly sampleHands: readonly string[];
  readonly revisions: number;
  readonly score: number;
};

export function reduceFragmentation(
  history: CollectedHistory,
  options: ReduceFragmentationOptions,
): FragmentationSection {
  const minHands = options.minHands ?? DEFAULT_FRAGMENTATION_MIN_HANDS;
  const candidates = [...aggregateFragmentation(history.records).entries()]
    .map(([path, aggregate]) => toCandidate(path, aggregate))
    .filter((candidate) => candidate.distinctHands >= minHands)
    .sort(compareCandidates)
    .slice(0, options.top);
  return {
    lens: "fragmentation",
    minHands,
    emptyReason:
      candidates.length === 0
        ? `no author/agent fragmentation hotspots this window (all files have fewer than ${minHands} distinct hands).`
        : null,
    entries: candidates.map((candidate) => withContext(candidate, history.records)),
  };
}

function aggregateFragmentation(
  records: readonly CommitRecord[],
): Map<string, FragmentationAggregate> {
  const byPath = new Map<string, FragmentationAggregate>();
  for (const record of records) {
    const paths = new Set(record.files.map((file) => file.path));
    for (const path of paths) {
      const aggregate = byPath.get(path) ?? {
        authors: new Set<string>(),
        trailers: new Set<string>(),
        revisions: 0,
      };
      aggregate.authors.add(record.authorName.trim());
      for (const coAuthor of record.coAuthors) aggregate.trailers.add(displayName(coAuthor));
      aggregate.revisions += 1;
      byPath.set(path, aggregate);
    }
  }
  return byPath;
}

function displayName(coAuthor: string): string {
  const angle = coAuthor.indexOf("<");
  return (angle < 0 ? coAuthor : coAuthor.slice(0, angle)).trim();
}

function toCandidate(path: string, aggregate: FragmentationAggregate): FragmentationCandidate {
  const authorHands = compactSorted(aggregate.authors);
  const trailerHands = compactSorted(aggregate.trailers);
  const hands = compactSorted(new Set([...authorHands, ...trailerHands]));
  return {
    path,
    distinctHands: hands.length,
    authorHands: authorHands.length,
    trailerHands: trailerHands.length,
    sampleHands: hands.slice(0, HAND_SAMPLE_LIMIT),
    revisions: aggregate.revisions,
    score: hands.length,
  };
}

function compactSorted(values: Set<string>): string[] {
  return [...values]
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .sort((left, right) => left.localeCompare(right, "en"));
}

function compareCandidates(left: FragmentationCandidate, right: FragmentationCandidate): number {
  if (right.score !== left.score) return right.score - left.score;
  if (right.revisions !== left.revisions) return right.revisions - left.revisions;
  return left.path.localeCompare(right.path, "en");
}

function withContext(
  candidate: FragmentationCandidate,
  records: readonly CommitRecord[],
): FragmentationHotspot {
  return { ...candidate, ...buildPathRowActionability(records, candidate.path) };
}
