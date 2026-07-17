// Advisory shape + text/JSON rendering for the `hotspots` subcommand.
//
// BRAND FIREWALL (brainstorm §1.9): hotspots is NEVER a trusted finding. The
// JSON top level is `{ kind: "advisory", sections: [...] }` — never the
// `findings` shape, never WARN/FIX, never DriftFinding. The text output says
// "hotspots", carries a mandatory legible header (window / commit count / metric /
// non-merge / no-complexity), and a banner disclaiming that these are defects.
//
// This module is the TYPE HOME for the advisory + the renderers. It imports no
// lens math (the churn/coupling reducers import these types, not the reverse), so
// there is no cycle.

import type { CommitIntentOverlay } from "./commit-intent.js";
import { appendSection } from "./hotspots-format-sections.js";
import type { ChurnMetric } from "./hotspots-history.js";

export type HotspotLens =
  | "churn"
  | "coupling"
  | "fragmentation"
  | "suppression-churn"
  | "thrash"
  | "all";

// --- per-row actionability context (shared by every lens) -------------------

// Authors + co-author/trailer hands behind a row, most-active first. Trailers let
// us attribute *agents* (e.g. `claude×14`) alongside humans — the single
// highest-value column, since multi-distinct-hand churn IS the "no one sees it"
// signal made visible.
export type HotspotAuthor = {
  readonly name: string;
  readonly commits: number;
};

// `--baseline <prev.json>` delta tag for a row, vs the same row in a prior run.
// scoreDelta is signed (current − prior) for up/down; 0 for new/steady.
export type HotspotBaselineDelta = {
  readonly status: "new" | "up" | "down" | "steady";
  readonly scoreDelta: number;
};

// The per-row actionability context every lens carries, factored out so the shared
// columns are declared once. Each lens entry below is this context intersected with
// its own metric fields. `score` lives on the per-lens entry (its meaning differs by
// lens), but `authors` / `recentSubjects` / `inspectCommand` / `baseline` are uniform.
export type HotspotRowContext = {
  readonly authors: readonly HotspotAuthor[];
  readonly recentSubjects: readonly string[]; // up to 3 most-recent commit subjects
  readonly commitIntent: readonly CommitIntentOverlay[]; // regex labels over recentSubjects
  readonly inspectCommand: string; // copy-paste `git log` to inspect the row
  readonly baseline: HotspotBaselineDelta | null; // null unless --baseline given
};

// --- per-lens entries -------------------------------------------------------

export type ChurnHotspot = HotspotRowContext & {
  readonly path: string;
  readonly revisions: number; // commits touching the file in-window
  readonly linesChanged: number; // sum of added + deleted (0 from binaries / blobless)
  readonly score: number; // ranking value = revisions or linesChanged, per the active metric
};

export type CouplingHotspot = HotspotRowContext & {
  readonly a: string;
  readonly b: string;
  readonly coChanges: number; // coOccur: commits touching BOTH a and b (2..K-file commits)
  readonly revisionsA: number; // co-change revisions of a (2..K-file commits touching a)
  readonly revisionsB: number;
  readonly score: number; // symmetric: coChanges / min(revisionsA, revisionsB)
  readonly crossBoundary: boolean; // top path segments differ — the louder signal
};

export type FragmentationHotspot = HotspotRowContext & {
  readonly path: string;
  readonly distinctHands: number;
  readonly authorHands: number;
  readonly trailerHands: number;
  readonly sampleHands: readonly string[];
  readonly revisions: number;
  readonly score: number;
};

export type SuppressionChurnHotspot = HotspotRowContext & {
  readonly path: string;
  readonly suppressionChanges: number;
  readonly score: number;
};

export type ThrashHotspot = HotspotRowContext & {
  readonly path: string;
  readonly revisions: number;
  readonly linesChanged: number;
  readonly netLines: number;
  readonly netLinesPerRevision: number;
  readonly fixRevertCommits: number;
  readonly firstTouchAgeDays: number | null;
  readonly youngInWindow: boolean;
  readonly testChurnRatio: number;
  readonly score: number;
};

// --- per-lens sections ------------------------------------------------------

export type ChurnSection = {
  readonly lens: "churn";
  readonly metric: ChurnMetric;
  readonly standoutFactor: number; // a row qualifies at score ≥ factor × medianScore
  readonly medianScore: number; // median churn of the in-window touched set
  readonly emptyReason: string | null; // set when the distribution is flat (no standout)
  readonly entries: readonly ChurnHotspot[];
};

export type CouplingSection = {
  readonly lens: "coupling";
  readonly scoreModel: "symmetric"; // coOccur / min(revs[a], revs[b])
  readonly minSupport: number; // a pair must co-change ≥ this many times
  readonly degreeCap: number; // max distinct partners any one file contributes to the top-N
  readonly sweepCap: number; // commits touching > this many files are skipped as sweeps
  readonly emptyReason: string | null; // set when no pair clears minSupport
  readonly entries: readonly CouplingHotspot[];
};

export type FragmentationSection = {
  readonly lens: "fragmentation";
  readonly minHands: number;
  readonly emptyReason: string | null;
  readonly entries: readonly FragmentationHotspot[];
};

export type SuppressionChurnSection = {
  readonly lens: "suppression-churn";
  readonly pattern: string;
  readonly minChanges: number;
  readonly emptyReason: string | null;
  readonly entries: readonly SuppressionChurnHotspot[];
};

export type ThrashSection = {
  readonly lens: "thrash";
  readonly minRevisions: number;
  readonly maxNetLinesPerRevision: number;
  readonly youngDays: number;
  readonly emptyReason: string | null;
  readonly entries: readonly ThrashHotspot[];
};

export type HotspotSection =
  | ChurnSection
  | CouplingSection
  | FragmentationSection
  | SuppressionChurnSection
  | ThrashSection;

type HotspotsWindow = {
  readonly requestedDays: number;
  readonly effectiveDays: number;
  readonly widened: boolean;
  readonly widenReason: string | null;
};

type HotspotsMetric = {
  readonly name: ChurnMetric;
  readonly autoSwitched: boolean;
  readonly squashReason: string | null;
};

export type HotspotsAdvisory = {
  readonly kind: "advisory";
  readonly lens: HotspotLens; // the requested lens; `all` fans out to multiple sections
  readonly note: string | null; // e.g. lens-not-implemented disclosure; null when fully computed
  readonly banner: string;
  readonly window: HotspotsWindow;
  readonly commitCount: number;
  readonly metric: HotspotsMetric;
  readonly linesAvailable: boolean; // false on a blobless partial clone (revision counts only)
  readonly complexity: string; // disclaimer: complexity belongs to lint-baseline adapters, not hotspots
  readonly sections: readonly HotspotSection[];
};

export function formatHotspotsJson(advisory: HotspotsAdvisory): string {
  return JSON.stringify(advisory, null, 2);
}

export function formatHotspotsText(advisory: HotspotsAdvisory): string {
  const lines = [
    `drift:ai hotspots (advisory) -- lens ${advisory.lens}`,
    `  ${advisory.banner}`,
    `  ${formatWindow(advisory.window)}`,
    `  commits: ${advisory.commitCount} (non-merge)`,
    `  ${formatMetric(advisory)}`,
    `  complexity: ${advisory.complexity}`,
  ];
  if (!advisory.linesAvailable) {
    lines.push("  lines: unavailable (blobless partial clone — revision counts only)");
  }
  if (advisory.note !== null) lines.push(`  note: ${advisory.note}`);
  for (const section of advisory.sections) {
    lines.push("");
    appendSection(lines, section, advisory.linesAvailable);
  }
  return lines.join("\n");
}

function formatWindow(window: HotspotsWindow): string {
  if (!window.widened || window.widenReason === null) return `window: ${window.effectiveDays}d`;
  return `window: ${window.effectiveDays}d (widened from ${window.requestedDays}d: ${window.widenReason})`;
}

function formatMetric(advisory: HotspotsAdvisory): string {
  const metric = advisory.metric;
  if (metric.autoSwitched && metric.squashReason !== null) {
    return `metric: ${metric.name} (auto-switched from revisions: ${metric.squashReason})`;
  }
  // Squash suspected but line counts are unavailable, so the metric could not
  // switch — disclose that revisions may undercount rather than switching blindly.
  if (metric.squashReason !== null && !advisory.linesAvailable) {
    return `metric: revisions (squash suspected: ${metric.squashReason}; line counts unavailable, so revisions may undercount)`;
  }
  return `metric: ${metric.name}`;
}
