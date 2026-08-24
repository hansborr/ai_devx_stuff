import type { PrototypeScanProvenance } from "../drift-ai/prototype-advisory.js";
import { isTriageTestAdjacentPath } from "../lib/path-taxonomy.js";
import { isRecord } from "../lib/records.js";
import type { TriageItemId } from "./triage-item-id.js";
import { locationPath, mergeUniqueLocationDetails, uniqueLocations } from "./triage-location.js";
import type { DriftFindingInput } from "./triage-report-contracts.js";
import type {
  BuildState,
  DeferredReason,
  MutableItem,
  TriageEvidence,
  TriageLocation,
  TriagePolicy,
} from "./triage-report-types.js";

export function parseArray<Value>(
  value: unknown,
  parseValue: (entry: unknown) => Value | null,
): Value[] | null {
  if (!Array.isArray(value)) return null;
  const parsed: Value[] = [];
  for (const entry of value) {
    const result = parseValue(entry);
    if (result === null) return null;
    parsed.push(result);
  }
  return parsed;
}

// Triage's deliberately broad *test-adjacent* policy (helpers, fixtures,
// test-support, examples — see scripts/lib/path-taxonomy.ts) applied after
// stripping display `:line:col` suffixes.
export function isTestLocation(location: string): boolean {
  const file = locationPath(location);
  return isTriageTestAdjacentPath(file);
}

type ReviewCandidate = Omit<MutableItem, "evidence"> & { readonly evidence: TriageEvidence };

export function addReviewItem(
  state: BuildState,
  key: TriageItemId,
  candidate: ReviewCandidate,
): void {
  state.reviewRows += 1;
  const existing = state.items.get(key);
  if (existing !== undefined) {
    if (shouldReplaceTitle(existing, candidate)) existing.title = candidate.title;
    existing.evidence.push(candidate.evidence);
    mergeUniqueLocationDetails(existing.locationDetails, candidate.locationDetails);
    if (candidate.priority === "review-first") existing.priority = "review-first";
    return;
  }
  const locationDetails: TriageLocation[] = [];
  mergeUniqueLocationDetails(locationDetails, candidate.locationDetails);
  state.items.set(key, {
    ...candidate,
    locationDetails,
    evidence: [candidate.evidence],
  });
}

function shouldReplaceTitle(existing: MutableItem, candidate: ReviewCandidate): boolean {
  const existingRank = Math.min(
    ...existing.evidence.map((evidence) => titleSourceRank(evidence.source)),
  );
  const candidateRank = titleSourceRank(candidate.evidence.source);
  if (candidateRank !== existingRank) return candidateRank < existingRank;
  return candidate.title.localeCompare(existing.title, "en") < 0;
}

function titleSourceRank(source: string): number {
  if (source.startsWith("drift:")) return 0;
  if (source === "semgrep") return 1;
  return 2;
}

export function parseOptionalScanProvenance(
  value: unknown,
): PrototypeScanProvenance | undefined | null {
  if (value === undefined) return undefined;
  if (
    !isRecord(value) ||
    !isNullableString(value["gitHead"]) ||
    !isNullableBoolean(value["gitDirty"])
  ) {
    return null;
  }
  const changedDuringScan = value["changedDuringScan"];
  if (changedDuringScan !== undefined && !isNullableBoolean(changedDuringScan)) return null;
  const stateFingerprint = value["stateFingerprint"];
  if (!isOptionalNullableString(stateFingerprint)) return null;
  return {
    gitHead: value["gitHead"],
    gitDirty: value["gitDirty"],
    ...(stateFingerprint === undefined ? {} : { stateFingerprint }),
    ...(changedDuringScan === undefined ? {} : { changedDuringScan }),
  };
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isOptionalNullableString(value: unknown): value is string | null | undefined {
  return value === undefined || isNullableString(value);
}

function isNullableBoolean(value: unknown): value is boolean | null {
  return value === null || typeof value === "boolean";
}

export const CLONE_CHECKS = new Set(["duplicates", "near-duplicates"]);

export const DEFERRED_DESCRIPTIONS: Record<DeferredReason, string> = {
  "short-clone-fragment": "Dolos' longest fragment is below the configured review floor.",
  "test-only-clone":
    "Both clone locations are test files, where repeated setup is often intentional.",
  "test-only-constant": "Every repeated constant location is in test code.",
  "test-only-literal": "Every repeated literal location is in test code.",
  "test-only-security-example":
    "The Semgrep match is in a test file, which commonly contains deliberate unsafe examples.",
  "test-only-structure":
    "Every duplicate type or schema location is in test code, where local fixture shapes are often intentional.",
  "type-only-cycle": "The import cycle is explicitly marked type-only and has no runtime edge.",
  "unranked-literal":
    "Repeated literals are high-volume, unadjudicated evidence; opt in only for a dedicated pass.",
};

export function driftDeferredReason(
  finding: DriftFindingInput,
  policy: TriagePolicy,
): DeferredReason | null {
  const locations = uniqueLocations([finding.file, ...(finding.relatedFiles ?? [])]);
  if (isTestOnlyClone(finding.check, locations)) return "test-only-clone";
  if (finding.check === "duplicate-literals") return literalDeferredReason(locations, policy);
  if (isDeferredTypeOnlyCycle(finding, policy)) return "type-only-cycle";
  if (finding.check === "duplicate-constants" && allTestLocations(locations)) {
    return "test-only-constant";
  }
  if (isTestOnlyStructure(finding.check, locations)) return "test-only-structure";
  return null;
}

function isTestOnlyClone(check: string, locations: readonly string[]): boolean {
  return CLONE_CHECKS.has(check) && locations.length >= 2 && allTestLocations(locations);
}

function literalDeferredReason(
  locations: readonly string[],
  policy: TriagePolicy,
): DeferredReason | null {
  if (allTestLocations(locations)) return "test-only-literal";
  return policy.includeLiterals ? null : "unranked-literal";
}

function isDeferredTypeOnlyCycle(finding: DriftFindingInput, policy: TriagePolicy): boolean {
  return (
    finding.check === "import-cycles" &&
    finding.details?.["typeOnly"] === true &&
    !policy.includeTypeOnlyCycles
  );
}

function isTestOnlyStructure(check: string, locations: readonly string[]): boolean {
  return (
    (check === "duplicate-types" || check === "duplicate-schemas") &&
    locations.length > 0 &&
    allTestLocations(locations)
  );
}

function allTestLocations(locations: readonly string[]): boolean {
  return locations.every(isTestLocation);
}
