import type { CommitRecord } from "./hotspots-history.js";
import {
  authorIdentity,
  formatIdentity,
  identityKey,
  isAgentIdentity,
  parseIdentity,
} from "./ownership-identities.js";
import type {
  MailmapIdentityResolver,
  OwnershipContributor,
  OwnershipIdentity,
} from "./ownership-types.js";

export type ContributorAccumulator = {
  readonly identity: OwnershipIdentity;
  changes: number;
  authoredChanges: number;
  coAuthoredChanges: number;
  linesChanged: number;
  lastTouchDate: string | null;
  lastTouchMs: number | null;
};

export type FileOwnershipAggregate = {
  readonly path: string;
  readonly handContributors: Map<string, ContributorAccumulator>;
  readonly authorContributors: Map<string, ContributorAccumulator>;
  readonly coAuthorContributors: Map<string, ContributorAccumulator>;
  readonly agentContributors: Map<string, ContributorAccumulator>;
  firstAuthor: OwnershipIdentity | null;
  firstAuthorMs: number | null;
  totalAuthoredChanges: number;
  totalHandChanges: number;
  totalHandLines: number;
};

export function aggregateFileOwnership(input: {
  readonly records: readonly CommitRecord[];
  readonly agentMatchers: readonly RegExp[];
  readonly mailmap: MailmapIdentityResolver;
}): Map<string, FileOwnershipAggregate> {
  const aggregates = new Map<string, FileOwnershipAggregate>();
  for (const record of input.records) {
    const author = input.mailmap(authorIdentity(record));
    const coAuthors = record.coAuthors.map(parseIdentity).map(input.mailmap);
    const authorIsAgent = isAgentIdentity(author, input.agentMatchers);
    const coAuthorAgentFlags = coAuthors.map((identity) =>
      isAgentIdentity(identity, input.agentMatchers),
    );
    for (const file of record.files) {
      applyFileTouch({
        aggregate: aggregateFor(aggregates, file.path),
        author,
        coAuthors,
        coAuthorAgentFlags,
        authorIsAgent,
        linesChanged: file.added + file.deleted,
        authorDate: record.authorDate,
      });
    }
  }
  return aggregates;
}

function applyFileTouch(input: {
  readonly aggregate: FileOwnershipAggregate;
  readonly author: OwnershipIdentity;
  readonly coAuthors: readonly OwnershipIdentity[];
  readonly coAuthorAgentFlags: readonly boolean[];
  readonly authorIsAgent: boolean;
  readonly linesChanged: number;
  readonly authorDate: string;
}): void {
  const { aggregate, author, coAuthors, linesChanged, authorDate } = input;
  bumpContributor(aggregate.handContributors, author, linesChanged, "author");
  bumpContributor(aggregate.authorContributors, author, linesChanged, "author");
  if (input.authorIsAgent) {
    bumpContributor(aggregate.agentContributors, author, linesChanged, "author");
  }
  aggregate.totalAuthoredChanges += 1;
  aggregate.totalHandChanges += 1;
  aggregate.totalHandLines += linesChanged;
  updateFirstAuthor(aggregate, author, authorDate);
  updateAccumulatorTouch(aggregate.handContributors, author, authorDate);
  updateAccumulatorTouch(aggregate.authorContributors, author, authorDate);
  if (input.authorIsAgent) updateAccumulatorTouch(aggregate.agentContributors, author, authorDate);

  for (const [index, coAuthor] of coAuthors.entries()) {
    bumpContributor(aggregate.handContributors, coAuthor, linesChanged, "coAuthor");
    bumpContributor(aggregate.coAuthorContributors, coAuthor, linesChanged, "coAuthor");
    if (input.coAuthorAgentFlags[index] === true) {
      bumpContributor(aggregate.agentContributors, coAuthor, linesChanged, "coAuthor");
    }
    aggregate.totalHandChanges += 1;
    aggregate.totalHandLines += linesChanged;
    updateAccumulatorTouch(aggregate.handContributors, coAuthor, authorDate);
    updateAccumulatorTouch(aggregate.coAuthorContributors, coAuthor, authorDate);
    if (input.coAuthorAgentFlags[index] === true) {
      updateAccumulatorTouch(aggregate.agentContributors, coAuthor, authorDate);
    }
  }
}

function aggregateFor(
  aggregates: Map<string, FileOwnershipAggregate>,
  path: string,
): FileOwnershipAggregate {
  const existing = aggregates.get(path);
  if (existing !== undefined) return existing;
  const created: FileOwnershipAggregate = {
    path,
    handContributors: new Map(),
    authorContributors: new Map(),
    coAuthorContributors: new Map(),
    agentContributors: new Map(),
    firstAuthor: null,
    firstAuthorMs: null,
    totalAuthoredChanges: 0,
    totalHandChanges: 0,
    totalHandLines: 0,
  };
  aggregates.set(path, created);
  return created;
}

function bumpContributor(
  contributors: Map<string, ContributorAccumulator>,
  identity: OwnershipIdentity,
  linesChanged: number,
  source: "author" | "coAuthor",
): void {
  const key = identityKey(identity);
  let contributor = contributors.get(key);
  if (contributor === undefined) {
    contributor = {
      identity,
      changes: 0,
      authoredChanges: 0,
      coAuthoredChanges: 0,
      linesChanged: 0,
      lastTouchDate: null,
      lastTouchMs: null,
    };
    contributors.set(key, contributor);
  }
  contributor.changes += 1;
  if (source === "author") contributor.authoredChanges += 1;
  else contributor.coAuthoredChanges += 1;
  contributor.linesChanged += linesChanged;
}

function updateAccumulatorTouch(
  contributors: ReadonlyMap<string, ContributorAccumulator>,
  identity: OwnershipIdentity,
  date: string,
): void {
  const contributor = contributors.get(identityKey(identity));
  if (contributor !== undefined) updateLastTouch(contributor, date);
}

function updateLastTouch(contributor: ContributorAccumulator, date: string): void {
  const ms = parseDateMs(date);
  if (ms === null) return;
  if (contributor.lastTouchMs !== null && contributor.lastTouchMs >= ms) return;
  contributor.lastTouchMs = ms;
  contributor.lastTouchDate = date;
}

function updateFirstAuthor(
  aggregate: FileOwnershipAggregate,
  identity: OwnershipIdentity,
  date: string,
): void {
  const ms = parseDateMs(date);
  if (ms === null) return;
  if (aggregate.firstAuthorMs !== null && aggregate.firstAuthorMs <= ms) return;
  aggregate.firstAuthorMs = ms;
  aggregate.firstAuthor = identity;
}

export function repoLastAuthorCommitDates(
  records: readonly CommitRecord[],
  mailmap: MailmapIdentityResolver,
): Map<string, string> {
  const last = new Map<string, { date: string; ms: number }>();
  for (const record of records) {
    const ms = parseDateMs(record.authorDate);
    if (ms === null) continue;
    const identity = mailmap(authorIdentity(record));
    const key = identityKey(identity);
    const existing = last.get(key);
    if (existing !== undefined && existing.ms >= ms) continue;
    last.set(key, { date: record.authorDate, ms });
  }
  return new Map([...last.entries()].map(([key, value]) => [key, value.date]));
}

export function newestCommitMs(records: readonly CommitRecord[]): number | null {
  let newest: number | null = null;
  for (const record of records) {
    const ms = parseDateMs(record.authorDate);
    if (ms === null) continue;
    if (newest === null || ms > newest) newest = ms;
  }
  return newest;
}

export function firstContributor(
  contributors: ReadonlyMap<string, ContributorAccumulator>,
): ContributorAccumulator | null {
  return [...contributors.values()].sort(compareContributorAccumulators)[0] ?? null;
}

export function contributorsFor(
  contributors: ReadonlyMap<string, ContributorAccumulator>,
  repoLastCommitByAuthor: ReadonlyMap<string, string>,
): OwnershipContributor[] {
  return [...contributors.values()]
    .sort(compareContributorAccumulators)
    .map((contributor) => withRepoCommitDate(contributor, repoLastCommitByAuthor));
}

export function withRepoCommitDate(
  contributor: ContributorAccumulator,
  repoLastCommitByAuthor: ReadonlyMap<string, string>,
): OwnershipContributor {
  return {
    name: contributor.identity.name,
    email: contributor.identity.email,
    changes: contributor.changes,
    authoredChanges: contributor.authoredChanges,
    coAuthoredChanges: contributor.coAuthoredChanges,
    linesChanged: contributor.linesChanged,
    lastTouchDate: contributor.lastTouchDate,
    lastRepoCommitDate: repoLastCommitByAuthor.get(identityKey(contributor.identity)) ?? null,
  };
}

function compareContributorAccumulators(
  left: ContributorAccumulator,
  right: ContributorAccumulator,
): number {
  return (
    right.changes - left.changes ||
    right.authoredChanges - left.authoredChanges ||
    right.coAuthoredChanges - left.coAuthoredChanges ||
    right.linesChanged - left.linesChanged ||
    formatIdentity(left.identity).localeCompare(formatIdentity(right.identity), "en")
  );
}

export function parseDateMs(value: string): number | null {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}
