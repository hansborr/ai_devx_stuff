// Advisory shape + text/JSON rendering for the `coldspots` subcommand.
//
// Coldspots is a SIBLING of hotspots, not a hotspots lens (resolved decision #1):
// it has its own time axis (stillness, not velocity) and its own advisory header,
// so it gets its own lens/section unions here rather than polluting hotspots'.
// It REUSES the genuinely shared row context (`HotspotRowContext`, `HotspotAuthor`)
// and the shared subcommand arg base — only the cold-specific evidence (amplifiers,
// age, revisions, degradations) is new.
//
// BRAND FIREWALL: like hotspots, coldspots is NEVER a trusted finding. The JSON top
// level is `{ kind: "advisory", sections: [...] }` — never the `findings` shape,
// never WARN/FIX. Each surfaced row names WHICH amplifier(s) fired with raw numbers
// and a copy-paste `git log` inspect command. Evidence, not verdicts.
//
// This module is the TYPE HOME for the coldspots advisory + renderers. It imports no
// lens math (the reducers import these types, not the reverse), so there is no cycle.

import { appendColdspotSection } from "./coldspots-format-sections.js";
import type { StaleMarkerKind } from "./coldspots-markers.js";
import type { HotspotBaselineDelta, HotspotRowContext } from "./hotspots-format.js";

export type ColdspotLens = "coldspot" | "stale-markers" | "all";

// The four amplifier kinds. A coldspot is only surfaced when ≥1 of these fires;
// each carries the raw numbers that triggered it so the row is self-documenting.
export type ColdspotAmplifierKind =
  | "stale-in-hot-neighborhood"
  | "write-once-birth-burst"
  | "gone-silent-author"
  | "large-file-cold";

// One fired amplifier: its kind, a human-legible one-liner, and the raw numbers
// (provenance) that crossed the threshold. `numbers` is a flat string→number bag so
// JSON preserves the exact evidence without each amplifier needing its own type.
export type ColdspotAmplifier = {
  readonly kind: ColdspotAmplifierKind;
  readonly detail: string;
  readonly numbers: Readonly<Record<string, number>>;
};

// A surfaced coldspot row. Reuses the shared per-row context (authors/agents,
// recent subjects, inspect command, baseline) and adds the cold-specific evidence.
export type ColdspotRow = HotspotRowContext & {
  readonly path: string;
  readonly ageDays: number; // days since the file was last touched in-window
  readonly revisions: number; // commits touching the file in-window
  readonly churnLines: number; // accumulated added+deleted (the size proxy); 0 on blobless
  readonly amplifiers: readonly ColdspotAmplifier[]; // ≥1 by construction
  readonly score: number; // ranking value: amplifier count, then age (see reducer)
};

// Disclosed thresholds for the coldspot lens, echoed in the header + JSON so the
// gate is never a hidden judgment.
export type ColdspotThresholds = {
  readonly ageThresholdDays: number;
  readonly revisionFloor: number;
  readonly ageStandoutFactor: number;
  readonly medianAgeDays: number;
  readonly neighborhoodChurnRatio: number; // K: dir_churn / file_churn
  readonly birthBurstFiles: number; // N: files in the birth commit
  readonly birthBurstLines: number; // M: lines added in the birth commit
  readonly goneSilentDays: number;
  readonly largeFileChurnLines: number; // size proxy: accumulated churn
};

export type ColdspotCandidateModel = {
  readonly candidateSet: "in-window-touched-files";
  readonly note: string;
};

export const COLDSPOT_IN_WINDOW_CANDIDATE_MODEL: ColdspotCandidateModel = {
  candidateSet: "in-window-touched-files",
  note: "Only files touched at least once in the effective git window are considered; current files with no in-window commits are outside this lens.",
};

export type ColdspotSection = {
  readonly lens: "coldspot";
  readonly thresholds: ColdspotThresholds;
  // The coldspot lens is windowed-history evidence, not current-inventory evidence.
  // Current files untouched inside the effective window need a separate zero-touch
  // section so they do not appear beside rows with incompatible git evidence.
  readonly candidateModel: ColdspotCandidateModel;
  // Which amplifiers were live this run vs degraded (e.g. write-once on a squash
  // repo, large-file-cold on a blobless clone). Disclosed so a missing amplifier
  // never reads as "checked and clear".
  readonly amplifiersInPlay: readonly ColdspotAmplifierKind[];
  readonly degradations: readonly string[];
  // How many rows passed the gate (before the `--top` display cap). `entries.length`
  // is the shown subset; when it is smaller, the renderers disclose the truncation so
  // a capped list never reads as complete.
  readonly totalQualified: number;
  readonly emptyReason: string | null;
  readonly entries: readonly ColdspotRow[];
};

// --- stale-markers lens -----------------------------------------------------

// The introducing commit for the oldest marker in a file. Null fields when blame
// could not resolve it (e.g. blobless clone, uncommitted line) — disclosed, never
// guessed.
export type StaleMarkerOrigin = {
  readonly kind: StaleMarkerKind;
  readonly lineNumber: number;
  readonly text: string;
  readonly author: string | null;
  readonly sha: string | null;
  readonly introducedAt: string | null; // ISO date of introduction; null when unknown
};

// A surfaced stale-markers row: a file whose OLDEST marker has aged past the
// threshold. Path-keyed with a `score` (the oldest-marker age in days) so the shared
// coldspots baseline tagger works unchanged. `oldestMarkerAgeDays` is null when ages
// are unavailable (blobless) — the row still discloses marker counts.
export type StaleMarkerRow = {
  readonly path: string;
  readonly oldestMarkerAgeDays: number | null;
  readonly oldestMarker: StaleMarkerOrigin;
  readonly countsByType: Readonly<Record<StaleMarkerKind, number>>;
  readonly totalMarkers: number;
  readonly inspectCommand: string; // copy-paste `git blame` to inspect the oldest marker
  readonly score: number; // ranking value = oldest-marker age in days (0 when unknown)
  readonly baseline: HotspotBaselineDelta | null; // null unless --baseline given
};

type StaleMarkerThresholds = {
  readonly ageThresholdDays: number;
};

export type StaleMarkerSection = {
  readonly lens: "stale-markers";
  readonly thresholds: StaleMarkerThresholds;
  readonly markerKinds: readonly StaleMarkerKind[]; // which keywords were scanned
  // True when blame resolved introduction dates; false on a blobless clone (counts
  // still surface, but ages are disclosed as unavailable).
  readonly agesAvailable: boolean;
  // ISO date (UTC) the marker ages were computed against. Disclosed so a reader can
  // interpret "247 days old" against a known anchor (wall-clock by default).
  readonly referenceDate: string;
  readonly filesScanned: number;
  readonly degradations: readonly string[];
  // How many files cleared the age gate (before the `--top` display cap); see the
  // ColdspotSection note. Disclosed by the renderers when it exceeds entries.length.
  readonly totalQualified: number;
  readonly emptyReason: string | null;
  readonly entries: readonly StaleMarkerRow[];
};

// The discriminated union of every concrete coldspots section. Adding a lens means
// adding a member here + a dispatch branch in the reducer map and the renderer
// (mirrors how hotspots holds multiple section types).
export type ColdspotsSection = ColdspotSection | StaleMarkerSection;

type ColdspotsWindow = {
  readonly requestedDays: number;
  readonly effectiveDays: number;
  readonly widened: boolean;
  readonly widenReason: string | null;
};

export type ColdspotsAdvisory = {
  readonly kind: "advisory";
  readonly lens: ColdspotLens; // requested lens; `all` fans out to every cold lens
  readonly note: string | null;
  readonly banner: string;
  readonly window: ColdspotsWindow;
  readonly commitCount: number;
  readonly linesAvailable: boolean; // false on a blobless partial clone (no line counts)
  readonly squashReason: string | null; // disclosed: degrades write-once-birth-burst
  readonly sections: readonly ColdspotsSection[];
};

export function formatColdspotsJson(advisory: ColdspotsAdvisory): string {
  return JSON.stringify(advisory, null, 2);
}

export function formatColdspotsText(advisory: ColdspotsAdvisory): string {
  const lines = [
    `drift:ai coldspots (advisory) -- lens ${advisory.lens}`,
    `  ${advisory.banner}`,
    `  ${formatWindow(advisory.window)}`,
    `  commits: ${advisory.commitCount} (non-merge)`,
  ];
  if (!advisory.linesAvailable) {
    lines.push("  lines: unavailable (blobless partial clone — revision counts only)");
  }
  if (advisory.squashReason !== null) {
    lines.push(`  squash: ${advisory.squashReason}`);
  }
  if (advisory.note !== null) lines.push(`  note: ${advisory.note}`);
  for (const section of advisory.sections) {
    lines.push("");
    appendColdspotSection(lines, section);
  }
  return lines.join("\n");
}

function formatWindow(window: ColdspotsWindow): string {
  if (!window.widened || window.widenReason === null) return `window: ${window.effectiveDays}d`;
  return `window: ${window.effectiveDays}d (widened from ${window.requestedDays}d: ${window.widenReason})`;
}
