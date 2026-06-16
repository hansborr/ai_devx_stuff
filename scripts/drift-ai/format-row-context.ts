// Shared text rendering for a row's actionability context (authors / recent
// subjects / commit-intent overlay / inspect command). Both the hotspots and
// coldspots section formatters print these identical four lines per row, so the
// rendering lives here once keyed on a structural shape rather than each lens's
// concrete row type. Every hotspot entry and the coldspot row are
// `HotspotRowContext & {...}`, so they all satisfy `RowContextLike`.

import { type CommitIntentOverlay, formatCommitIntentOverlay } from "./commit-intent.js";
import type { HotspotAuthor } from "./hotspots-format.js";

// The actionability columns the row formatters read. Structural so both the
// hotspot lens union and `ColdspotRow` qualify without importing concrete lens
// types into this shared renderer.
export type RowContextLike = {
  readonly authors: readonly HotspotAuthor[];
  readonly recentSubjects: readonly string[];
  readonly commitIntent: readonly CommitIntentOverlay[];
  readonly inspectCommand: string;
};

// Append the per-row context lines (authors / recent / intent / inspect) to
// `lines`. The authors/recent/intent lines are emitted only when non-empty; the
// inspect command is always shown.
export function appendRowContext(lines: string[], entry: RowContextLike): void {
  if (entry.authors.length > 0) {
    lines.push(`        authors: ${entry.authors.map(formatAuthor).join(", ")}`);
  }
  if (entry.recentSubjects.length > 0) {
    lines.push(`        recent: ${entry.recentSubjects.map((s) => `"${s}"`).join("; ")}`);
  }
  if (entry.commitIntent.length > 0) {
    lines.push(`        intent: ${formatCommitIntentOverlay(entry.commitIntent)}`);
  }
  lines.push(`        inspect: ${entry.inspectCommand}`);
}

export function formatAuthor(author: HotspotAuthor): string {
  return `${author.name}×${author.commits}`;
}
