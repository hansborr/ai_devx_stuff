// The two renderings of one `ScanReport` (backlog leaf 119): the human report
// doctor streams, and the harness-diagnostics findings the `--json` mode emits.
//
// Both read the same classified hits and the same guidance sentence, so a rule
// whose wording changes cannot drift between the `Risk:` line and the JSON
// `why` field. Neither renderer touches the filesystem or the process.

import type { HarnessFinding } from "@musi/harness-diagnostics/schema.js";

import {
  type ClassifiedHit,
  MIGRATION_SAFETY_CONTROL,
  ruleGuidance,
  type ScanReport,
  type ScanTotals,
  scanTotals,
} from "./migration-safety-core.js";

const FINDING_INDENT = "       ";
const WARN_ONLY_NOTE =
  "Mode: warn-only. WARN findings in the actionable warnings section name the migration, line, operation, and one-line review hint; other WARN findings name allowlist lines to fix. Confirm destructive intent and any backfill or dependent-read change is in the same migration or a precursor commit before applying to a shared database.";
const STALE_RISK =
  "stale entry — fix the typo or remove the line if the migration was renamed or removed.";

function allowlistLabel(report: ScanReport): string {
  return report.allowlistDisplayPath === "" ? "the allowlist" : report.allowlistDisplayPath;
}

function howToAcknowledge(report: ScanReport): string {
  return `Acknowledge intentional destructive migrations by adding the migration directory name to ${allowlistLabel(report)}, or split into the safe multi-step pattern (add nullable, backfill, then SET NOT NULL).`;
}

function howToDropAcknowledgement(report: ScanReport): string {
  return `Already acknowledged. If the migration is renamed or dropped, also remove the line from ${allowlistLabel(report)}.`;
}

function howToFixStale(report: ScanReport): string {
  return `Remove the stale entry from ${allowlistLabel(report)}, or fix the typo if the migration was renamed.`;
}

function staleWhy(report: ScanReport, name: string): string {
  return `stale acknowledgement "${name}" — no migration at ${report.allowlistDisplayDir}/${name}/migration.sql`;
}

function renderHit(hit: ClassifiedHit): string {
  const heading =
    hit.acknowledgedReason === undefined
      ? `WARN: ${hit.path}:${String(hit.line)} — ${hit.rule}\n`
      : `INFO: ${hit.path}:${String(hit.line)} — ${hit.rule} (acknowledged: ${hit.acknowledgedReason})\n`;
  return `${heading}${FINDING_INDENT}Risk: ${ruleGuidance(hit.rule)}\n${FINDING_INDENT}> ${hit.snippet}\n`;
}

function renderFindingSections(report: ScanReport, totals: ScanTotals): string {
  if (report.hits.length === 0) return "No destructive operations detected.\n";
  let out = "\n== actionable warnings ==\n";
  out +=
    totals.unacknowledged === 0
      ? "No actionable warnings; acknowledged findings are listed separately.\n"
      : report.hits
          .filter((hit) => hit.acknowledgedReason === undefined)
          .map(renderHit)
          .join("");
  if (totals.acknowledged > 0) {
    out += "\n== acknowledged findings ==\n";
    out += report.hits
      .filter((hit) => hit.acknowledgedReason !== undefined)
      .map(renderHit)
      .join("");
  }
  return out;
}

function renderStaleSection(report: ScanReport): string {
  if (report.staleEntries.length === 0) return "";
  const lines = report.staleEntries.map(
    (entry) =>
      `WARN: ${report.allowlistDisplayPath}:${String(entry.line)} — ${staleWhy(report, entry.name)}\n${FINDING_INDENT}Risk: ${STALE_RISK}\n`,
  );
  return `\n== stale acknowledgements ==\n${lines.join("")}`;
}

function renderVerdict(report: ScanReport, totals: ScanTotals): string {
  if (totals.unacknowledged === 0 && report.staleEntries.length === 0) {
    return report.hits.length === 0
      ? "PASS: migration safety — no destructive operations detected\n"
      : `PASS: migration safety — ${String(totals.acknowledged)} acknowledged finding(s), 0 unacknowledged\n`;
  }
  let out = "";
  if (totals.unacknowledged > 0 && report.allowlistPath !== "") {
    out += `Acknowledge intentional destructive migrations by adding their directory name to ${report.allowlistPath} (one per line, optional reason after whitespace).\n`;
  }
  if (totals.unacknowledged > 0) {
    out += `WARN: migration safety — ${String(totals.unacknowledged)} unacknowledged destructive operation(s) in ${String(totals.unacknowledgedMigrations)} migration(s)\n`;
  }
  if (report.staleEntries.length === 1) {
    out += `WARN: migration safety — 1 stale allowlist entry in ${report.allowlistDisplayPath} — fix the typo or remove the line\n`;
  } else if (report.staleEntries.length > 1) {
    out += `WARN: migration safety — ${String(report.staleEntries.length)} stale allowlist entries in ${report.allowlistDisplayPath} — fix the typos or remove the lines\n`;
  }
  return out;
}

function renderSummary(report: ScanReport, totals: ScanTotals): string {
  let out = "\n== summary ==\n";
  if (report.hits.length > 0) {
    out += `Findings: ${String(totals.total)} in ${String(totals.fileCount)} migration(s) of ${String(report.scannedFileCount)} scanned (${String(totals.unacknowledged)} unacknowledged WARN, ${String(totals.acknowledged)} acknowledged INFO).\n`;
  }
  if (report.staleEntries.length > 0) {
    out += `Stale allowlist entries: ${String(report.staleEntries.length)} in ${report.allowlistDisplayPath}.\n`;
  }
  return `${out}${WARN_ONLY_NOTE}\n${renderVerdict(report, totals)}`;
}

/** The full human-readable report, byte-for-byte as doctor streams it. */
export function renderHumanReport(report: ScanReport): string {
  const totals = scanTotals(report.hits);
  return [
    "== migration safety scanner ==\n",
    `Scanned ${String(report.scannedFileCount)} migration file(s).\n`,
    renderFindingSections(report, totals),
    renderStaleSection(report),
    renderSummary(report, totals),
  ].join("");
}

interface FindingFields {
  readonly severity: "warn" | "info";
  readonly path?: string;
  readonly line?: number;
  readonly messageId?: string;
  readonly why: string;
  readonly howToFix: string;
}

// Key insertion order matches the shared schema's field order, which is the
// order `harness-emit-envelope.ts` produced when it re-serialized parsed
// findings; keeping it identical keeps the emitted envelope byte-stable.
//
// An empty optional value omits its key rather than emitting it, which is the
// convention the shell helper this replaced encoded in jq
// (`scripts/lib/harness-finding.sh:25-27`, `if $path == "" then {} else …`).
// `harnessFindingSchema` types `path`/`messageId` as `.min(1).optional()`, so
// `path: ""` is a validation error, not an empty field — and the scanner can
// legitimately hold an empty path: an empty positional PATH argument becomes a
// `missing-target` collection warning carrying the argument verbatim. Emitting
// the key there would throw inside the envelope validator and take a warn-only
// tool to exit 1 with no envelope at all.
function finding(fields: FindingFields): HarnessFinding {
  return {
    control: MIGRATION_SAFETY_CONTROL,
    severity: fields.severity,
    ...(fields.path === undefined || fields.path === "" ? {} : { path: fields.path }),
    ...(fields.line === undefined ? {} : { line: fields.line }),
    ...(fields.messageId === undefined || fields.messageId === ""
      ? {}
      : { messageId: fields.messageId }),
    why: fields.why,
    howToFix: fields.howToFix,
    repairKind: "manual",
  };
}

function hitFinding(report: ScanReport, hit: ClassifiedHit): HarnessFinding {
  const reason = hit.acknowledgedReason;
  return finding({
    severity: reason === undefined ? "warn" : "info",
    path: hit.path,
    line: hit.line,
    messageId: hit.rule,
    why:
      reason === undefined
        ? `${hit.rule} — ${ruleGuidance(hit.rule)}`
        : `${hit.rule} (acknowledged): ${reason}`,
    howToFix: reason === undefined ? howToAcknowledge(report) : howToDropAcknowledgement(report),
  });
}

/**
 * The same report as harness-diagnostics findings, in emission order:
 * collection warnings, then scan findings, then stale-allowlist findings.
 */
export function toHarnessFindings(report: ScanReport): readonly HarnessFinding[] {
  const collection = report.collectionWarnings.map((warning) =>
    finding({
      severity: "warn",
      path: warning.path,
      messageId: warning.messageId,
      why: warning.message,
      howToFix: warning.howToFix,
    }),
  );
  const hits = report.hits.map((hit) => hitFinding(report, hit));
  // No guard on an empty `allowlistDisplayPath`: a stale entry can only exist
  // when an allowlist was read, so the path is always set here. Suppressing the
  // findings on that impossible branch would silently drop warnings, and
  // `finding()` already omits an empty path rather than emitting an invalid one.
  const stale = report.staleEntries.map((entry) =>
    finding({
      severity: "warn",
      path: report.allowlistDisplayPath,
      line: entry.line,
      messageId: "stale-allowlist",
      why: staleWhy(report, entry.name),
      howToFix: howToFixStale(report),
    }),
  );
  return [...collection, ...hits, ...stale];
}
