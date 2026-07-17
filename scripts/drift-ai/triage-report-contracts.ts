import type { PrototypeScanProvenance } from "./prototype-advisory.js";
import type { ScopeMode } from "./scope.js";
import type { DRIFT_SCHEMA_VERSION } from "./types.js";
import type { DriftCheckId } from "./types.js";
import type { FindingProvenance } from "./types.js";

export type DriftFindingInput = {
  readonly check: string;
  readonly file: string;
  readonly message: string;
  readonly hint?: string;
  readonly relatedFiles?: readonly string[];
  readonly details?: Readonly<Record<string, unknown>>;
  readonly provenance?: FindingProvenance;
};

export type SkippedDriftCheckInput = {
  readonly check: string;
  readonly reason: string;
  readonly code?: string;
};

export type DriftReportInput = {
  readonly schemaVersion: typeof DRIFT_SCHEMA_VERSION;
  readonly scopeMode: ScopeMode | null;
  readonly roots: readonly string[] | null;
  readonly enabledChecks: readonly DriftCheckId[] | null;
  readonly skippedChecks: readonly SkippedDriftCheckInput[];
  readonly findings: readonly DriftFindingInput[];
};

export type AdvisoryCapInput = {
  readonly label: string;
  readonly limit: number;
  readonly hit: boolean;
  readonly detail: string | null;
};

export type AdvisoryPrerequisiteInput = {
  readonly name: string;
  readonly satisfied: boolean;
  readonly detail: string;
};

export type SemgrepRowInput = {
  readonly rank: number;
  readonly candidateSource: "semgrep";
  readonly checkId: string;
  readonly path: string;
  readonly count: number;
  readonly ranges: readonly {
    readonly startLine: number;
    readonly startCol: number | null;
    readonly endLine: number;
    readonly endCol: number | null;
  }[];
  readonly severity: string | null;
  readonly message: string | null;
  readonly metadata: {
    readonly cwe?: readonly string[];
    readonly confidence?: string | null;
  };
};

export type DolosFileRangeInput = {
  readonly filePath: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly lineCount: number;
};

export type DolosRowInput = {
  readonly rank: number;
  readonly candidateSource: "dolos";
  readonly score: number;
  readonly left: DolosFileRangeInput;
  readonly right: DolosFileRangeInput;
  readonly metrics: {
    readonly similarity: number;
    readonly totalOverlap: number;
    readonly longestFragment: number;
  };
};

export type AdvisorySectionInput<Row> = {
  readonly totalCandidates: number;
  readonly entries: readonly Row[];
};

export type AdvisoryInput<Subcommand extends string, Row> = {
  readonly kind: "advisory";
  readonly lane: "prototype";
  readonly subcommand: Subcommand;
  readonly scanProvenance?: PrototypeScanProvenance;
  readonly prerequisites: readonly AdvisoryPrerequisiteInput[];
  readonly degradations: readonly string[];
  readonly caps: readonly AdvisoryCapInput[];
  readonly sections: readonly AdvisorySectionInput<Row>[];
};

export type SemgrepAdvisoryInput = AdvisoryInput<"semgrep-candidates", SemgrepRowInput>;
export type DolosAdvisoryInput = AdvisoryInput<"dolos-candidates", DolosRowInput>;

export type TriageInput =
  | { readonly kind: "drift-report"; readonly report: DriftReportInput }
  | { readonly kind: "semgrep-advisory"; readonly report: SemgrepAdvisoryInput }
  | { readonly kind: "dolos-advisory"; readonly report: DolosAdvisoryInput };

export type NamedTriageInput = {
  readonly path: string;
  readonly input: TriageInput;
};
