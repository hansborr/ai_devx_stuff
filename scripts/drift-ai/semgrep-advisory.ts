// Prototype-lane advisory surface for the Semgrep candidate scan (semgrep
// plan, slice 3). Slice 1 owns the rule-source license/registry gate, slice 2
// owns the runner and JSON parser; this module folds a `SemgrepRunnerResult`
// plus the per-source `RuleSourceDecision`s into the shared prototype advisory
// envelope (task 39): `kind: "advisory"`, `lane: "prototype"`, the mandatory
// candidate banner, explicit prerequisite/cap/degradation disclosure, and
// NEVER a `findings` key. A missing binary and a blocked/missing rule source
// are expected absences — unmet prerequisites, not failures. Snippet policy
// (plan decision 5): rows carry path/range metadata, and the parser never
// reads `extra.lines`/`extra.fingerprint`. Semgrep's RENDERED messages can
// still embed matched source via metavariable interpolation, so they are
// withheld by default and carried only under `--include-rule-messages`, with
// the policy disclosed either way.

import { plural, positiveInt } from "./advisory-format-helpers.js";
import {
  buildPrototypeAdvisory,
  type PrototypeCap,
  type PrototypePrerequisite,
} from "./prototype-advisory.js";
import { buildGroups } from "./semgrep-advisory-groups.js";
import type {
  SemgrepAdvisory,
  SemgrepAdvisoryInput,
  SemgrepAdvisoryOptions,
  SemgrepAdvisorySection,
  SemgrepRuleSourceProvenance,
  SemgrepScanScope,
} from "./semgrep-advisory-types.js";
import {
  DEFAULT_SEMGREP_CANDIDATES_TOP,
  SEMGREP_CANDIDATES_SUBCOMMAND,
} from "./semgrep-advisory-types.js";
import type { RuleSourceDecision, SemgrepRuleSource } from "./semgrep-rule-sources.js";
import type { SemgrepRunnerResult, SemgrepToolInfo } from "./semgrep-runner-types.js";
import type { SemgrepScanError, SemgrepScanOutput } from "./semgrep-types.js";

export { formatSemgrepAdvisoryJson, formatSemgrepAdvisoryText } from "./semgrep-advisory-format.js";
export type {
  SemgrepAdvisory,
  SemgrepAdvisoryInput,
  SemgrepAdvisoryOptions,
} from "./semgrep-advisory-types.js";
export {
  DEFAULT_SEMGREP_CANDIDATES_TOP,
  SEMGREP_CANDIDATES_SUBCOMMAND,
} from "./semgrep-advisory-types.js";

const SEMGREP_CANDIDATE_KIND = "Semgrep candidate groups";
// Scan-error degradations are display-capped so a broken-parse storm cannot
// drown the rest of the report.
const MAX_ERROR_DEGRADATIONS = 5;

export function buildSemgrepAdvisory(
  input: SemgrepAdvisoryInput,
  options: SemgrepAdvisoryOptions = {},
): SemgrepAdvisory {
  const includeRuleMessages = options.includeRuleMessages === true;
  const allowed = input.ruleSources.filter((decision) => decision.allowed);
  const scan = input.run !== null && input.run.ok ? input.run.scan : null;
  return buildPrototypeAdvisory({
    subcommand: SEMGREP_CANDIDATES_SUBCOMMAND,
    ...(options.scanProvenance === undefined ? {} : { scanProvenance: options.scanProvenance }),
    prerequisites: [
      enginePrerequisite(input.run, input.ruleSources),
      ruleSourcePrerequisite(input.ruleSources, allowed),
    ],
    caps: input.run === null ? [] : [timeoutCap(input.run)],
    degradations: degradations(input, allowed.length > 0 ? input.ruleSources : []),
    sections: [semgrepSection(input, scan, allowed, { ...options, includeRuleMessages })],
  });
}

function semgrepSection(
  input: SemgrepAdvisoryInput,
  scan: SemgrepScanOutput | null,
  allowed: readonly RuleSourceDecision[],
  options: SemgrepAdvisoryOptions & { readonly includeRuleMessages: boolean },
): SemgrepAdvisorySection {
  const top = positiveInt(options.top, DEFAULT_SEMGREP_CANDIDATES_TOP);
  const groups = scan === null ? [] : buildGroups(scan, options.includeRuleMessages);
  return {
    candidateKind: SEMGREP_CANDIDATE_KIND,
    totalCandidates: groups.length,
    emptyReason: emptyReason(input.run, groups.length),
    entries: groups.slice(0, top),
    engineVersion: engineVersion(input.run),
    scannedCount: scan?.scannedCount ?? null,
    scanScope: scan === null ? null : scanScope(input),
    ruleMessages: options.includeRuleMessages ? "included" : "withheld",
    ruleSources: allowed.map(ruleSourceProvenance),
  };
}

// Target-side scan-scope disclosure (plan slice 5 follow-up): only a completed
// scan makes a coverage claim, so only a completed scan carries the data that
// qualifies it.
function scanScope(input: SemgrepAdvisoryInput): SemgrepScanScope {
  return { semgrepTargetFilters: "default", targetSemgrepignore: input.targetHasSemgrepignore };
}

function enginePrerequisite(
  run: SemgrepRunnerResult | null,
  declared: readonly RuleSourceDecision[],
): PrototypePrerequisite {
  const name = "semgrep engine";
  if (run === null) {
    // Honest non-claim: the binary was never resolved or probed, so the run
    // must not read as "engine checked and clear".
    const why =
      declared.length === 0
        ? "no rule source was declared"
        : "every declared rule source was blocked";
    return { name, satisfied: false, detail: `not probed -- the scan was skipped because ${why}` };
  }
  if (run.ok) return { name, satisfied: true, detail: describeTool(run.tool) };
  // timeout/run-failed keep the prerequisite satisfied (semgrep was present);
  // their own disclosures are the subprocess cap and a degradation line.
  const available = run.reason !== "tool-unavailable";
  return {
    name,
    satisfied: available,
    detail: available
      ? `${describeTool(run.tool)} ran but did not complete: ${run.error}`
      : `${describeTool(run.tool)} unavailable: ${run.error}`,
  };
}

function describeTool(tool: SemgrepToolInfo): string {
  const version = tool.version === undefined ? "" : `@${tool.version}`;
  const location =
    tool.source === "path" ? `'${tool.command}' on PATH` : `${tool.source} ${tool.command}`;
  return `semgrep${version} (${location})`;
}

function ruleSourcePrerequisite(
  declared: readonly RuleSourceDecision[],
  allowed: readonly RuleSourceDecision[],
): PrototypePrerequisite {
  const name = "semgrep rule source";
  if (declared.length === 0) {
    return {
      name,
      satisfied: false,
      detail:
        "no rule sources declared; pass --semgrep-config <path> [--rule-license <license>], " +
        "--rule-source-manifest <path>, or --registry-pack <p/pack>",
    };
  }
  const summary = `${allowed.length} of ${declared.length} declared rule ${plural(
    "source",
    declared.length,
  )} allowed`;
  if (allowed.length > 0) {
    const labels = allowed.map((decision) => sourceLabel(decision.source)).join(", ");
    return { name, satisfied: true, detail: `${summary}: ${labels}` };
  }
  const blocked = declared
    .map((decision) => `${sourceLabel(decision.source)} -- ${decision.blockedReasons.join("; ")}`)
    .join("; ");
  return { name, satisfied: false, detail: `${summary}: ${blocked}` };
}

function sourceLabel(source: SemgrepRuleSource): string {
  return source.kind === "local" ? `local ${source.config}` : `registry pack ${source.pack}`;
}

function ruleSourceProvenance(decision: RuleSourceDecision): SemgrepRuleSourceProvenance {
  const shared = {
    license: decision.license,
    licenseClass: decision.licenseClass,
    reproducible: decision.reproducible,
  };
  return decision.source.kind === "local"
    ? {
        ...shared,
        kind: "local",
        source: decision.source.config,
        sourceUrl: decision.source.sourceUrl,
        commit: decision.source.commit,
        sha256: decision.source.sha256,
      }
    : {
        ...shared,
        kind: "registry-pack",
        source: decision.source.pack,
        sourceUrl: null,
        commit: null,
        sha256: null,
      };
}

function timeoutCap(run: SemgrepRunnerResult): PrototypeCap {
  const hit = !run.ok && run.reason === "timeout";
  return {
    label: "semgrep subprocess wall-clock (ms)",
    limit: run.caps.timeoutMs,
    hit,
    detail: hit ? timeoutCapDetail(run) : null,
  };
}

const TARGET_SEMGREPIGNORE_DEGRADATION =
  "the target's own .semgrepignore file(s) further excluded paths from this scan, " +
  "beyond the drift ignore --exclude flags";

// Blocked-source lines render only when the scan still RAN with the remaining
// allowed sources (a partial rule set); with nothing allowed, the blocked
// reasons already live in the unmet rule-source prerequisite.
function degradations(
  input: SemgrepAdvisoryInput,
  declaredWhenPartial: readonly RuleSourceDecision[],
): string[] {
  const run = input.run;
  const lines = declaredWhenPartial
    .filter((decision) => !decision.allowed)
    .map(
      (decision) =>
        `rule source ${sourceLabel(decision.source)} was excluded from this scan: ` +
        decision.blockedReasons.join("; "),
    );
  if (run === null) return lines;
  if (!run.ok) {
    // tool-unavailable -> unmet prerequisite; timeout -> HIT subprocess cap;
    // only a run-failure needs its own degradation line.
    if (run.reason === "run-failed") {
      lines.push(`semgrep run failed before producing a report: ${run.error}`);
    }
    return lines;
  }
  // Semgrep honors a target-supplied .semgrepignore silently (plan slice 5
  // follow-up): a completed scan's coverage must say the target shaped it.
  if (input.targetHasSemgrepignore) lines.push(TARGET_SEMGREPIGNORE_DEGRADATION);
  return [...lines, ...scanDegradations(run.scan)];
}

function scanDegradations(scan: SemgrepScanOutput): string[] {
  const lines: string[] = [];
  if (scan.malformedResultCount > 0) {
    lines.push(
      `semgrep returned ${scan.malformedResultCount} malformed result ` +
        `${plural("row", scan.malformedResultCount)}; they are not in the candidate groups`,
    );
  }
  if (scan.skippedRules.length > 0) {
    lines.push(
      `semgrep skipped ${scan.skippedRules.length} invalid ` +
        `${plural("rule", scan.skippedRules.length)}: ${scan.skippedRules.join(", ")}`,
    );
  }
  for (const error of scan.errors.slice(0, MAX_ERROR_DEGRADATIONS)) {
    lines.push(scanErrorLine(error));
  }
  const hidden = scan.errors.length - MAX_ERROR_DEGRADATIONS;
  if (hidden > 0) lines.push(`...and ${hidden} more semgrep scan ${plural("error", hidden)}`);
  return lines;
}

function scanErrorLine(error: SemgrepScanError): string {
  const kind = [error.level, error.type].filter((part) => part !== null).join("/");
  const where = error.path === null ? "" : ` at ${error.path}`;
  return `semgrep scan error${kind.length === 0 ? "" : ` (${kind})`}${where}: ${error.message}`;
}

const RUN_FAILURE_PHRASE = {
  "run-failed": "the run failed",
  timeout: "the scan or probe timed out",
  "tool-unavailable": "the engine was unavailable",
} as const;

function emptyReason(run: SemgrepRunnerResult | null, totalGroups: number): string | null {
  if (totalGroups > 0) return null;
  if (run === null) return "scan skipped: no rule source was declared or allowed.";
  if (!run.ok) return `semgrep produced no candidate groups (${RUN_FAILURE_PHRASE[run.reason]}).`;
  return "semgrep reported no matches from the allowed rule sources.";
}

function timeoutCapDetail(run: SemgrepRunnerResult): string {
  if (run.ok || run.reason !== "timeout") return "";
  if (run.phase === "probe") {
    return `semgrep --version probe stopped at the ${run.caps.timeoutMs}ms subprocess cap; scan never started`;
  }
  return `semgrep scan stopped at the ${run.caps.timeoutMs}ms subprocess cap`;
}

function engineVersion(run: SemgrepRunnerResult | null): string | null {
  if (run === null) return null;
  if (run.ok && run.scan.engineVersion !== null) return run.scan.engineVersion;
  return run.tool.version ?? null;
}
