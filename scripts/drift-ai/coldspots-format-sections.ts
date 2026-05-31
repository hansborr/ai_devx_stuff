// Text rendering for coldspots sections. Mirrors `hotspots-format-sections.ts`:
// a single `appendColdspotSection` dispatch plus per-lens append helpers, so
// adding a second lens (e.g. stale-markers) later is one more branch.

import type {
  ColdspotRow,
  ColdspotSection,
  ColdspotsSection,
  ColdspotThresholds,
  StaleMarkerRow,
  StaleMarkerSection,
} from "./coldspots-format.js";
import type { HotspotAuthor, HotspotBaselineDelta } from "./hotspots-format.js";

// Dispatch by `lens`, mirroring how `hotspots-format-sections.ts` fans out. A new
// lens adds its own branch + append helper here.
export function appendColdspotSection(lines: string[], section: ColdspotsSection): void {
  if (section.lens === "stale-markers") {
    appendStaleMarkersLens(lines, section);
    return;
  }
  appendColdspotLens(lines, section);
}

function appendColdspotLens(lines: string[], section: ColdspotSection): void {
  lines.push(`  coldspot (${formatThresholds(section.thresholds)}):`);
  lines.push(`    candidate model: ${section.candidateModel.candidateSet}`);
  lines.push(`      ${section.candidateModel.note}`);
  lines.push(`    amplifiers in play: ${section.amplifiersInPlay.join(", ")}`);
  for (const note of section.degradations) lines.push(`    degraded: ${note}`);
  if (section.entries.length === 0) {
    lines.push(`    ${section.emptyReason ?? "no coldspots this window."}`);
    return;
  }
  const truncation = truncationNote(section.entries.length, section.totalQualified);
  if (truncation !== null) lines.push(`    ${truncation}`);
  for (const entry of section.entries) {
    lines.push(`    ${formatColdspotHead(entry)}`);
    for (const amplifier of entry.amplifiers) {
      lines.push(`        amplifier ${amplifier.kind}: ${amplifier.detail}`);
    }
    appendRowContext(lines, entry);
  }
}

function appendStaleMarkersLens(lines: string[], section: StaleMarkerSection): void {
  lines.push(
    `  stale-markers (oldest marker age > ${section.thresholds.ageThresholdDays}d; kinds ${section.markerKinds.join(
      "/",
    )}; ${section.filesScanned} files scanned):`,
  );
  // Disclose the aging anchor so "N days old" is interpretable.
  lines.push(`    ages computed against ${section.referenceDate}`);
  if (!section.agesAvailable) {
    lines.push("    ages: unavailable (blobless partial clone — marker counts only, no blame)");
  }
  for (const note of section.degradations) lines.push(`    degraded: ${note}`);
  if (section.entries.length === 0) {
    lines.push(`    ${section.emptyReason ?? "no stale markers this scan."}`);
    return;
  }
  const truncation = truncationNote(section.entries.length, section.totalQualified);
  if (truncation !== null) lines.push(`    ${truncation}`);
  for (const entry of section.entries) {
    lines.push(`    ${formatStaleMarkerHead(entry)}`);
    lines.push(`        counts: ${formatCounts(entry.countsByType)}`);
    lines.push(`        oldest: ${formatOldest(entry)}`);
    lines.push(`        inspect: ${entry.inspectCommand}`);
  }
}

// Honest display-cap disclosure: when fewer rows are shown than qualified, say so
// (drift:ai never presents a capped subset as if complete). null when nothing is hidden.
function truncationNote(shown: number, totalQualified: number): string | null {
  if (totalQualified <= shown) return null;
  const more = totalQualified - shown;
  return `showing ${shown} of ${totalQualified} (${more} more; raise --top to see them)`;
}

function formatStaleMarkerHead(entry: StaleMarkerRow): string {
  const age =
    entry.oldestMarkerAgeDays === null ? "age unknown" : `oldest ${entry.oldestMarkerAgeDays}d`;
  const tag = formatBaselineTag(entry.baseline);
  return `${entry.path}  —  ${entry.totalMarkers} marker${
    entry.totalMarkers === 1 ? "" : "s"
  }, ${age}${tag}`;
}

function formatCounts(counts: StaleMarkerRow["countsByType"]): string {
  const parts = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${kind}×${count}`);
  return parts.length === 0 ? "none" : parts.join(", ");
}

function formatOldest(entry: StaleMarkerRow): string {
  const origin = entry.oldestMarker;
  const who =
    origin.author === null && origin.sha === null
      ? "introducer unknown"
      : `${origin.author ?? "?"} @ ${origin.sha ?? "?"}${
          origin.introducedAt === null ? "" : ` (${origin.introducedAt})`
        }`;
  return `${origin.kind} at line ${origin.lineNumber} — "${origin.text}" [${who}]`;
}

function formatThresholds(thresholds: ColdspotThresholds): string {
  return [
    `age > ${thresholds.ageThresholdDays}d`,
    `≥${thresholds.ageStandoutFactor}× median age ${thresholds.medianAgeDays}d`,
    `revisions <= ${thresholds.revisionFloor}`,
    `K ${thresholds.neighborhoodChurnRatio}`,
    `birth-burst ≥${thresholds.birthBurstFiles} files / ≥${thresholds.birthBurstLines} lines`,
    `gone-silent ${thresholds.goneSilentDays}d`,
    `large-file ≥${thresholds.largeFileChurnLines} churn lines`,
  ].join("; ");
}

function formatColdspotHead(entry: ColdspotRow): string {
  const kinds = entry.amplifiers.map((amplifier) => amplifier.kind).join(", ");
  const tag = formatBaselineTag(entry.baseline);
  return `${entry.path}  —  age ${entry.ageDays}d, ${entry.revisions} revision${
    entry.revisions === 1 ? "" : "s"
  }, ${entry.churnLines} churn lines  [${kinds}]${tag}`;
}

function appendRowContext(lines: string[], entry: ColdspotRow): void {
  if (entry.authors.length > 0) {
    lines.push(`        authors: ${entry.authors.map(formatAuthor).join(", ")}`);
  }
  if (entry.recentSubjects.length > 0) {
    lines.push(`        recent: ${entry.recentSubjects.map((s) => `"${s}"`).join("; ")}`);
  }
  lines.push(`        inspect: ${entry.inspectCommand}`);
}

function formatAuthor(author: HotspotAuthor): string {
  return `${author.name}×${author.commits}`;
}

function formatBaselineTag(delta: HotspotBaselineDelta | null): string {
  if (delta === null) return "";
  switch (delta.status) {
    case "new":
      return "  [↑NEW]";
    case "up":
      return `  [↑+${delta.scoreDelta}]`;
    case "down":
      return `  [↓${delta.scoreDelta}]`;
    case "steady":
      return "  [=steady]";
  }
}
