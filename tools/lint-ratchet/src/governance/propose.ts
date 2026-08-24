import {
  buildLintRatchetBaseline,
  formatLintRatchetBaseline,
  type LintRatchetCurrentItem,
  ruleNamespace,
} from "../kernel/baseline.js";
import { isJsonValue, normalizeStringList } from "../kernel/baseline-hash.js";
import type {
  JsonValue,
  LintRatchetConfig,
  LintRatchetMetric,
  LintRatchetParserProfile,
  LintRatchetThirdPartyPluginAllowlistEntry,
} from "../kernel/config-types.js";
import { collectCurrentForRatchet } from "../kernel/current-collector.js";
import type {
  LintRatchetEngineBinding,
  LintRatchetWorkflowVocabulary,
} from "../kernel/engine-context.js";
import { trackedFilesFromGit } from "../kernel/git-tracked-files.js";
import { ConfigError } from "../kernel/metrics-types.js";
import { matchingTrackedFiles } from "../kernel/ratchet-globs.js";
import { hasNormalizedPath, metricPairingFailures } from "../kernel/registry-validation.js";
import { buildRuleSourceHashesById } from "../kernel/rule-source.js";
import { type PluginProbeShape, probePluginShape } from "./plugin-probe.js";
import { formatProposeSummary } from "./propose-format.js";

const PROPOSE_RATCHET_ID = "ratchet/propose";
const CORE_RULE_PATTERN = /^[a-z][a-z0-9-]*$/u;
const LOCAL_RULE_PATTERN = /^local\/[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const DEFAULT_PROPOSE_IGNORES = ["**/dist/**", "**/generated/**", "**/node_modules/**"] as const;
const TOP_FILE_LIMIT = 10;

type ProposePluginExport = "default" | "plugin";

export interface ProposeOptions {
  readonly ruleId: string;
  readonly files: readonly string[];
  readonly ignores?: readonly string[];
  readonly metric?: string;
  readonly ruleOptionsJson?: string;
  readonly pluginModule?: string;
  readonly pluginExport?: string;
  readonly parserProfile?: string;
  readonly trackedFiles?: readonly string[];
}

export interface ProposeTopFile {
  readonly path: string;
  readonly count: number;
}

export interface ProposeSummary {
  readonly ruleId: string;
  readonly sourceKind: "core" | "local" | "third-party";
  readonly parserProfile?: LintRatchetParserProfile;
  readonly pluginModule?: string;
  readonly pluginExport?: ProposePluginExport;
  readonly requiredAllowlistEntry?: LintRatchetThirdPartyPluginAllowlistEntry;
  readonly files: readonly string[];
  readonly ignores: readonly string[];
  readonly metric: LintRatchetMetric;
  readonly ruleOptions: readonly JsonValue[];
  readonly filesWithFindings: number;
  readonly totalFindings: number;
  readonly topFiles: readonly ProposeTopFile[];
  readonly baselineText: string;
  // Repo-relative location of the registry the reader pastes the config into,
  // supplied by the adapter (the package never names an adapter path).
  readonly registryHint: string;
}

interface ProposeRatchetParts {
  readonly ruleId: string;
  readonly files: readonly string[];
  readonly ignores: readonly string[];
  readonly metric: LintRatchetMetric;
  readonly ruleOptions: readonly JsonValue[];
}

export interface RunLintRatchetProposeCliOptions {
  readonly ruleId?: string;
  readonly files?: readonly string[];
  readonly ignores?: readonly string[];
  readonly metric?: string;
  readonly ruleOptionsJson?: string;
  readonly pluginModule?: string;
  readonly pluginExport?: string;
  readonly parserProfile?: string;
}

export interface ProposePreview {
  readonly ratchet: LintRatchetConfig;
  readonly binding: LintRatchetEngineBinding;
  readonly pluginExport?: ProposePluginExport;
  readonly requiredAllowlistEntry?: LintRatchetThirdPartyPluginAllowlistEntry;
}

// The repo binding the propose collection needs: where the gate runs and the
// registry's third-party plugin allowlist. Injected so the operation reaches the
// repository (tracked files, rule sources) without importing a repo-bound
// `paths` module or the Musi registry. `registryHint` is the human location the
// preview tells the reader to paste the promotable config into — an adapter
// concern (a repo-relative source path), so the package never names one itself.
export interface LintRatchetProposeEngine {
  readonly repoRoot: string;
  readonly binding: LintRatchetEngineBinding;
  readonly registryHint: string;
  readonly workflowVocabulary: LintRatchetWorkflowVocabulary;
}

function parseProposeMetric(metric: string | undefined): LintRatchetMetric {
  if (
    metric === undefined ||
    metric === "message-count" ||
    metric === "effective-line-count" ||
    metric === "complexity-severity"
  ) {
    return metric ?? "message-count";
  }
  throw new ConfigError(
    `--metric must be one of message-count, effective-line-count, complexity-severity; got ${metric}`,
  );
}

function parseProposeRuleOptions(raw: string | undefined): readonly JsonValue[] {
  if (raw === undefined) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`--rule-options must be valid JSON: ${message}`);
  }
  if (!Array.isArray(parsed) || !parsed.every(isJsonValue)) {
    throw new ConfigError("--rule-options must be a JSON array of JSON values");
  }
  return parsed;
}

function parsePluginExport(value: string | undefined): ProposePluginExport {
  if (value === undefined || value === "default" || value === "plugin") {
    return value ?? "default";
  }
  throw new ConfigError(`--plugin-export must be default or plugin; got ${value}`);
}

function parseParserProfile(value: string | undefined): LintRatchetParserProfile {
  if (value === undefined || value === "minimal-ts" || value === "type-aware-ts") {
    return value ?? "minimal-ts";
  }
  throw new ConfigError(`--parser-profile must be minimal-ts or type-aware-ts; got ${value}`);
}

function buildCoreProposeRatchet(parts: ProposeRatchetParts): LintRatchetConfig {
  return {
    id: PROPOSE_RATCHET_ID,
    ruleId: parts.ruleId,
    source: { kind: "core" },
    parserProfile: "minimal-ts",
    files: parts.files,
    ignores: parts.ignores,
    ruleOptions: parts.ruleOptions,
    mode: "no-new",
    metric: parts.metric,
    principle: "Proposed dry-run ratchet baseline.",
  };
}

function buildLocalProposeRatchet(parts: ProposeRatchetParts): LintRatchetConfig {
  return {
    id: PROPOSE_RATCHET_ID,
    ruleId: parts.ruleId,
    files: parts.files,
    ignores: parts.ignores,
    ruleOptions: parts.ruleOptions,
    mode: "no-new",
    metric: parts.metric,
    principle: "Proposed dry-run ratchet baseline.",
  };
}

function proposeSourceKind(ruleId: string): "core" | "local" | "third-party" {
  if (CORE_RULE_PATTERN.test(ruleId)) return "core";
  if (LOCAL_RULE_PATTERN.test(ruleId)) return "local";
  const namespace = ruleNamespace(ruleId);
  if (namespace === "local") {
    throw new ConfigError(`--propose local rule id must match local/<rule-name>: ${ruleId}`);
  }
  if (namespace !== undefined) return "third-party";
  throw new ConfigError(
    `--propose rule id must be a core rule, local/<rule-name>, or namespaced third-party rule: ${ruleId}`,
  );
}

function normalizedGlobs(values: readonly string[], label: "file" | "ignore"): readonly string[] {
  for (const value of values) {
    if (!hasNormalizedPath(value)) {
      throw new ConfigError(`--propose ${label} glob must be normalized: ${value || "(empty)"}`);
    }
  }
  return normalizeStringList([...new Set(values)]);
}

function rejectThirdPartyMetadataForBuiltInSource(options: ProposeOptions): void {
  if (
    options.pluginModule !== undefined ||
    options.pluginExport !== undefined ||
    options.parserProfile !== undefined
  ) {
    throw new ConfigError(
      "--plugin, --plugin-export, and --parser-profile are only valid for third-party rule ids",
    );
  }
}

interface ThirdPartyResolution {
  readonly pluginModule: string;
  readonly pluginExport: ProposePluginExport;
  readonly requiredAllowlistEntry?: LintRatchetThirdPartyPluginAllowlistEntry;
}

function selectedAllowlistedSupport(
  pluginModule: string | undefined,
  namespace: string,
  supports: readonly LintRatchetThirdPartyPluginAllowlistEntry[],
): LintRatchetThirdPartyPluginAllowlistEntry | undefined {
  if (pluginModule === undefined) {
    if (supports.length > 1) {
      throw new ConfigError(
        `namespace ${namespace} has multiple modules allowlisted (${supports.map((entry) => entry.pluginModule).join(", ")}); pass --plugin to disambiguate`,
      );
    }
    return supports[0];
  }
  const exactSupport = supports.find((entry) => entry.pluginModule === pluginModule);
  if (exactSupport !== undefined) return exactSupport;
  if (supports.length > 0) {
    const allowedModules = supports.map((entry) => entry.pluginModule).join(", ");
    throw new ConfigError(
      `--plugin ${pluginModule} conflicts with allowlisted module${supports.length === 1 ? "" : "s"} ${allowedModules} for namespace ${namespace}`,
    );
  }
  return undefined;
}

function resolveThirdPartySupport(
  options: ProposeOptions,
  allowlist: readonly LintRatchetThirdPartyPluginAllowlistEntry[],
): ThirdPartyResolution {
  const namespace = ruleNamespace(options.ruleId);
  if (namespace === undefined) {
    throw new ConfigError(`third-party rule id has no namespace: ${options.ruleId}`);
  }
  const namespaceSupports = allowlist.filter((entry) => entry.ruleNamespace === namespace);
  const support = selectedAllowlistedSupport(options.pluginModule, namespace, namespaceSupports);
  if (support !== undefined) {
    const allowlistedExport = support.pluginExport ?? "default";
    if (options.pluginExport !== undefined && options.pluginExport !== allowlistedExport) {
      throw new ConfigError(
        `--plugin-export ${options.pluginExport} conflicts with allowlisted export ${allowlistedExport} for namespace ${namespace}`,
      );
    }
    return { pluginModule: support.pluginModule, pluginExport: allowlistedExport };
  }

  if (options.pluginModule === undefined) {
    throw new ConfigError(
      `--plugin is required for third-party namespace ${namespace} because it is not allowlisted`,
    );
  }
  const pluginExport = parsePluginExport(options.pluginExport);
  const requiredAllowlistEntry = {
    pluginModule: options.pluginModule,
    ruleNamespace: namespace,
    pluginExport,
  } as const;
  return { pluginModule: options.pluginModule, pluginExport, requiredAllowlistEntry };
}

function normalizedProposeParts(options: ProposeOptions): {
  readonly parts: ProposeRatchetParts;
  readonly sourceKind: "core" | "local" | "third-party";
} {
  const files = normalizedGlobs(options.files, "file");
  const ignores = normalizedGlobs(
    [...DEFAULT_PROPOSE_IGNORES, ...(options.ignores ?? [])],
    "ignore",
  );
  const metric = parseProposeMetric(options.metric);
  const ruleOptions = parseProposeRuleOptions(options.ruleOptionsJson);
  const sourceKind = proposeSourceKind(options.ruleId);
  // Fail at preview on the same metric/ruleId pairings the registry rejects at
  // promotion, so the preview a copier assembles can actually become a ratchet.
  const pairingFailures = metricPairingFailures(
    PROPOSE_RATCHET_ID,
    options.ruleId,
    metric,
    sourceKind,
  );
  if (pairingFailures.length > 0) throw new ConfigError(pairingFailures.join("\n"));
  const parts: ProposeRatchetParts = {
    ruleId: options.ruleId,
    files,
    ignores,
    metric,
    ruleOptions,
  };
  return { parts, sourceKind };
}

export function buildProposePreview(
  options: ProposeOptions,
  binding: LintRatchetEngineBinding,
): ProposePreview {
  const { parts, sourceKind } = normalizedProposeParts(options);
  if (sourceKind === "core" || sourceKind === "local") {
    rejectThirdPartyMetadataForBuiltInSource(options);
    return {
      ratchet:
        sourceKind === "core" ? buildCoreProposeRatchet(parts) : buildLocalProposeRatchet(parts),
      binding,
    };
  }

  const resolution = resolveThirdPartySupport(options, binding.thirdPartyPluginAllowlist);
  const parserProfile = parseParserProfile(options.parserProfile);
  const thirdPartyParts = {
    id: PROPOSE_RATCHET_ID,
    ruleId: parts.ruleId,
    source: { kind: "third-party", pluginModule: resolution.pluginModule },
    files: parts.files,
    ignores: parts.ignores,
    ruleOptions: parts.ruleOptions,
    mode: "no-new",
    metric: parts.metric,
    principle: "Proposed dry-run ratchet baseline.",
  } as const;
  const ratchet: LintRatchetConfig =
    parserProfile === "minimal-ts"
      ? { ...thirdPartyParts, parserProfile: "minimal-ts" }
      : { ...thirdPartyParts, parserProfile: "type-aware-ts" };
  if (resolution.requiredAllowlistEntry === undefined) {
    return { ratchet, binding, pluginExport: resolution.pluginExport };
  }
  return {
    ratchet,
    binding: {
      ...binding,
      thirdPartyPluginAllowlist: [
        ...binding.thirdPartyPluginAllowlist,
        resolution.requiredAllowlistEntry,
      ],
    },
    pluginExport: resolution.pluginExport,
    requiredAllowlistEntry: resolution.requiredAllowlistEntry,
  };
}

export function buildProposeRatchet(options: ProposeOptions): LintRatchetConfig {
  return buildProposePreview(options, {
    repoRoot: "",
    thirdPartyPluginAllowlist: [],
  }).ratchet;
}

function countItems(items: ReadonlyMap<string, LintRatchetCurrentItem>): number {
  let total = 0;
  for (const item of items.values()) total += item.count;
  return total;
}

function topFiles(items: ReadonlyMap<string, LintRatchetCurrentItem>): readonly ProposeTopFile[] {
  return [...items.entries()]
    .map(([path, item]) => ({ path, count: item.count }))
    .sort((left, right) => right.count - left.count || left.path.localeCompare(right.path))
    .slice(0, TOP_FILE_LIMIT);
}

function normalizedError(error: unknown): Error {
  return error instanceof Error ? error : new ConfigError(String(error));
}

function ruleShortName(ruleId: string): string {
  const namespace = ruleNamespace(ruleId);
  return namespace === undefined ? ruleId : ruleId.slice(namespace.length + 1);
}

/**
 * Load the plugin the generated ESLint config will load and confirm it actually
 * carries the proposed rule, before any collection runs. The alternative is
 * classifying a downstream ESLint failure by its message text, which pins
 * runtime- and version-specific phrasing and cannot tell "no such rule" apart
 * from "no findings" when the file set is empty. Everything asserted below is
 * read off the real module object.
 */
async function preflightThirdPartyPlugin(
  preview: ProposePreview,
  binding: LintRatchetEngineBinding,
): Promise<void> {
  const source = preview.ratchet.source;
  if (source?.kind !== "third-party") return;
  const { pluginModule } = source;
  const pluginExport = preview.pluginExport ?? "default";
  const shortName = ruleShortName(preview.ratchet.ruleId);

  let shape: PluginProbeShape;
  try {
    shape = await probePluginShape(pluginModule, pluginExport, shortName, binding);
  } catch (error) {
    // The probe raises its own actionable ConfigError when the plugin resolved
    // but failed; anything else means it never got that far.
    if (error instanceof ConfigError) throw error;
    throw new ConfigError(
      `--plugin ${pluginModule} could not be resolved from the proposal repository; install the package or correct --plugin.\n${normalizedError(error).message}`,
    );
  }

  if (!shape.usable) {
    const alternative = pluginExport === "plugin" ? "default" : "plugin";
    throw new ConfigError(
      `--plugin-export ${pluginExport} did not resolve a usable plugin object from ${pluginModule}; use --plugin-export ${alternative} if the package exposes the plugin that way.`,
    );
  }

  if (!shape.definesRule) {
    throw new ConfigError(
      `--plugin-export ${pluginExport} of ${pluginModule} does not define ${preview.ratchet.ruleId}; verify the rule id, or try the other --plugin-export if the package exposes more than one plugin object.`,
    );
  }
}

export async function runLintRatchetPropose(
  options: ProposeOptions,
  engine: LintRatchetProposeEngine,
): Promise<ProposeSummary> {
  const preview = buildProposePreview(options, engine.binding);
  await preflightThirdPartyPlugin(preview, preview.binding);
  const { ratchet } = preview;
  let ruleSourceHashesById: ReadonlyMap<string, string>;
  let items: ReadonlyMap<string, LintRatchetCurrentItem>;
  try {
    ruleSourceHashesById = buildRuleSourceHashesById([ratchet], preview.binding);
    const ruleSourceHash = ruleSourceHashesById.get(ratchet.id);
    if (ruleSourceHash === undefined) {
      throw new ConfigError(`lint:ratchet: missing rule source hash for ${ratchet.id}`);
    }
    const trackedFiles =
      options.trackedFiles ??
      trackedFilesFromGit("collecting lint ratchet propose files", engine.repoRoot);
    items = await collectCurrentForRatchet(
      ratchet,
      ruleSourceHash,
      matchingTrackedFiles(ratchet, trackedFiles),
      preview.binding,
    );
  } catch (error) {
    // The preflight has already turned the actionable plugin failures into
    // typed ConfigErrors, so anything reaching here is genuinely unexpected;
    // surface it as-is rather than guessing at a cause from its wording.
    throw normalizedError(error);
  }
  const currentById = new Map([[ratchet.id, items]]);
  const baseline = buildLintRatchetBaseline([ratchet], currentById, ruleSourceHashesById, {
    workflowVocabulary: engine.workflowVocabulary,
  });
  return {
    ruleId: options.ruleId,
    sourceKind: ratchet.source?.kind ?? "local",
    parserProfile: ratchet.parserProfile ?? "minimal-ts",
    ...(ratchet.source?.kind === "third-party"
      ? { pluginModule: ratchet.source.pluginModule, pluginExport: preview.pluginExport }
      : {}),
    ...(preview.requiredAllowlistEntry === undefined
      ? {}
      : { requiredAllowlistEntry: preview.requiredAllowlistEntry }),
    files: ratchet.files,
    ignores: ratchet.ignores,
    metric: ratchet.metric,
    ruleOptions: ratchet.ruleOptions,
    filesWithFindings: items.size,
    totalFindings: countItems(items),
    topFiles: topFiles(items),
    baselineText: formatLintRatchetBaseline(baseline, engine.workflowVocabulary),
    registryHint: engine.registryHint,
  };
}

export function formatLintRatchetPropose(
  summary: ProposeSummary,
  workflowVocabulary: LintRatchetWorkflowVocabulary,
): string {
  return formatProposeSummary(summary, workflowVocabulary);
}

export async function runLintRatchetProposeCli(
  options: RunLintRatchetProposeCliOptions,
  engine: LintRatchetProposeEngine,
): Promise<void> {
  const {
    ruleId,
    files,
    ignores,
    metric,
    ruleOptionsJson,
    pluginModule,
    pluginExport,
    parserProfile,
  } = options;
  if (ruleId === undefined || files === undefined) {
    throw new ConfigError("--propose requires <ruleId> <glob...>");
  }
  if (parserProfile === "type-aware-ts") {
    console.error(
      `lint:ratchet:propose ${ruleId} starting type-aware collection; project-service setup and broad globs may take longer.`,
    );
  }
  const summary = await runLintRatchetPropose(
    {
      ruleId,
      files,
      ...(ignores === undefined ? {} : { ignores }),
      ...(metric === undefined ? {} : { metric }),
      ...(ruleOptionsJson === undefined ? {} : { ruleOptionsJson }),
      ...(pluginModule === undefined ? {} : { pluginModule }),
      ...(pluginExport === undefined ? {} : { pluginExport }),
      ...(parserProfile === undefined ? {} : { parserProfile }),
    },
    engine,
  );
  process.stdout.write(formatLintRatchetPropose(summary, engine.workflowVocabulary));
  console.error(
    `lint:ratchet:propose ${summary.ruleId} OK — ${String(summary.totalFindings)} current finding(s); ` +
      `${String(summary.filesWithFindings)} file(s) with findings.`,
  );
}
