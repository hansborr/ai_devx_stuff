import { mergeUniqueLocationDetails, mergeUniqueLocations } from "./triage-report-locations.js";
import type {
  BuildState,
  MutableItem,
  TriageEvidence,
  TriageLocation,
} from "./triage-report-types.js";

type ReviewCandidate = Omit<MutableItem, "evidence"> & { readonly evidence: TriageEvidence };

export function addReviewItem(state: BuildState, key: string, candidate: ReviewCandidate): void {
  state.reviewRows += 1;
  const existing = state.items.get(key);
  if (existing !== undefined) {
    if (shouldReplaceTitle(existing, candidate)) existing.title = candidate.title;
    existing.evidence.push(candidate.evidence);
    mergeUniqueLocations(existing.locations, candidate.locations);
    mergeUniqueLocationDetails(existing.locationDetails, candidate.locationDetails);
    if (candidate.priority === "review-first") existing.priority = "review-first";
    return;
  }
  const locations: string[] = [];
  const locationDetails: TriageLocation[] = [];
  mergeUniqueLocations(locations, candidate.locations);
  mergeUniqueLocationDetails(locationDetails, candidate.locationDetails);
  state.items.set(key, {
    ...candidate,
    locations,
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
