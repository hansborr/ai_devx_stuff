export const TRIAGE_VERDICTS = [
  "confirmed",
  "false-positive",
  "accepted-drift",
  "duplicate-of",
  "needs-human",
] as const;
export const TRIAGE_SEVERITIES = ["high", "medium", "low", "informational"] as const;
export const TRIAGE_CONFIDENCES = ["high", "medium", "low"] as const;

export type TriageVerdict = {
  readonly itemId: string;
  readonly verdict: (typeof TRIAGE_VERDICTS)[number];
  readonly severity: (typeof TRIAGE_SEVERITIES)[number];
  readonly confidence: (typeof TRIAGE_CONFIDENCES)[number];
  readonly rationale: string;
  readonly verifiedLocations: readonly string[];
  readonly recommendedAction: string | null;
  readonly canonicalItemId: string | null;
};

const TRIAGE_VERDICT_REQUIRED_FIELDS = [
  "itemId",
  "verdict",
  "severity",
  "confidence",
  "rationale",
  "verifiedLocations",
  "recommendedAction",
  "canonicalItemId",
] as const satisfies readonly (keyof TriageVerdict)[];

const TRIAGE_DUPLICATE_OF_REQUIREMENT = {
  verdict: "duplicate-of",
  requiredField: "canonicalItemId",
} as const satisfies {
  readonly verdict: TriageVerdict["verdict"];
  readonly requiredField: keyof TriageVerdict;
};

export const TRIAGE_VERDICT_CONTRACT = {
  verdicts: TRIAGE_VERDICTS,
  severities: TRIAGE_SEVERITIES,
  confidences: TRIAGE_CONFIDENCES,
  requiredFields: TRIAGE_VERDICT_REQUIRED_FIELDS,
  duplicateOfRequires: TRIAGE_DUPLICATE_OF_REQUIREMENT.requiredField,
} as const;

export type TriageVerdictContract = typeof TRIAGE_VERDICT_CONTRACT;

export type TriageVerdictFile = {
  readonly schemaVersion: 1;
  readonly kind: "drift-triage-verdicts";
  readonly packetId: string;
  readonly reviewer: string | null;
  readonly verdicts: readonly TriageVerdict[];
};

export type NamedTriageVerdictFile = {
  readonly path: string;
  readonly result: TriageVerdictFile;
};

export type PacketManifestInput = {
  readonly schemaVersion: 1;
  readonly kind: "drift-triage-packet-manifest";
  readonly provenance: {
    readonly gitHead: string | null;
    readonly gitDirty: boolean | null;
    readonly stateFingerprint?: string | null;
    readonly inputHashes: readonly { readonly path: string; readonly sha256: string }[];
  };
  readonly packets: readonly {
    readonly packetId: string;
    readonly itemIds: readonly string[];
  }[];
};

export type CollectedVerdict = TriageVerdict & {
  readonly packetId: string;
  readonly inputPath: string;
  readonly reviewer: string | null;
};

export type VerdictCollectionReport = {
  readonly schemaVersion: 1;
  readonly kind: "drift-triage-verdict-collection";
  readonly sourceState: {
    readonly manifestGitHead: string | null;
    readonly currentGitHead: string | null;
    readonly stale: boolean | null;
    readonly manifestDirty: boolean | null;
    readonly currentDirty: boolean | null;
  };
  readonly summary: {
    readonly assignedItems: number;
    readonly receivedVerdicts: number;
    readonly missingItems: number;
    readonly totalPackets: number;
    readonly completedPackets: number;
    readonly partialPackets: number;
    readonly unstartedPackets: number;
    readonly byVerdict: Readonly<Record<string, number>>;
    readonly bySeverity: Readonly<Record<string, number>>;
  };
  readonly missing: readonly { readonly packetId: string; readonly itemIds: readonly string[] }[];
  readonly verificationQueue: readonly {
    readonly itemId: string;
    readonly packetId: string;
    readonly reason: "confirmed-medium-or-high" | "needs-human";
  }[];
  readonly verdicts: readonly CollectedVerdict[];
};

export type CurrentSourceState = {
  readonly gitHead: string | null;
  readonly gitDirty: boolean | null;
};
