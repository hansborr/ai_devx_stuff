import type { ScopeMode } from "./scope.js";
import type {
  AdvisoryPrerequisiteInput,
  NamedTriageInput,
  SkippedDriftCheckInput,
} from "./triage-report-contracts.js";
import type { DriftCheckId } from "./types.js";
import type { FindingProvenance } from "./types.js";

type TriagePriority = "review-first" | "review";
export type TriageCategory = "maintenance" | "structure" | "clone" | "security";

export type TriageLocation = {
  readonly path: string;
  readonly startLine: number | null;
  readonly startCol: number | null;
  readonly endLine: number | null;
  readonly endCol: number | null;
};

export type TriageEvidence = {
  readonly inputPath: string;
  readonly source: string;
  readonly row: number;
  readonly detail?: string;
  readonly message?: string;
  readonly provenance?: FindingProvenance;
};

export type TriageItem = {
  readonly id: string;
  readonly priority: TriagePriority;
  readonly category: TriageCategory;
  readonly title: string;
  readonly locations: readonly string[];
  readonly locationDetails: readonly TriageLocation[];
  readonly evidence: readonly TriageEvidence[];
};

export type DeferredReason =
  | "short-clone-fragment"
  | "test-only-clone"
  | "test-only-constant"
  | "test-only-literal"
  | "test-only-security-example"
  | "test-only-structure"
  | "type-only-cycle"
  | "unranked-literal";

type TriageInputCompleteness = "complete" | "complete-with-inapplicable-checks" | "partial";

export type TriageInputSummary = {
  readonly path: string;
  readonly kind: NamedTriageInput["input"]["kind"];
  readonly scanProvenance?: {
    readonly gitHead: string | null;
    readonly gitDirty: boolean | null;
    readonly stateFingerprint?: string | null;
    readonly changedDuringScan?: boolean | null;
  };
  readonly displayedRows: number;
  readonly totalRows: number;
  readonly unshownRows: number;
  readonly partial: boolean;
  readonly completeness: TriageInputCompleteness;
  readonly unknownBeyondCaps: boolean;
  readonly scopeMode: ScopeMode | null;
  readonly roots: readonly string[] | null;
  readonly enabledChecks: readonly DriftCheckId[] | null;
  readonly unmetPrerequisites: readonly AdvisoryPrerequisiteInput[];
  readonly skippedChecks: readonly SkippedDriftCheckInput[];
  readonly inapplicableChecks: readonly SkippedDriftCheckInput[];
  readonly hitCaps: readonly { readonly label: string; readonly detail: string | null }[];
  readonly degradations: readonly string[];
};

type DeferredGroup = {
  readonly reason: DeferredReason;
  readonly count: number;
  readonly description: string;
};

export type TriagePolicy = {
  readonly includeLiterals: boolean;
  readonly includeTypeOnlyCycles: boolean;
  readonly minCloneFragment: number;
};

export type TriageReport = {
  readonly schemaVersion: 1;
  readonly kind: "drift-triage";
  readonly policy: TriagePolicy;
  readonly summary: {
    readonly inputRows: number;
    readonly reviewRows: number;
    readonly reviewItems: number;
    readonly deferredRows: number;
    readonly mergedRows: number;
    readonly unshownRows: number;
    readonly inputsWithUnknownTail: number;
  };
  readonly inputs: readonly TriageInputSummary[];
  readonly deferred: readonly DeferredGroup[];
  readonly items: readonly TriageItem[];
};

export type TriageOptions = {
  readonly includeLiterals?: boolean;
  readonly includeTypeOnlyCycles?: boolean;
  readonly minCloneFragment?: number;
};

export type MutableItem = {
  readonly id: string;
  priority: TriagePriority;
  readonly category: TriageCategory;
  title: string;
  readonly locations: string[];
  readonly locationDetails: TriageLocation[];
  readonly evidence: TriageEvidence[];
};

export type BuildState = {
  readonly items: Map<string, MutableItem>;
  readonly deferred: Map<DeferredReason, number>;
  reviewRows: number;
  deferredRows: number;
};
