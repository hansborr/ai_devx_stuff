// Co-change coupling lens (brainstorm §1.3 flagship): files that change together
// far more often than chance, *especially across module boundaries* — the
// textbook "no individual dev sees this" signal an AI agent amplifies by editing
// the file in front of it plus the one call site it can see.
//
// Two MANDATORY, repo-agnostic legibility controls (OpenClaw-validated: raw
// co-change is ~65k pairs with an i18n locale clique that swamps the top-N):
//   1. min-support — a pair must co-change ≥ minSupport times (cuts the long tail);
//   2. per-node degree cap — any one file contributes at most `degreeCap` of its
//      top partners to the list, so one barrel/config/locale that pairs with
//      everything cannot drown it.
// These are STRUCTURAL controls, NOT generated-file classification (01 §3): they
// work the same on any repo and never name a file "ignorable"; the locale clique
// is *controlled* (capped), still visible, not filtered away.

import { buildCommitIntentOverlay } from "./commit-intent.js";
import {
  aggregateAuthors,
  pairKey,
  recentSubjects,
  shellQuoteArg,
} from "./hotspots-actionability.js";
import type { CouplingHotspot, CouplingSection } from "./hotspots-format.js";
import type { CollectedHistory, CommitRecord } from "./hotspots-history.js";

export const DEFAULT_MIN_SUPPORT = 3; // pairs co-changing fewer times are noise
export const DEFAULT_DEGREE_CAP = 5; // max distinct partners one file contributes to the top-N
export const DEFAULT_SWEEP_CAP = 40; // commits touching more files are sweeps, not coupling

export type ReduceCouplingOptions = {
  readonly top: number;
  readonly minSupport?: number;
  readonly degreeCap?: number;
  readonly sweepCap?: number;
};

type PairTally = { readonly a: string; readonly b: string; coOccur: number };

type CouplingCandidate = {
  readonly a: string;
  readonly b: string;
  readonly coChanges: number;
  readonly revisionsA: number;
  readonly revisionsB: number;
  readonly score: number;
  readonly crossBoundary: boolean;
};

export function reduceCoupling(
  history: CollectedHistory,
  options: ReduceCouplingOptions,
): CouplingSection {
  const minSupport = options.minSupport ?? DEFAULT_MIN_SUPPORT;
  const degreeCap = options.degreeCap ?? DEFAULT_DEGREE_CAP;
  const sweepCap = options.sweepCap ?? DEFAULT_SWEEP_CAP;

  const { pairs, coRevs } = tallyCoChange(history.records, sweepCap);
  const candidates = [...pairs.values()]
    .filter((pair) => pair.coOccur >= minSupport)
    .map((pair) => toCandidate(pair, coRevs))
    .sort(compareCandidates);
  const selected = capDegree(candidates, degreeCap, options.top);
  const entries = selected.map((candidate) => withContext(candidate, history.records, sweepCap));

  return {
    lens: "coupling",
    scoreModel: "symmetric",
    minSupport,
    degreeCap,
    sweepCap,
    emptyReason:
      entries.length === 0
        ? `no clear couplings this window (no pair co-changed at least ${minSupport} times).`
        : null,
    entries,
  };
}

// Walk commit file-sets. Only 2..sweepCap-file commits contribute: a single-file
// commit has no pairs, and a wide commit is a rename/format/lockfile sweep, not a
// logical coupling. `coRevs[f]` counts these contributing commits per file, so it
// is the natural denominator for the score (coOccur ≤ coRevs always). Paths are
// already filtered through isIgnoredPath by the collector.
function tallyCoChange(
  records: readonly CommitRecord[],
  sweepCap: number,
): { pairs: Map<string, PairTally>; coRevs: Map<string, number> } {
  const pairs = new Map<string, PairTally>();
  const coRevs = new Map<string, number>();
  for (const record of records) {
    const files = [...new Set(record.files.map((file) => file.path))].sort((left, right) =>
      left.localeCompare(right, "en"),
    );
    if (files.length < 2 || files.length > sweepCap) continue;
    for (const file of files) coRevs.set(file, (coRevs.get(file) ?? 0) + 1);
    for (let i = 0; i < files.length; i += 1) {
      for (let j = i + 1; j < files.length; j += 1) {
        bumpPair(pairs, files[i] ?? "", files[j] ?? "");
      }
    }
  }
  return { pairs, coRevs };
}

function bumpPair(pairs: Map<string, PairTally>, a: string, b: string): void {
  const key = pairKey(a, b);
  const existing = pairs.get(key);
  if (existing === undefined) {
    // a <= b already (files were sorted before pairing), so a,b is the sorted pair.
    pairs.set(key, { a, b, coOccur: 1 });
    return;
  }
  existing.coOccur += 1;
}

function toCandidate(pair: PairTally, coRevs: Map<string, number>): CouplingCandidate {
  const revisionsA = coRevs.get(pair.a) ?? pair.coOccur;
  const revisionsB = coRevs.get(pair.b) ?? pair.coOccur;
  return {
    a: pair.a,
    b: pair.b,
    coChanges: pair.coOccur,
    revisionsA,
    revisionsB,
    score: pair.coOccur / Math.min(revisionsA, revisionsB),
    crossBoundary: topSegment(pair.a) !== topSegment(pair.b),
  };
}

// Cross-boundary = the first path segment differs (e.g. `extensions/…` vs
// `src/…`). The first segment is the repo-agnostic notion of "module boundary"
// the task and the OpenClaw example use; deliberately NOT a package-depth
// heuristic, which would be an unportable drift:ai opinion about a foreign repo.
function topSegment(path: string): string {
  const slash = path.indexOf("/");
  return slash < 0 ? path : path.slice(0, slash);
}

// Cross-boundary pairs sort to the top unconditionally (the louder signal), then
// by score, then by raw co-change count, then by pair key for determinism.
function compareCandidates(left: CouplingCandidate, right: CouplingCandidate): number {
  if (left.crossBoundary !== right.crossBoundary) return left.crossBoundary ? -1 : 1;
  if (right.score !== left.score) return right.score - left.score;
  if (right.coChanges !== left.coChanges) return right.coChanges - left.coChanges;
  return pairKey(left.a, left.b).localeCompare(pairKey(right.a, right.b), "en");
}

// Greedy per-node degree cap over the ranked candidates: accept a pair only while
// neither member has reached `degreeCap` accepted partners, so each file keeps at
// most its top-ranked `degreeCap` partners and a clique cannot dominate.
function capDegree(
  candidates: readonly CouplingCandidate[],
  degreeCap: number,
  top: number,
): CouplingCandidate[] {
  const degree = new Map<string, number>();
  const selected: CouplingCandidate[] = [];
  for (const candidate of candidates) {
    if ((degree.get(candidate.a) ?? 0) >= degreeCap) continue;
    if ((degree.get(candidate.b) ?? 0) >= degreeCap) continue;
    selected.push(candidate);
    degree.set(candidate.a, (degree.get(candidate.a) ?? 0) + 1);
    degree.set(candidate.b, (degree.get(candidate.b) ?? 0) + 1);
    if (selected.length >= top) break;
  }
  return selected;
}

function withContext(
  candidate: CouplingCandidate,
  records: readonly CommitRecord[],
  sweepCap: number,
): CouplingHotspot {
  // Match the SAME commits that fed the co-change count: a wide sweep that touched
  // both paths was excluded from coOccur, so it must not appear as the pair's
  // authors/recent-subjects evidence either (keep score and context consistent).
  const touchesBoth = (record: CommitRecord): boolean => {
    const paths = new Set(record.files.map((file) => file.path));
    if (paths.size < 2 || paths.size > sweepCap) return false;
    return paths.has(candidate.a) && paths.has(candidate.b);
  };
  const subjects = recentSubjects(records, touchesBoth);
  return {
    ...candidate,
    authors: aggregateAuthors(records, touchesBoth),
    recentSubjects: subjects,
    commitIntent: buildCommitIntentOverlay(subjects),
    inspectCommand: `git log --oneline -- ${shellQuoteArg(candidate.a)} ${shellQuoteArg(candidate.b)}`,
    baseline: null,
  };
}
