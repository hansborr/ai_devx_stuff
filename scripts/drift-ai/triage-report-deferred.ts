import type { DriftFindingInput } from "./triage-report-contracts.js";
import { isTestLocation, mergeUniqueLocations } from "./triage-report-locations.js";
import type { DeferredReason, TriagePolicy } from "./triage-report-types.js";

const CLONE_CHECKS = new Set(["duplicates", "near-duplicates"]);

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
  const locations: string[] = [];
  mergeUniqueLocations(locations, [finding.file, ...(finding.relatedFiles ?? [])]);
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
