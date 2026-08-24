// Shared per-row actionability context for hotspot lenses (brainstorm §1.8): a
// no-recommendation tool still drives action by co-locating the cheap context that
// makes the human's judgment fast — all free from the same `git log` the collector
// already ran. Authors/agents, the 3 most-recent commit subjects, and a copy-paste
// inspect command per row; plus `--baseline` delta tagging so the recurring pass
// shows what is *newly* hot rather than the same top-N every week.
//
// Evidence, not verdicts (01 §3): this surfaces inputs, never a recommendation.

import { buildCommitIntentOverlay } from "./commit-intent.js";
import type {
  HotspotAuthor,
  HotspotBaselineDelta,
  HotspotLens,
  HotspotRowContext,
  HotspotSection,
} from "./hotspots-format.js";
import type { CommitRecord } from "./hotspots-history.js";
import { rowKeyKindFor } from "./hotspots-lens-registry.js";

const DEFAULT_AUTHOR_LIMIT = 4;
const DEFAULT_SUBJECT_LIMIT = 3;

// Build the shared per-row actionability columns (authors / recent subjects /
// commit-intent overlay / inspect command, with `baseline` left null until
// `--baseline` tagging runs) for one hotspot or coldspot row. Every lens reduces
// to: pick the records that `touches`, derive the same overlay, attach a copy-paste
// `inspectCommand`. Only those two inputs differ per lens — churn/fragmentation/
// thrash/coldspot match a single path; suppression-churn adds a `-G'<pattern>'`
// to the command; coupling matches a path PAIR. Parameterizing both keeps this the
// single source of the overlay so a fix here reaches all of them at once.
export function buildRowActionability(
  records: readonly CommitRecord[],
  options: {
    readonly touches: (record: CommitRecord) => boolean;
    readonly inspectCommand: string;
  },
): HotspotRowContext {
  const subjects = recentSubjects(records, options.touches);
  return {
    authors: aggregateAuthors(records, options.touches),
    recentSubjects: subjects,
    commitIntent: buildCommitIntentOverlay(subjects),
    inspectCommand: options.inspectCommand,
    baseline: null,
  };
}

// The common case: a row keyed on a single `path`. `touches` matches any record
// changing that path and the inspect command is the plain `git log --oneline` for
// it. churn/fragmentation/thrash/coldspot all reduce to exactly this.
export function buildPathRowActionability(
  records: readonly CommitRecord[],
  path: string,
): HotspotRowContext {
  return buildRowActionability(records, {
    touches: (record) => record.files.some((file) => file.path === path),
    inspectCommand: `git log --oneline -- ${shellQuoteArg(path)}`,
  });
}

// Top authors + co-author/trailer hands across the records matching `touches`,
// most-active first. The committing author counts once per commit; each
// Co-authored-by trailer counts once too (this is how `claude×N` agent hands
// surface). Ties break on name for determinism.
export function aggregateAuthors(
  records: readonly CommitRecord[],
  touches: (record: CommitRecord) => boolean,
  limit: number = DEFAULT_AUTHOR_LIMIT,
): HotspotAuthor[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    if (!touches(record)) continue;
    bump(counts, record.authorName);
    for (const coAuthor of record.coAuthors) bump(counts, displayName(coAuthor));
  }
  return [...counts.entries()]
    .map(([name, commits]) => ({ name, commits }))
    .sort(
      (left, right) => right.commits - left.commits || left.name.localeCompare(right.name, "en"),
    )
    .slice(0, limit);
}

function bump(counts: Map<string, number>, name: string): void {
  const trimmed = name.trim();
  if (trimmed.length === 0) return;
  counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
}

// Co-author trailers are `Name <email>`; show just the name to match the bare
// committer name (git %an) so a hand is not double-counted under two spellings.
function displayName(coAuthor: string): string {
  const angle = coAuthor.indexOf("<");
  return angle < 0 ? coAuthor.trim() : coAuthor.slice(0, angle).trim();
}

// The N most-recent commit subjects among matching records. `git log` emits
// newest-first and the collector preserves that order, so we take the first N
// matches — no date parsing (iso-strict with offsets is not lexically sortable).
export function recentSubjects(
  records: readonly CommitRecord[],
  touches: (record: CommitRecord) => boolean,
  limit: number = DEFAULT_SUBJECT_LIMIT,
): string[] {
  const subjects: string[] = [];
  for (const record of records) {
    if (!touches(record)) continue;
    subjects.push(record.subject);
    if (subjects.length >= limit) break;
  }
  return subjects;
}

// Resolve subjects from indexes that are already ordered newest-first. Callers
// with an existing touch index avoid rescanning every record to rediscover the
// matching commits while retaining the shared subject limit.
export function subjectsAtIndexes(
  records: readonly CommitRecord[],
  orderedIndexes: Iterable<number>,
  limit: number = DEFAULT_SUBJECT_LIMIT,
): string[] {
  const subjects: string[] = [];
  for (const index of orderedIndexes) {
    const record = records[index];
    if (record === undefined) continue;
    subjects.push(record.subject);
    if (subjects.length >= limit) break;
  }
  return subjects;
}

// Quote a path for a copy-paste `git log` inspect command so spaces or shell
// metacharacters survive. Clean paths (the overwhelming common case) pass through
// unquoted; anything else is POSIX single-quoted with embedded quotes escaped.
export function shellQuoteArg(value: string): string {
  if (/^[\w./@+=-]+$/u.test(value)) return value;
  return `'${value.replace(/'/gu, `'\\''`)}'`;
}

// --- baseline delta ---------------------------------------------------------

// Index a prior advisory's sections by lens → row key → score, defensively (a
// hand-edited or older baseline may have an unexpected shape; missing rows simply
// read as NEW). Row keys come from the same `rowKey` the live path uses. The prior
// churn metric is captured separately because churn `score` means revisions OR
// lines depending on the run — comparing across metrics is meaningless.
type BaselineIndex = {
  readonly scores: Map<string, Map<string, number>>;
  readonly churnMetric: string | null;
};

function buildBaselineIndex(prior: unknown): BaselineIndex {
  const scores = new Map<string, Map<string, number>>();
  let churnMetric: string | null = null;
  const sections = asRecord(prior)?.["sections"];
  if (!Array.isArray(sections)) return { scores, churnMetric };
  for (const raw of sections) {
    const record = asRecord(raw);
    const lens = record?.["lens"];
    if (typeof lens !== "string") continue;
    scores.set(lens, indexEntries(lens, record?.["entries"]));
    const metric = record?.["metric"];
    if (lens === "churn" && typeof metric === "string") churnMetric = metric;
  }
  return { scores, churnMetric };
}

// A prior advisory is untrusted on-disk input, so narrow each level here, then
// read every field below off `unknown` with a typeof guard.
function asRecord(value: unknown): Record<string, unknown> | null {
  // type-assertion-boundary: json - parsed baseline JSON has no static shape; this is the only assertion and every field is re-guarded.
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function indexEntries(lens: string, rawEntries: unknown): Map<string, number> {
  const scores = new Map<string, number>();
  if (!Array.isArray(rawEntries)) return scores;
  for (const raw of rawEntries) {
    const entry = asRecord(raw);
    if (entry === null) continue;
    const key = rowKey(lens, entry);
    const score = entry["score"];
    // Number.isFinite (not just typeof) rejects a malformed baseline's Infinity/NaN
    // (e.g. `1e999` parses to Infinity), which would otherwise produce a non-finite
    // delta that JSON renders as `null`, violating the advisory type.
    if (key !== null && typeof score === "number" && Number.isFinite(score)) {
      scores.set(key, score);
    }
  }
  return scores;
}

// The single key-derivation for both untrusted baseline rows and typed live rows.
// `fields` reads the key-bearing fields off either source through a string index —
// a typed live entry supplies them structurally, an untrusted baseline record by its
// `Record<string, unknown>` shape. Live entries always carry the field, so the live
// path never actually sees null; a hand-edited baseline row missing the field (or a
// lens the registry does not know) returns null so it simply fails to match and
// reads NEW. Per-lens key semantics come from the registry's `rowKeyKind` — a
// required field of every lens definition — so registering a lens cannot leave its
// row identity behind (the old stringly set silently tagged omitted lenses NEW).
type RowKeyFields = Readonly<Record<string, unknown>>;

function rowKey(lens: string, fields: RowKeyFields): string | null {
  switch (rowKeyKindFor(lens)) {
    case "path": {
      const path = fields["path"];
      return typeof path === "string" ? path : null;
    }
    case "pair": {
      const a = fields["a"];
      const b = fields["b"];
      return typeof a === "string" && typeof b === "string" ? pairKey(a, b) : null;
    }
    case null:
      return null;
  }
}

export function pairKey(a: string, b: string): string {
  return a <= b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

function deltaFor(
  lensScores: Map<string, number> | undefined,
  key: string | null,
  score: number,
): HotspotBaselineDelta {
  const prior = key === null ? undefined : lensScores?.get(key);
  if (prior === undefined) return { status: "new", scoreDelta: 0 };
  const scoreDelta = round2(score - prior);
  if (scoreDelta > 0) return { status: "up", scoreDelta };
  if (scoreDelta < 0) return { status: "down", scoreDelta };
  return { status: "steady", scoreDelta: 0 };
}

// JSON scores (coupling) are fractional; keep delta arithmetic stable so a
// floating-point wobble does not read as up/down.
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// Tag every row in every section against a prior advisory. Pure: returns new
// sections with `baseline` filled, leaving the inputs untouched. A `note` is set
// when a churn section could not be tagged because the baseline measured churn
// with a different metric — so the caller can disclose the omission rather than
// fabricate a delta across incomparable units.
export function tagSectionsWithBaseline(
  sections: readonly HotspotSection[],
  prior: unknown,
): { sections: HotspotSection[]; note: string | null } {
  const index = buildBaselineIndex(prior);
  let note: string | null = null;
  const tagged = sections.map((section) => {
    if (
      section.lens === "churn" &&
      index.churnMetric !== null &&
      index.churnMetric !== section.metric
    ) {
      note = `baseline churn metric '${index.churnMetric}' differs from current '${section.metric}'; churn deltas omitted`;
      return section; // leave each row's baseline null — the scores are not comparable
    }
    return tagSection(section, index.scores);
  });
  return { sections: tagged, note };
}

// Fill `baseline` on every row of one section. The branches differ only in which
// concrete section type the result satisfies — TypeScript can't reunify a union of
// entry arrays back to a single section, so each lens pins its own type while the
// row work (key + delta) is shared in `taggedEntries`.
function tagSection(
  section: HotspotSection,
  scores: Map<string, Map<string, number>>,
): HotspotSection {
  switch (section.lens) {
    case "churn":
      return { ...section, entries: taggedEntries(section.lens, section.entries, scores) };
    case "coupling":
      return { ...section, entries: taggedEntries(section.lens, section.entries, scores) };
    case "fragmentation":
      return { ...section, entries: taggedEntries(section.lens, section.entries, scores) };
    case "suppression-churn":
      return { ...section, entries: taggedEntries(section.lens, section.entries, scores) };
    case "thrash":
      return { ...section, entries: taggedEntries(section.lens, section.entries, scores) };
  }
}

// Map a concretely-typed section's rows to the same rows with `baseline` filled.
// Generic over the entry type so the result keeps the section's own entry type (no
// union widening), and the row key flows through the shared `rowKey` — the single
// source of per-lens row identity, so the live and baseline paths can never drift.
function taggedEntries<E extends HotspotRowContext & { readonly score: number }>(
  lens: HotspotLens,
  entries: readonly E[],
  scores: Map<string, Map<string, number>>,
): E[] {
  const lensScores = scores.get(lens);
  return entries.map((entry) => ({
    ...entry,
    baseline: deltaFor(lensScores, rowKey(lens, entry), entry.score),
  }));
}
