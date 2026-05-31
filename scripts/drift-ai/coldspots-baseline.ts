// `--baseline <prev.json>` delta tagging for coldspots, so a recurring run shows
// what is NEWLY cold rather than re-emitting the same list. Coldspot rows are
// path-keyed with a `score`, so this is a focused tagger rather than the hotspots
// `tagSectionsWithBaseline` (whose per-lens row keys are a fixed hotspots set). It
// reuses the same untrusted-baseline posture: a prior advisory is on-disk input, so
// every level is narrowed and re-guarded before use, and a missing/odd row reads NEW.

import type { ColdspotsSection } from "./coldspots-format.js";
import type { HotspotBaselineDelta } from "./hotspots-format.js";

export function tagColdspotSectionsWithBaseline(
  sections: readonly ColdspotsSection[],
  prior: unknown,
): ColdspotsSection[] {
  const index = buildColdspotBaselineIndex(prior);
  // Branch by lens so each result keeps its own concrete section type — TypeScript
  // can't reunify a union of differently-typed entry arrays back to one section, so
  // each lens pins its own type while the row work (path key + delta) is shared in
  // `taggedEntries`. Every coldspots row is path-keyed with a `score`, so the shared
  // helper covers both lenses.
  return sections.map((section): ColdspotsSection => {
    const scores = index.get(section.lens);
    if (section.lens === "stale-markers") {
      return { ...section, entries: taggedEntries(section.entries, scores) };
    }
    return { ...section, entries: taggedEntries(section.entries, scores) };
  });
}

// Fill `baseline` on every path-keyed, scored row. Generic over the entry type so
// the result keeps the section's own entry type (no union widening).
function taggedEntries<E extends { readonly path: string; readonly score: number }>(
  entries: readonly E[],
  scores: Map<string, number> | undefined,
): E[] {
  return entries.map((entry) => ({
    ...entry,
    baseline: deltaFor(scores, entry.path, entry.score),
  }));
}

// lens → path → prior score, built defensively off untrusted JSON.
function buildColdspotBaselineIndex(prior: unknown): Map<string, Map<string, number>> {
  const byLens = new Map<string, Map<string, number>>();
  const sections = asRecord(prior)?.["sections"];
  if (!Array.isArray(sections)) return byLens;
  for (const raw of sections) {
    const record = asRecord(raw);
    const lens = record?.["lens"];
    if (typeof lens !== "string") continue;
    byLens.set(lens, indexEntries(record?.["entries"]));
  }
  return byLens;
}

function indexEntries(rawEntries: unknown): Map<string, number> {
  const scores = new Map<string, number>();
  if (!Array.isArray(rawEntries)) return scores;
  for (const raw of rawEntries) {
    const entry = asRecord(raw);
    if (entry === null) continue;
    const path = entry["path"];
    const score = entry["score"];
    // Number.isFinite (not just typeof) rejects a malformed baseline's Infinity/NaN
    // that JSON would render as `null`, which would violate the advisory type.
    if (typeof path === "string" && typeof score === "number" && Number.isFinite(score)) {
      scores.set(path, score);
    }
  }
  return scores;
}

function deltaFor(
  lensScores: Map<string, number> | undefined,
  path: string,
  score: number,
): HotspotBaselineDelta {
  const prior = lensScores?.get(path);
  if (prior === undefined) return { status: "new", scoreDelta: 0 };
  const scoreDelta = score - prior;
  if (scoreDelta > 0) return { status: "up", scoreDelta };
  if (scoreDelta < 0) return { status: "down", scoreDelta };
  return { status: "steady", scoreDelta: 0 };
}

// A prior advisory is untrusted on-disk input, so narrow each level here, then read
// every field off `unknown` with a typeof guard.
function asRecord(value: unknown): Record<string, unknown> | null {
  // type-assertion-boundary: json - parsed baseline JSON has no static shape; this is the only assertion and every field is re-guarded.
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}
