// Advisory-facing data shapes for the `semgrep-candidates` prototype
// subcommand (semgrep plan, slice 3), split from semgrep-advisory.ts the way
// birth-size-delta-types.ts is split from its advisory module so the builder
// and the formatter can share them without a cycle.

import type { PrototypeAdvisory, PrototypeSection } from "./prototype-advisory.js";
import type {
  RuleLicenseClass,
  RuleSourceDecision,
  SemgrepRuleSource,
} from "./semgrep-rule-sources.js";
import type { SemgrepRunnerResult } from "./semgrep-runner-types.js";
import type { SEMGREP_TOOL, SemgrepFindingMetadata } from "./semgrep-types.js";

export const SEMGREP_CANDIDATES_SUBCOMMAND = "semgrep-candidates";
export const DEFAULT_SEMGREP_CANDIDATES_TOP = 20;

export type SemgrepCandidateRange = {
  readonly startLine: number;
  readonly startCol: number | null;
  readonly endLine: number;
  readonly endCol: number | null;
};

// One (check_id, path) group (plan decision 4). `severity`/`metadata` are kept
// verbatim from Semgrep in JSON; only the TEXT renderer lowercases the
// rule-declared enums so the advisory surface stays free of shouty
// WARN/ERROR-style tokens. `message` is Semgrep's RENDERED message — matched
// metavariable values interpolated, so it can embed matched source text — and
// is null unless the operator passed `--include-rule-messages` (the section's
// `ruleMessages` field says which policy produced the null).
export type SemgrepAdvisoryRow = {
  readonly rank: number;
  readonly candidateSource: typeof SEMGREP_TOOL;
  readonly checkId: string;
  readonly path: string;
  readonly count: number;
  readonly ranges: readonly SemgrepCandidateRange[];
  readonly severity: string | null;
  readonly message: string | null;
  readonly metadata: SemgrepFindingMetadata;
};

// Rule-source provenance (plan decision 4). Hoisted to the SECTION rather than
// stamped per row: one scan has one rule-source set, so every row would carry
// identical provenance.
export type SemgrepRuleSourceProvenance = {
  readonly kind: SemgrepRuleSource["kind"];
  // Config path for local sources, pack name for registry packs.
  readonly source: string;
  readonly license: string | null;
  readonly licenseClass: RuleLicenseClass;
  readonly sourceUrl: string | null;
  readonly commit: string | null;
  readonly sha256: string | null;
  // Live registry packs and unpinned local sources are never reproducible.
  readonly reproducible: boolean;
};

// Target-side scan-scope shaping (plan slice 5 follow-up): Semgrep applies its
// own target filters on top of drift's current-scope roots and silently honors
// target-supplied `.semgrepignore` files. Disclosed as section DATA so a "no
// matches" run can never hide that files were skipped.
export type SemgrepScanScope = {
  // Semgrep applies its built-in target filters, including default
  // semgrepignore patterns and Gitignore/Semgrepignore handling.
  readonly semgrepTargetFilters: "default";
  // The target carries one or more .semgrepignore files, which Semgrep applies
  // on top of the drift ignore --exclude flags.
  readonly targetSemgrepignore: boolean;
};

export type SemgrepAdvisorySection = PrototypeSection<SemgrepAdvisoryRow> & {
  readonly engineVersion: string | null;
  readonly scannedCount: number | null;
  // Null when no completed scan backs the section (skipped, failed, timed out).
  readonly scanScope: SemgrepScanScope | null;
  // Message policy for this run's rows: rendered messages can embed matched
  // source via metavariable interpolation, so they are withheld unless the
  // operator passed --include-rule-messages. Disambiguates a null row message
  // ("withheld") from a rule that declared none ("included" + null).
  readonly ruleMessages: "withheld" | "included";
  readonly ruleSources: readonly SemgrepRuleSourceProvenance[];
};

export type SemgrepAdvisory = PrototypeAdvisory<SemgrepAdvisorySection>;

export type SemgrepAdvisoryInput = {
  // Gate decisions for every DECLARED source, in declaration order (slice 1).
  readonly ruleSources: readonly RuleSourceDecision[];
  // Runner result, or null when the command skipped the scan because no rule
  // source survived the gate.
  readonly run: SemgrepRunnerResult | null;
  // Whether the target repo carries its own .semgrepignore files (probed by the
  // command, which owns file IO). Semgrep honors those files silently, so a
  // completed scan must disclose it as a degradation and in `scanScope`.
  readonly targetHasSemgrepignore: boolean;
};

export type SemgrepAdvisoryOptions = {
  readonly top?: number;
  // `--include-rule-messages`: carry Semgrep's rendered rule messages on the
  // rows. Off by default — rendered messages interpolate matched metavariable
  // values, so they can embed matched source text (snippet policy, decision 5).
  readonly includeRuleMessages?: boolean;
};
