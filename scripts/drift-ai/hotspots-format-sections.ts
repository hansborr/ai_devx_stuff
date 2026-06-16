import { appendRowContext } from "./format-row-context.js";
import type {
  ChurnHotspot,
  ChurnSection,
  CouplingSection,
  FragmentationSection,
  HotspotBaselineDelta,
  HotspotSection,
  SuppressionChurnSection,
  ThrashSection,
} from "./hotspots-format.js";
import type { ChurnMetric } from "./hotspots-history.js";

export function appendSection(
  lines: string[],
  section: HotspotSection,
  linesAvailable: boolean,
): void {
  if (section.lens === "churn") {
    appendChurnSection(lines, section, linesAvailable);
    return;
  }
  if (section.lens === "coupling") {
    appendCouplingSection(lines, section);
    return;
  }
  if (section.lens === "fragmentation") {
    appendFragmentationSection(lines, section);
    return;
  }
  if (section.lens === "suppression-churn") {
    appendSuppressionChurnSection(lines, section);
    return;
  }
  appendThrashSection(lines, section);
}

function appendChurnSection(lines: string[], section: ChurnSection, linesAvailable: boolean): void {
  lines.push(
    `  churn (top by ${section.metric}; standout ≥${section.standoutFactor}× median ${section.medianScore}):`,
  );
  if (section.entries.length === 0) {
    lines.push(`    ${section.emptyReason ?? "no clear hotspots this window."}`);
    return;
  }
  for (const entry of section.entries) {
    lines.push(`    ${formatChurnHead(entry, section.metric, linesAvailable)}`);
    appendRowContext(lines, entry);
  }
}

function formatChurnHead(
  entry: ChurnHotspot,
  metric: ChurnMetric,
  linesAvailable: boolean,
): string {
  const revisions = `${entry.revisions} revision${entry.revisions === 1 ? "" : "s"}`;
  const head = formatBaselineTag(entry.baseline);
  if (!linesAvailable) return `${entry.path}  —  ${revisions}${head}`;
  const linesLabel = `${entry.linesChanged} line${entry.linesChanged === 1 ? "" : "s"}`;
  const [primary, secondary] =
    metric === "lines" ? [linesLabel, revisions] : [revisions, linesLabel];
  return `${entry.path}  —  ${primary} (${secondary})${head}`;
}

function appendCouplingSection(lines: string[], section: CouplingSection): void {
  lines.push(
    `  coupling (${section.scoreModel} score = coOccur / min(revs); minSupport ${section.minSupport}, degreeCap ${section.degreeCap}, sweepCap ${section.sweepCap}):`,
  );
  if (section.entries.length === 0) {
    lines.push(`    ${section.emptyReason ?? "no clear couplings this window."}`);
    return;
  }
  for (const entry of section.entries) {
    const tag = formatBaselineTag(entry.baseline);
    const boundary = entry.crossBoundary ? "  [cross-boundary]" : "";
    lines.push(
      `    ${entry.a} ↔ ${entry.b}${boundary}  —  score ${formatScore(entry.score)}${tag}`,
    );
    lines.push(
      `        coOccur=${entry.coChanges}, revs(a)=${entry.revisionsA}, revs(b)=${entry.revisionsB}`,
    );
    appendRowContext(lines, entry);
  }
}

function appendFragmentationSection(lines: string[], section: FragmentationSection): void {
  lines.push(`  fragmentation (distinct authors + agent trailers; minHands ${section.minHands}):`);
  if (section.entries.length === 0) {
    lines.push(
      `    ${section.emptyReason ?? "no author/agent fragmentation hotspots this window."}`,
    );
    return;
  }
  for (const entry of section.entries) {
    const tag = formatBaselineTag(entry.baseline);
    lines.push(
      `    ${entry.path}  —  ${entry.distinctHands} distinct hands (${entry.authorHands} authors, ${entry.trailerHands} trailers), ${entry.revisions} revisions${tag}`,
    );
    lines.push(`        sample hands: ${entry.sampleHands.join(", ")}`);
    appendRowContext(lines, entry);
  }
}

function appendSuppressionChurnSection(lines: string[], section: SuppressionChurnSection): void {
  lines.push(
    `  suppression-churn (git log -G'${section.pattern}'; minChanges ${section.minChanges}):`,
  );
  if (section.entries.length === 0) {
    lines.push(`    ${section.emptyReason ?? "no suppression-churn hotspots this window."}`);
    return;
  }
  for (const entry of section.entries) {
    const tag = formatBaselineTag(entry.baseline);
    lines.push(
      `    ${entry.path}  —  ${entry.suppressionChanges} suppression-changing commits${tag}`,
    );
    appendRowContext(lines, entry);
  }
}

function appendThrashSection(lines: string[], section: ThrashSection): void {
  lines.push(
    `  thrash (revisions >=${section.minRevisions}, net growth <=${section.maxNetLinesPerRevision} lines/revision; young <=${section.youngDays}d):`,
  );
  if (section.entries.length === 0) {
    lines.push(`    ${section.emptyReason ?? "no thrash hotspots this window."}`);
    return;
  }
  for (const entry of section.entries) {
    const tag = formatBaselineTag(entry.baseline);
    const young = entry.youngInWindow ? ", young-in-window" : "";
    lines.push(
      `    ${entry.path}  —  ${entry.revisions} revisions, net ${entry.netLines} (${formatScore(
        entry.netLinesPerRevision,
      )}/rev), ${entry.linesChanged} lines, test ${formatPercent(
        entry.testChurnRatio,
      )}, fix/revert ${entry.fixRevertCommits}${young}${tag}`,
    );
    if (entry.firstTouchAgeDays !== null) {
      lines.push(`        first touch age: ${entry.firstTouchAgeDays}d`);
    }
    appendRowContext(lines, entry);
  }
}

function formatScore(score: number): string {
  return score.toFixed(2);
}

function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
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
