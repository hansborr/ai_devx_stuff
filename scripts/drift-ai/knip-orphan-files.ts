// knip orphan-files adapter: parse the unused-files category, resolve the target's
// knip config (config-authority ladder), and build provenance-stamped findings.
// The subprocess I/O lives in knip-runner.ts; the CheckPlugin wiring in
// knip-orphan-files-check.ts. This is a Tier-1 pass-through adapter (adapter
// contract §1): it surfaces the target's OWN knip verdict verbatim.

import { errorMessage } from "../lib/error-message.js";
import { isRecord } from "../lib/records.js";
import { discoverToolConfig, type PathProbe } from "./adapter-support.js";
import type { CheckRunContext } from "./check-plugin.js";
import type { FileReader } from "./comments.js";
import type { KnipRunner } from "./knip-runner.js";
import { changedFilesFromScope, sortFindingsByFileMessage, toPosix } from "./path-util.js";
import type { DetectorScope } from "./scope.js";
import type {
  ConfigSource,
  DriftCheckId,
  DriftFinding,
  FindingProvenance,
  SkipReasonCode,
} from "./types.js";

// Services the orphan-files adapter resolves for itself (plugin-owned setup). The
// knip runner plus the repo-relative probes/readers and the explicit --knip-config
// override (config-authority ladder rung 1; null when unset). Defined here, beside
// the resolution logic that reads it, so the plugin file imports it without a cycle.
export type OrphanFilesServices = {
  readonly knip: KnipRunner;
  readonly pathExists: PathProbe;
  readonly readFile: FileReader;
  readonly knipConfigOverride: string | null;
};

// Known target-local knip config locations, in priority order. Must NOT assume
// repo-root: OpenClaw ships config/knip.config.ts, not ./knip.json (01-shared-context).
// Mirrors knip's own discovery set plus the common non-root config/ location.
const KNIP_CONFIG_CANDIDATES: readonly string[] = [
  "knip.json",
  "knip.jsonc",
  ".knip.json",
  ".knip.jsonc",
  "knip.ts",
  "knip.js",
  "knip.config.ts",
  "knip.config.js",
  "knip.config.mjs",
  "config/knip.config.ts",
  "config/knip.config.js",
  "config/knip.json",
  "config/knip.jsonc",
];

const ORPHAN_FILES_REPAIR_HINT =
  "if the file is dead code, remove it; if it is an entry point or used dynamically (CLI, config, plugin), add it to the target's knip entry/ignore config so the signal stays clean.";

// Check-agnostic on purpose: shared by knip pass-through checks, so it must not
// name a single one of them in the diagnostic the user reads when they asked for
// another.
const NO_CONFIG_REASON =
  "no target-authored knip config found (searched knip.json, knip.config.ts, config/knip.config.ts, and package.json#knip). This is the expected state on a repo that does not use knip — the knip pass-through checks are Tier-1 and need the target's own knip config. Pass --knip-config <path> to point at one.";

const TARGET_NOT_INSTALLED_REASON =
  "target has no node_modules; knip cannot resolve the module graph to tell an orphaned file from a merely-unresolved import. Install the target's dependencies and re-run.";

export function targetNotInstalledReason(): string {
  return TARGET_NOT_INSTALLED_REASON;
}

export function toolNotInstalledReason(detail: string): string {
  return `knip executable not found in the tools checkout (${detail}); run \`bun install\` in the drift:ai tools checkout.`;
}

export function toolTimedOutReason(detail: string): string {
  return `knip exceeded the configured timeout (${detail}); no knip-backed findings were reported for this run.`;
}

// --- knip JSON parsing ------------------------------------------------------

export type ParseKnipOrphanFilesResult =
  | { readonly ok: true; readonly files: readonly string[] }
  | { readonly ok: false; readonly error: string };

// Parse the `files` category from `knip --reporter json` (knip 6.14.1 shape,
// confirmed against the pinned version): `{ "issues": [ { "file": "<path>",
// "files": [ { "name": "<path>" } ] } ] }`. A row is an orphaned file when its
// `files` array is non-empty; the orphan path is the row's `file`. Other
// categories (exports/deps) are ignored even if present.
export function parseKnipOrphanFiles(jsonText: string): ParseKnipOrphanFilesResult {
  // knip always prints `{"issues":[]}` even when clean, so empty output means the
  // run never produced a report (attempted-and-failed), not "no orphans".
  if (jsonText.trim().length === 0) return { ok: false, error: "knip produced no JSON output" };
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
  if (!isRecord(raw)) return { ok: false, error: "expected a JSON object with an 'issues' array" };
  const issues = raw["issues"];
  if (!Array.isArray(issues)) return { ok: true, files: [] };
  const files: string[] = [];
  for (const row of issues) {
    const orphan = orphanFileFromRow(row);
    if (orphan !== undefined) files.push(orphan);
  }
  return { ok: true, files };
}

// A knip JSON row is an orphaned file when its `files` array is non-empty; the
// orphan path is the row's `file`. Returns undefined for any other row shape.
function orphanFileFromRow(row: unknown): string | undefined {
  if (!isRecord(row)) return undefined;
  const fileList = row["files"];
  const file = row["file"];
  if (!Array.isArray(fileList) || fileList.length === 0) return undefined;
  if (typeof file !== "string" || file.length === 0) return undefined;
  return toPosix(file);
}

// --- config resolution (ladder rungs 1–4) -----------------------------------

export type KnipConfigResolution =
  | {
      readonly kind: "resolved";
      // Path to pass to knip via --config, or null to let knip auto-discover.
      readonly configPath: string | null;
      readonly configSource: ConfigSource;
      // Human/provenance label for the resolved config (e.g. "package.json#knip").
      readonly displayPath: string;
    }
  | { readonly kind: "skip"; readonly code: SkipReasonCode; readonly reason: string };

export function resolveKnipConfig(ctx: CheckRunContext<OrphanFilesServices>): KnipConfigResolution {
  const discovered = discoverToolConfig({
    override: ctx.services.knipConfigOverride,
    candidates: KNIP_CONFIG_CANDIDATES,
    fileExists: ctx.services.pathExists,
  });
  if (discovered !== null) {
    return {
      kind: "resolved",
      configPath: discovered.path,
      configSource: discovered.configSource,
      displayPath: discovered.path,
    };
  }
  // package.json#knip is knip-specific (needs a content read, not just existence),
  // so it sits outside the generic discoverToolConfig candidate list. knip
  // auto-discovers it, so no --config is needed.
  if (packageJsonHasKnipKey(ctx.services.readFile)) {
    return {
      kind: "resolved",
      configPath: null,
      configSource: "target-config",
      displayPath: "package.json#knip",
    };
  }
  return { kind: "skip", code: "no-target-config", reason: NO_CONFIG_REASON };
}

function packageJsonHasKnipKey(readFile: FileReader): boolean {
  const text = readFile("package.json");
  if (text === undefined) return false;
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) && parsed["knip"] !== undefined;
  } catch {
    return false;
  }
}

// --- findings ---------------------------------------------------------------

export function buildProvenance(resolution: {
  readonly configSource: ConfigSource;
  readonly displayPath: string;
}): FindingProvenance {
  return {
    configSource: resolution.configSource,
    tool: "knip",
    configPath: resolution.displayPath,
  };
}

export function buildOrphanFindings(
  orphanFiles: readonly string[],
  detectorScope: DetectorScope,
  provenance: FindingProvenance,
): DriftFinding[] {
  const inScope = filterOrphansToScope(orphanFiles, detectorScope);
  const findings = inScope.map<DriftFinding>((file) => ({
    check: "orphan-files",
    file,
    message: "file is never imported (knip reports it as an unused file)",
    hint: ORPHAN_FILES_REPAIR_HINT,
    provenance,
  }));
  return sortFindingsByFileMessage(findings);
}

// knip analyzes the whole project, so the orphan set is global. We scope it to the
// run's canonical relevance set:
//   - changed scope: intersect with the changed set (only newly/recently-touched
//     orphans are relevant).
//   - current scope: intersect with detector scope files, which prepareCurrentRun
//     already filtered through roots, ignore rules, regular-file checks, and source
//     extension policy.
// This only scopes report relevance, never knip's verdict — evidence, not verdicts
// (the target's knip config already owns what counts as an entry point).
function filterOrphansToScope(
  orphanFiles: readonly string[],
  detectorScope: DetectorScope,
): string[] {
  const unique = [...new Set(orphanFiles.map(toPosix))];
  if (detectorScope.scopeMode === "current") {
    const inScope = new Set(detectorScope.files.map((file) => toPosix(file.path)));
    return unique.filter((file) => inScope.has(file));
  }
  const changed = new Set(changedFilesFromScope(detectorScope).map((file) => toPosix(file.path)));
  return unique.filter((file) => changed.has(file));
}

// A single diagnostic for an attempted-and-failed run (adapter contract §4): knip
// ran (or could not be spawned) and broke. Deliberately one finding, not one per
// root (the jscpd mistake). No provenance — a failure is not an authored verdict.
// `check` is parameterized so knip-backed checks emit the diagnostic under their
// own id; defaults to orphan-files.
export function buildKnipDiagnosticFinding(
  file: string,
  message: string,
  check: DriftCheckId = "orphan-files",
): DriftFinding {
  return {
    check,
    file,
    message,
    hint: `report-only: re-run knip locally against the target to inspect the failure; ${check} is otherwise not reported for this run.`,
  };
}

export function knipUnreadableMessage(
  error: string,
  exitCode: number | null,
  stderr: string,
): string {
  const exit = exitCode === null ? "unknown" : String(exitCode);
  const excerpt = stderr.trim().slice(0, 200);
  const tail = excerpt.length > 0 ? `; stderr: ${excerpt}` : "";
  return `knip produced unreadable JSON (${error}); knip exit ${exit}${tail}`;
}
