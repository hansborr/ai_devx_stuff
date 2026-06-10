import {
  formatBoundedHistory,
  formatPercent,
  formatScannedRange,
} from "./advisory-format-helpers.js";
import { formatCommitIntentOverlay } from "./commit-intent.js";
import { formatIdentity } from "./ownership-identities.js";
import type {
  OwnershipAdvisory,
  OwnershipAdvisoryRow,
  OwnershipContributor,
} from "./ownership-types.js";
import {
  appendPrototypeSection,
  formatPrototypeAdvisoryJson,
  formatPrototypeHeader,
} from "./prototype-advisory.js";

export function formatOwnershipAdvisoryJson(advisory: OwnershipAdvisory): string {
  return formatPrototypeAdvisoryJson(advisory);
}

export function formatOwnershipAdvisoryText(advisory: OwnershipAdvisory): string {
  const lines = formatPrototypeHeader(advisory);
  lines.push(`  history: ${formatBoundedHistory(advisory.history)}`);
  lines.push(`  scanned: ${formatScannedRange(advisory.history.scannedRange)}`);
  for (const section of advisory.sections) {
    lines.push("");
    appendPrototypeSection(lines, section, renderOwnershipRow);
  }
  return lines.join("\n");
}

function renderOwnershipRow(row: OwnershipAdvisoryRow): readonly string[] {
  return [
    `#${row.rank} ${row.path} ownership ${formatPercent(row.ownershipScore)} (owner share ${formatPercent(
      row.ownerShare,
    )}; line share ${formatNullablePercent(row.lineShare)})`,
    `dominant owner: ${formatContributor(row.dominantOwner)}; first author: ${formatIdentity(
      row.firstAuthor,
    )}${row.firstAuthorIsDominantOwner ? " (same)" : ""}`,
    `own/other changes: ownership ${row.ownershipChanges.own}/${row.ownershipChanges.other} of ${row.ownershipChanges.total}; authored ${row.authoredChanges.own}/${row.authoredChanges.other} of ${row.authoredChanges.total}`,
    `author: ${formatContributor(row.author)}; coAuthors: ${formatContributorList(
      row.coAuthors,
    )}; agentHands: ${formatContributorList(row.agentHands)}`,
    `owner touch recency ${formatDays(row.ownerTouchRecencyDays)}; owner repo recency ${formatDays(
      row.ownerRepoRecencyDays,
    )}`,
    `subjects: ${row.recentSubjects.length === 0 ? "none" : row.recentSubjects.join(" | ")}`,
    `intent: ${formatCommitIntentOverlay(row.commitIntent)}`,
    `inspect: ${row.inspectCommand}`,
  ];
}

function formatContributor(contributor: OwnershipContributor): string {
  const pieces = [
    formatIdentity(contributor),
    `${contributor.changes} hand change(s)`,
    `${contributor.authoredChanges} authored`,
    `${contributor.coAuthoredChanges} co-authored`,
  ];
  if (contributor.linesChanged > 0) pieces.push(`${contributor.linesChanged} line delta`);
  return pieces.join("; ");
}

function formatContributorList(contributors: readonly OwnershipContributor[]): string {
  if (contributors.length === 0) return "none";
  return contributors.map(formatContributor).join(" | ");
}

function formatNullablePercent(value: number | null): string {
  return value === null ? "n/a" : formatPercent(value);
}

function formatDays(days: number | null): string {
  return days === null ? "n/a" : `${days}d`;
}
