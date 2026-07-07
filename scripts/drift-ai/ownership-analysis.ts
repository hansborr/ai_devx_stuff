import { buildCommitIntentOverlay } from "./commit-intent.js";
import { recentSubjects, shellQuoteArg } from "./hotspots-actionability.js";
import type { CommitRecord } from "./hotspots-history.js";
import {
  aggregateFileOwnership,
  contributorsFor,
  type FileOwnershipAggregate,
  firstContributor,
  newestCommitMs,
  parseDateMs,
  repoLastAuthorCommitDates,
  withRepoCommitDate,
} from "./ownership-aggregation.js";
import { compileAgentMatchers, identityKey } from "./ownership-identities.js";
import type {
  MailmapIdentityResolver,
  OwnershipAdvisoryRow,
  OwnershipChangeSplit,
  OwnershipIdentity,
} from "./ownership-types.js";
import { DAY_MS } from "./time-constants.js";

export function buildOwnershipRows(input: {
  readonly records: readonly CommitRecord[];
  readonly linesAvailable: boolean;
  readonly agentIdentityPatterns: readonly string[];
  readonly mailmap: MailmapIdentityResolver;
}): OwnershipAdvisoryRow[] {
  const referenceMs = newestCommitMs(input.records);
  const repoLastCommitByAuthor = repoLastAuthorCommitDates(input.records, input.mailmap);
  const aggregates = aggregateFileOwnership({
    records: input.records,
    agentMatchers: compileAgentMatchers(input.agentIdentityPatterns),
    mailmap: input.mailmap,
  });
  return [...aggregates.values()]
    .map((aggregate) =>
      rowForAggregate(aggregate, {
        records: input.records,
        referenceMs,
        repoLastCommitByAuthor,
        linesAvailable: input.linesAvailable,
      }),
    )
    .filter((row): row is OwnershipAdvisoryRow => row !== null)
    .sort(compareRows)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function rowForAggregate(
  aggregate: FileOwnershipAggregate,
  input: {
    readonly records: readonly CommitRecord[];
    readonly referenceMs: number | null;
    readonly repoLastCommitByAuthor: ReadonlyMap<string, string>;
    readonly linesAvailable: boolean;
  },
): OwnershipAdvisoryRow | null {
  const dominant = firstContributor(aggregate.handContributors);
  const author = firstContributor(aggregate.authorContributors);
  const firstAuthor = aggregate.firstAuthor;
  if (dominant === null || author === null || firstAuthor === null) return null;

  const dominantWithRepo = withRepoCommitDate(dominant, input.repoLastCommitByAuthor);
  const authorWithRepo = withRepoCommitDate(author, input.repoLastCommitByAuthor);
  const ownerShare = divide(dominant.changes, aggregate.totalHandChanges);
  const lineShare =
    input.linesAvailable && aggregate.totalHandLines > 0
      ? divide(dominant.linesChanged, aggregate.totalHandLines)
      : null;
  const ownerLastRepoCommitDate = dominantWithRepo.lastRepoCommitDate;
  const ownerLastTouchDate = dominantWithRepo.lastTouchDate;
  const touches = (record: CommitRecord): boolean =>
    record.files.some((file) => file.path === aggregate.path);
  const subjects = recentSubjects(input.records, touches);
  return {
    rank: 0,
    path: aggregate.path,
    firstAuthor,
    dominantOwner: dominantWithRepo,
    author: authorWithRepo,
    coAuthors: contributorsFor(aggregate.coAuthorContributors, input.repoLastCommitByAuthor),
    agentHands: contributorsFor(aggregate.agentContributors, input.repoLastCommitByAuthor),
    ownershipChanges: splitChanges(dominant.changes, aggregate.totalHandChanges),
    authoredChanges: splitChanges(dominant.authoredChanges, aggregate.totalAuthoredChanges),
    ownerShare: round2(ownerShare),
    lineShare: lineShare === null ? null : round2(lineShare),
    firstAuthorIsDominantOwner: sameIdentity(firstAuthor, dominant.identity),
    ownerLastTouchDate,
    ownerLastRepoCommitDate,
    ownerTouchRecencyDays: recencyDays(input.referenceMs, ownerLastTouchDate),
    ownerRepoRecencyDays: recencyDays(input.referenceMs, ownerLastRepoCommitDate),
    ownershipScore: round2(ownerShare),
    recentSubjects: subjects,
    commitIntent: buildCommitIntentOverlay(subjects),
    inspectCommand: `git log --oneline -- ${shellQuoteArg(aggregate.path)}`,
  };
}

function sameIdentity(left: OwnershipIdentity, right: OwnershipIdentity): boolean {
  return identityKey(left) === identityKey(right);
}

function splitChanges(own: number, total: number): OwnershipChangeSplit {
  return { own, other: Math.max(0, total - own), total };
}

function recencyDays(referenceMs: number | null, date: string | null): number | null {
  if (referenceMs === null || date === null) return null;
  const ms = parseDateMs(date);
  if (ms === null) return null;
  return Math.max(0, Math.ceil((referenceMs - ms) / DAY_MS));
}

function divide(numerator: number, denominator: number): number {
  return denominator <= 0 ? 0 : numerator / denominator;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function compareRows(left: OwnershipAdvisoryRow, right: OwnershipAdvisoryRow): number {
  return (
    right.ownershipScore - left.ownershipScore ||
    (right.ownerRepoRecencyDays ?? -1) - (left.ownerRepoRecencyDays ?? -1) ||
    left.path.localeCompare(right.path, "en")
  );
}
