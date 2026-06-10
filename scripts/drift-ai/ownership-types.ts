import type { BoundedHistoryDisclosure } from "./advisory-format-helpers.js";
import type { BoundedFullHistory } from "./bounded-full-history.js";
import type { CommitIntentOverlay } from "./commit-intent.js";
import type { PrototypeAdvisory, PrototypeSection } from "./prototype-advisory.js";

export const OWNERSHIP_SUBCOMMAND = "ownership";
export const DEFAULT_OWNERSHIP_TOP = 20;

export const DEFAULT_AGENT_IDENTITY_PATTERNS: readonly string[] = [
  "\\bclaude\\b",
  "noreply@anthropic\\.com",
  "\\bcodex\\b",
  "copilot",
  "github-actions\\[bot\\]",
];

export type OwnershipIdentity = {
  readonly name: string;
  readonly email: string | null;
};

export type OwnershipContributor = OwnershipIdentity & {
  readonly changes: number;
  readonly authoredChanges: number;
  readonly coAuthoredChanges: number;
  readonly linesChanged: number;
  readonly lastTouchDate: string | null;
  readonly lastRepoCommitDate: string | null;
};

export type OwnershipChangeSplit = {
  readonly own: number;
  readonly other: number;
  readonly total: number;
};

export type OwnershipAdvisoryRow = {
  readonly rank: number;
  readonly path: string;
  readonly firstAuthor: OwnershipIdentity;
  readonly dominantOwner: OwnershipContributor;
  readonly author: OwnershipContributor;
  readonly coAuthors: readonly OwnershipContributor[];
  readonly agentHands: readonly OwnershipContributor[];
  readonly ownershipChanges: OwnershipChangeSplit;
  readonly authoredChanges: OwnershipChangeSplit;
  readonly ownerShare: number;
  readonly lineShare: number | null;
  readonly firstAuthorIsDominantOwner: boolean;
  readonly ownerLastTouchDate: string | null;
  readonly ownerLastRepoCommitDate: string | null;
  readonly ownerTouchRecencyDays: number | null;
  readonly ownerRepoRecencyDays: number | null;
  readonly ownershipScore: number;
  readonly recentSubjects: readonly string[];
  readonly commitIntent: readonly CommitIntentOverlay[];
  readonly inspectCommand: string;
};

export type OwnershipSection = PrototypeSection<OwnershipAdvisoryRow>;

export type OwnershipAdvisory = PrototypeAdvisory<OwnershipSection> & {
  readonly history: BoundedHistoryDisclosure;
  readonly agentIdentityPatterns: readonly string[];
};

export type MailmapIdentityResolver = (identity: OwnershipIdentity) => OwnershipIdentity;

export type BuildOwnershipAdvisoryInput = {
  readonly history: BoundedFullHistory;
  readonly top?: number;
  readonly agentIdentityPatterns?: readonly string[];
  readonly mailmapIdentity?: MailmapIdentityResolver;
};
