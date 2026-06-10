// Read-only effective-config inspection model for the `drift:ai config`
// subcommand. It renders what config drift:ai *would* use for a target repo —
// after defaults, normalization, and merges — without running a scan or writing
// any file. The portable JSON report (`--format json`) and the advisory shape are
// deliberately separate surfaces; this one carries its own `kind:
// "config-inspection"` discriminant so a consumer never confuses it with a
// `DriftReport` or a `kind: "advisory"` envelope.

import { ALL_CHECKS, DEFAULT_CHECKS } from "./check-metadata.js";
import type { DriftAiConfig } from "./config.js";
import { buildSourceExtensions } from "./scope.js";
import type { DriftCheckId } from "./types.js";

export const CONFIG_INSPECT_SUBCOMMAND = "config";

// How drift:ai found the config it is reporting on:
// - "explicit": the operator passed `--config <path>`;
// - "auto-discovered": a `drift-ai.config.json` at the target repo root loaded;
// - "default": no config file was found, so the built-in defaults are in effect.
export type ConfigInspectionSource = "default" | "auto-discovered" | "explicit";

export type ConfigInspection = {
  readonly kind: "config-inspection";
  readonly configSource: ConfigInspectionSource;
  // The config path as drift:ai names it (the raw `--config` value, the
  // auto-discovered filename, or null when defaults are in effect).
  readonly configPath: string | null;
  // Absolute repo root resolved from the target cwd (git `--show-toplevel`) — the
  // anchor for config discovery and repo-relative finding paths.
  readonly repoRoot: string;
  readonly defaultChecks: readonly DriftCheckId[];
  readonly implementedChecks: readonly DriftCheckId[];
  readonly roots: readonly string[];
  readonly additionalSourceExtensions: readonly string[];
  // The full set of scanned file extensions: the built-in source extensions plus
  // any `additionalSourceExtensions`, normalized and sorted.
  readonly sourceExtensions: readonly string[];
  // The full effective config after defaults, normalization, and merges.
  readonly config: DriftAiConfig;
};

export type BuildConfigInspectionInput = {
  readonly repoRoot: string;
  readonly config: DriftAiConfig;
  // Whether the operator passed `--config` explicitly. Drives the source
  // classification: an explicit path is reported as `explicit` even when it
  // happens to be the auto-discovery filename.
  readonly explicitConfig: boolean;
  // The config path `loadDriftAiConfig` resolved (null when defaults are in
  // effect because no file was found).
  readonly loadedConfigPath: string | null;
};

export function buildConfigInspection(input: BuildConfigInspectionInput): ConfigInspection {
  return {
    kind: "config-inspection",
    configSource: resolveSource(input),
    configPath: input.loadedConfigPath,
    repoRoot: input.repoRoot,
    defaultChecks: DEFAULT_CHECKS,
    implementedChecks: ALL_CHECKS,
    roots: input.config.roots,
    additionalSourceExtensions: input.config.additionalSourceExtensions,
    sourceExtensions: [...buildSourceExtensions(input.config.additionalSourceExtensions)].sort(),
    config: input.config,
  };
}

function resolveSource(input: BuildConfigInspectionInput): ConfigInspectionSource {
  if (input.explicitConfig) return "explicit";
  return input.loadedConfigPath === null ? "default" : "auto-discovered";
}

const NONE = "(none)";

function formatList(values: readonly string[]): string {
  return values.length === 0 ? NONE : values.join(", ");
}

function describeSource(inspection: ConfigInspection): string {
  switch (inspection.configSource) {
    case "default":
      return "default (built-in defaults; no drift-ai.config.json found)";
    case "auto-discovered":
      return `auto-discovered (${inspection.configPath ?? ""})`;
    case "explicit":
      return `explicit (${inspection.configPath ?? ""})`;
  }
}

// Concise human-readable summary. The full effective config (ignore rules,
// per-check config, coverage, envDefine) is left to `--format json`.
export function formatConfigInspectionText(inspection: ConfigInspection): string {
  return [
    "drift:ai effective config (read-only inspection; no files were written)",
    "",
    `config source:       ${describeSource(inspection)}`,
    `repo root:           ${inspection.repoRoot}`,
    `roots:               ${formatList(inspection.roots)}`,
    `additional ext:      ${formatList(inspection.additionalSourceExtensions)}`,
    `source extensions:   ${formatList(inspection.sourceExtensions)}`,
    `default checks:      ${formatList(inspection.defaultChecks)}`,
    `implemented checks:  ${formatList(inspection.implementedChecks)}`,
    "",
    "Run with --format json for the full effective config.",
  ].join("\n");
}

export function formatConfigInspectionJson(inspection: ConfigInspection): string {
  return JSON.stringify(inspection, null, 2);
}
