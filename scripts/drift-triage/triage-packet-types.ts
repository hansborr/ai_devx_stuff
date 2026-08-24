import type { TriageCategory, TriageItem, TriageReport } from "./triage-report-types.js";
import type { TriageVerdictContract } from "./triage-verdict-types.js";

export type TriagePacketFilters = {
  readonly priorities: readonly TriageItem["priority"][];
  readonly categories: readonly TriageCategory[];
  readonly sources: readonly string[];
  readonly pathPrefixes: readonly string[];
};

export type TriagePacketOptions = {
  readonly packetSize?: number;
  readonly filters?: Partial<TriagePacketFilters>;
  readonly readSourceFile?: (filePath: string) => string | null;
};

export type TriagePacketProvenance = {
  readonly gitHead: string | null;
  readonly gitDirty: boolean | null;
  readonly stateFingerprint?: string | null;
  readonly inputHashes: readonly { readonly path: string; readonly sha256: string }[];
};

export type TriagePacketLane = {
  readonly priority: TriageItem["priority"];
  readonly category: TriageCategory;
  readonly source: "semgrep" | "dolos" | "drift" | "mixed";
  readonly area: string;
};

export type TriagePacket = {
  readonly schemaVersion: 1;
  readonly kind: "drift-triage-packet";
  readonly packetId: string;
  readonly lane: TriagePacketLane;
  readonly splitPathComponent: boolean;
  readonly itemIds: readonly string[];
  readonly task: string;
  readonly verdictContract: TriageVerdictContract;
  readonly disclosures: Pick<TriageReport, "policy" | "summary" | "inputs" | "deferred"> & {
    readonly staleAdvisories: readonly StaleAdvisoryDisclosure[];
  };
  readonly items: readonly TriageItem[];
};

export type StaleAdvisoryDisclosure = {
  readonly inputPath: string;
  readonly itemIds: readonly string[];
  readonly scanProvenance?: Pick<TriagePacketProvenance, "gitHead" | "gitDirty"> & {
    readonly stateFingerprint?: string | null;
    readonly changedDuringScan?: boolean | null;
  };
  readonly reasons: readonly (
    | "missing-scan-provenance"
    | "provenance-unavailable"
    | "git-head-mismatch"
    | "dirty-state-mismatch"
    | "state-fingerprint-mismatch"
    | "repository-changed-during-scan"
    | "unresolvable-location"
  )[];
  readonly unresolvableLocations: readonly string[];
  readonly route: "needs-human-regenerate";
};

type TriagePacketManifestEntry = {
  readonly packetId: string;
  readonly file: string;
  readonly itemCount: number;
  readonly itemIds: readonly string[];
  readonly lane: TriagePacketLane;
  readonly splitPathComponent: boolean;
  readonly sha256: string;
};

type TriagePacketManifest = {
  readonly schemaVersion: 1;
  readonly kind: "drift-triage-packet-manifest";
  readonly triageSchemaVersion: TriageReport["schemaVersion"];
  readonly provenance: TriagePacketProvenance;
  readonly packetSize: number;
  readonly filters: TriagePacketFilters;
  readonly selection: {
    readonly totalItems: number;
    readonly selectedItems: number;
    readonly excludedItems: number;
    readonly exclusionCounts: Readonly<Record<string, number>>;
  };
  readonly packets: readonly TriagePacketManifestEntry[];
};

export type TriagePacketBundle = {
  readonly manifest: TriagePacketManifest;
  readonly packets: readonly TriagePacket[];
};

export type SelectedTriageItems = {
  readonly filters: TriagePacketFilters;
  readonly items: readonly TriageItem[];
  readonly selection: TriagePacketManifest["selection"];
};

export type PacketItemGroup = {
  readonly lane: TriagePacketLane;
  readonly items: readonly TriageItem[];
  readonly splitPathComponent: boolean;
};
