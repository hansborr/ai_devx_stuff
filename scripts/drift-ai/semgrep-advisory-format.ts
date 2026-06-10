// Text/JSON rendering for the Semgrep prototype advisory (semgrep plan,
// slice 3), split from semgrep-advisory.ts the way birth-size-delta-format.ts
// is split from its builder. Renders through the shared prototype header and
// section frame; row text stays evidence-shaped (counts, ranges, rule
// metadata) and never carries snippets or WARN/FIX language. Semgrep's
// rendered messages can embed matched source via metavariable interpolation,
// so they appear only under --include-rule-messages and the section states
// the policy either way.

import { plural } from "./advisory-format-helpers.js";
import {
  appendPrototypeSection,
  formatPrototypeAdvisoryJson,
  formatPrototypeHeader,
} from "./prototype-advisory.js";
import type {
  SemgrepAdvisory,
  SemgrepAdvisoryRow,
  SemgrepAdvisorySection,
  SemgrepCandidateRange,
  SemgrepRuleSourceProvenance,
} from "./semgrep-advisory-types.js";

// Per-row range lists are display-capped so one noisy rule cannot drown the
// rest of the report; the full range list stays in the JSON row.
const MAX_RANGES_SHOWN = 5;

export function formatSemgrepAdvisoryJson(advisory: SemgrepAdvisory): string {
  return formatPrototypeAdvisoryJson(advisory);
}

export function formatSemgrepAdvisoryText(advisory: SemgrepAdvisory): string {
  const lines = formatPrototypeHeader(advisory);
  for (const section of advisory.sections) {
    lines.push("");
    appendPrototypeSection(lines, section, renderRow, { preludeLines: sectionPrelude });
  }
  return lines.join("\n");
}

function sectionPrelude(section: SemgrepAdvisorySection): readonly string[] {
  const lines = section.ruleSources.map(ruleSourceLine);
  const facts: string[] = [];
  if (section.engineVersion !== null) facts.push(`engine semgrep@${section.engineVersion}`);
  if (section.scannedCount !== null) {
    facts.push(`scanned ${section.scannedCount} ${plural("file", section.scannedCount)}`);
  }
  if (facts.length > 0) lines.push(facts.join("; "));
  if (section.scanScope !== null) {
    // The target .semgrepignore shaping renders as a header degradation line;
    // this line covers Semgrep's own target filters that are always active.
    lines.push(
      "scan scope: Semgrep target filters applied (default patterns plus target .gitignore/.semgrepignore)",
    );
  }
  // Stated only when rows exist: with no candidates there is nothing the
  // policy withholds or includes.
  if (section.entries.length > 0) lines.push(ruleMessagesLine(section.ruleMessages));
  return lines;
}

function ruleMessagesLine(policy: SemgrepAdvisorySection["ruleMessages"]): string {
  return policy === "included"
    ? "rule messages: included via --include-rule-messages; Semgrep renders matched source into messages via metavariable interpolation"
    : "rule messages: withheld (Semgrep renders matched source into messages via metavariable interpolation); pass --include-rule-messages to include them";
}

function ruleSourceLine(provenance: SemgrepRuleSourceProvenance): string {
  const head =
    provenance.kind === "local"
      ? `local ${provenance.source}`
      : `registry pack ${provenance.source}`;
  const license = `license ${provenance.license ?? "undeclared"} (${provenance.licenseClass})`;
  const origin = provenance.kind === "registry-pack" ? "live registry" : pinLabel(provenance);
  const url = provenance.sourceUrl === null ? "" : `; from ${provenance.sourceUrl}`;
  const reproducible = provenance.reproducible ? "true" : "false";
  return `rule source: ${head} -- ${license}; ${origin}${url}; reproducible: ${reproducible}`;
}

function pinLabel(provenance: SemgrepRuleSourceProvenance): string {
  const pins = [
    ...(provenance.commit === null ? [] : [`commit ${provenance.commit}`]),
    ...(provenance.sha256 === null ? [] : [`sha256 ${provenance.sha256}`]),
  ];
  return pins.length === 0 ? "unpinned" : `pinned ${pins.join(", ")}`;
}

function renderRow(row: SemgrepAdvisoryRow): readonly string[] {
  const lines = [
    `#${row.rank} ${row.checkId} ${row.path} -- ${row.count} ${plural("hit", row.count)}, ${rangesLabel(row.ranges)}`,
    factsLine(row),
  ];
  // A null message is the withheld-by-default policy (the section prelude
  // says so); point the inspect step at the rule id instead.
  if (row.message !== null && row.message.length > 0) lines.push(`message: ${row.message}`);
  const against = row.message === null ? `rule ${row.checkId}` : "the rule message";
  lines.push(
    `inspect: open ${row.path}:${row.ranges[0]?.startLine ?? 1} and confirm or discard against ${against}.`,
  );
  return lines;
}

function rangesLabel(ranges: readonly SemgrepCandidateRange[]): string {
  const shown = ranges.slice(0, MAX_RANGES_SHOWN).map(formatRange).join(", ");
  const hidden = ranges.length - MAX_RANGES_SHOWN;
  const word =
    ranges.length === 1 && ranges[0]?.startLine === ranges[0]?.endLine ? "line" : "lines";
  return hidden > 0 ? `${word} ${shown} (+${hidden} more)` : `${word} ${shown}`;
}

function formatRange(range: SemgrepCandidateRange): string {
  return range.startLine === range.endLine
    ? String(range.startLine)
    : `${range.startLine}-${range.endLine}`;
}

function factsLine(row: SemgrepAdvisoryRow): string {
  const meta = row.metadata;
  const parts = [`severity ${lower(row.severity)}`, `confidence ${lower(meta.confidence)}`];
  if (meta.likelihood !== null) parts.push(`likelihood ${lower(meta.likelihood)}`);
  if (meta.impact !== null) parts.push(`impact ${lower(meta.impact)}`);
  if (meta.category !== null) {
    parts.push(`category ${[meta.category, ...meta.subcategory].join("/")}`);
  }
  if (meta.cwe.length > 0) parts.push(`cwe ${meta.cwe.join(", ")}`);
  if (meta.owasp.length > 0) parts.push(`owasp ${meta.owasp.join(", ")}`);
  const firstReference = meta.references[0];
  if (firstReference !== undefined) {
    const more = meta.references.length - 1;
    parts.push(`ref ${firstReference}${more > 0 ? ` (+${more} more)` : ""}`);
  }
  return parts.join("; ");
}

// Rule-declared enums (ERROR/WARNING/HIGH/...) render lowercase in TEXT so the
// advisory surface carries no shouty warning-style tokens; JSON keeps the
// verbatim values as data.
function lower(value: string | null): string {
  return value === null ? "unknown" : value.toLowerCase();
}
