import type { ScopeFile, ScopeMode } from "./scope.js";

export type DriftCheckId =
  | "duplicates"
  | "ghost-files"
  | "comments"
  | "commented-out-code"
  | "suppressions"
  | "module-doc-paths"
  | "orphan-files"
  | "knip-duplicates"
  | "import-cycles"
  | "layer-direction"
  | "near-duplicates"
  | "duplicate-types"
  | "duplicate-schemas"
  | "duplicate-literals"
  | "duplicate-constants"
  | "unused-exports";

// Bumped to 5 for the additive `changed-scope-only` skip code: the native
// suppressions check now emits a machine-readable `SkippedDriftCheck.code`
// alongside its unchanged current-scope reason. Additive for tolerant readers
// (`code` itself dates to v3), but a strict reader must accept the widened
// `SkipReasonCode` union. Earlier bumps under the same discipline: v3 -> v4
// added the optional per-check timing evidence (`DriftReport.checkTimings`,
// `DriftReport.totalDurationMs`); v2 -> v3 added the knip orphan-files
// adapter's `DriftFinding.provenance` and `SkippedDriftCheck.code`.
export const DRIFT_SCHEMA_VERSION = 5 as const;

// Who authored the verdict behind an adapter finding (adapter contract §0/§6):
// the target's own config, a tool's published default, or a drift:ai baseline.
// First-class so a `drift-baseline` opinion is never mistaken for the target's own.
export type ConfigSource = "target-config" | "tool-default" | "drift-baseline";

export type FindingProvenance = {
  readonly configSource: ConfigSource;
  // The engine that produced the finding, e.g. "knip", "ts-morph".
  readonly tool: string;
  // The resolved config the verdict came from, when configSource !== "drift-baseline".
  readonly configPath?: string;
};

// Machine-readable skip codes carried alongside the human reason so JSON
// consumers (and the text formatter) branch on the code, never on the reason
// prose. The adapter layer standardized them first (adapter contract §4), but
// they are not adapter-only: native checks carry them too — `changed-scope-only`
// is the suppressions check's current-scope skip. A skip is an *expected
// absence* (nothing went wrong), never a finding.
export type SkipReasonCode =
  | "tool-not-installed"
  | "tool-timeout"
  | "target-not-installed"
  | "no-target-config"
  | "resolution-too-partial"
  | "changed-scope-only";

export type ChangedFileStatus = "added" | "modified" | "renamed" | "copied" | "deleted";

export type ChangedFile = {
  readonly path: string;
  readonly status: ChangedFileStatus;
  readonly previousPath?: string;
};

export type DriftFinding = {
  readonly check: DriftCheckId;
  readonly file: string;
  readonly message: string;
  readonly hint?: string;
  readonly relatedFiles?: readonly string[];
  // Optional, machine-readable specifics a check attaches when it has structured
  // context worth exposing to JSON consumers (suppression kind/line/target,
  // near-duplicate similarity, import-cycle size, harness-freshness category).
  // Populated per-check, not universally — checks with nothing structured to add
  // omit it; readers must treat it as optional and never assume a shape across checks.
  readonly details?: Readonly<Record<string, string | number | boolean | readonly string[]>>;
  // Set by external-tool adapters so the reader always sees who authored the
  // verdict (adapter contract §6). Non-adapter findings omit it.
  readonly provenance?: FindingProvenance;
};

export type DriftReportSummary = {
  readonly total: number;
  readonly byCheck: Readonly<Partial<Record<DriftCheckId, number>>>;
};

// Wall-clock spent dispatching one check during a report build, recorded even for
// a check that skipped so a skip's cheapness is visible. One entry per dispatched
// check, in run order. `durationMs` is whole milliseconds. Evidence only: timing
// never gates, sorts, or changes a finding's severity (task 15). The report's
// `totalDurationMs` is the sum of every `checkTimings[].durationMs`.
export type CheckTiming = {
  readonly check: DriftCheckId;
  readonly durationMs: number;
};

export type DriftReport = {
  readonly schemaVersion: typeof DRIFT_SCHEMA_VERSION;
  readonly scopeMode: ScopeMode;
  readonly base: string | null;
  readonly resolvedRef: string | null;
  readonly roots: readonly string[];
  readonly configPath: string | null;
  readonly enabledChecks: readonly DriftCheckId[];
  readonly skippedChecks: readonly SkippedDriftCheck[];
  readonly summary: DriftReportSummary;
  // Per-check wall-clock evidence (task 15). Present on reports produced by
  // `buildReport`; optional so consumers and fixtures that ignore timing need not
  // supply it. `totalDurationMs` is the sum of `checkTimings[].durationMs`.
  readonly checkTimings?: readonly CheckTiming[];
  readonly totalDurationMs?: number;
  readonly findings: readonly DriftFinding[];
  readonly scopeCount: number;
  readonly scope: readonly ScopeFile[];
};

export type DriftFindingChunk = {
  readonly schemaVersion: typeof DRIFT_SCHEMA_VERSION;
  readonly scopeMode: ScopeMode;
  readonly roots: readonly string[];
  readonly enabledChecks: readonly DriftCheckId[];
  readonly totalFindings: number;
  readonly chunkSize: number;
  readonly chunkIndex: number;
  readonly chunkCount: number;
  readonly check: DriftCheckId;
  readonly findings: readonly DriftFinding[];
};

type DriftChunkManifestEntry = {
  readonly index: number;
  readonly path: string;
  readonly check: DriftCheckId;
  readonly findingCount: number;
};

export type DriftChunkManifest = {
  readonly schemaVersion: typeof DRIFT_SCHEMA_VERSION;
  readonly scopeMode: ScopeMode;
  readonly roots: readonly string[];
  readonly enabledChecks: readonly DriftCheckId[];
  readonly totalFindings: number;
  readonly chunkSize: number;
  readonly chunks: readonly DriftChunkManifestEntry[];
};

export type SkippedDriftCheck = {
  readonly check: DriftCheckId;
  readonly reason: string;
  readonly code?: SkipReasonCode;
};

export type CliOptions = {
  readonly scopeMode: ScopeMode;
  readonly base: string;
  readonly baseExplicit: boolean;
  readonly checks: readonly DriftCheckId[];
  readonly format: "text" | "json";
  readonly roots: readonly string[];
  readonly configPath?: string;
  readonly outputPath?: string;
  readonly chunkDir?: string;
  readonly chunkSize?: number;
  readonly jscpdBin?: string;
  // Explicit operator override for the knip config used by the orphan-files
  // adapter (config-authority ladder rung 1; adapter contract §2).
  readonly knipConfig?: string;
  // Explicit operator override for the tsconfig the import-cycles adapter resolves
  // the module graph against (config-authority ladder rung 1). Unset = per-file
  // nearest-tsconfig discovery (the monorepo default).
  readonly tsconfig?: string;
  readonly includeScope: boolean;
  // Opt-in: when true, a run that produces findings exits 1 instead of the
  // report-only default of 0. Usage/config errors still exit 2. Off by default so
  // the report-only contract (exit 0 regardless of findings) is preserved unless
  // a caller explicitly asks to gate on findings.
  readonly failOnFindings: boolean;
  // Opt-in runtime import-cycle floor (requires import-cycles among the selected
  // checks): exit 1 when any import-cycles finding is not labeled type-only, or
  // when the import-cycles check skipped — the gate fails closed rather than
  // certifying zero runtime cycles it never measured. Type-only SCCs stay
  // report-only evidence and never trip it.
  readonly failOnRuntimeCycles: boolean;
};

export const DEFAULT_BASE = "main";
export const DEFAULT_SCOPE_MODE: ScopeMode = "changed";
export const DEFAULT_CHUNK_SIZE = 75;
export const DEFAULT_IGNORE_EXTENSIONS: readonly string[] = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
  ".pdf",
  ".lock",
];

export const DEFAULT_IGNORE_FILES: readonly string[] = [
  "bun.lock",
  "package-lock.json",
  "yarn.lock",
];
