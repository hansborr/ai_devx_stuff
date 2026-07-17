// Three-way semantic merge for item-keyed baselines, generalized from the
// lint-ratchet baseline merge driver (scripts/lint-ratchet/baseline-merge.ts).
// The floor is a maximum, so a conflicting key resolves to the LOWER count
// (the stricter floor). By default, a key present on only one side is dropped
// and flags a post-merge truth-up. Configuration ledgers may opt into base-aware
// one-sided handling, which preserves additions while removals still win.
// Identity ledgers (count defaulted to 1) use the default intersection behavior.

import {
  type BaselineEntry,
  type BaselineMetricSpec,
  entryCount,
  formatBaseline,
  parseBaseline,
  type ParseResult,
} from "./entry-baseline.js";
import { type ItemMergeOutcome, type ItemMergePolicy, mergeItemMaps } from "./item-merge.js";

export interface MergeBaselineOptions<Entry extends BaselineEntry = BaselineEntry> {
  readonly baseText: string;
  readonly currentText: string;
  readonly otherText: string;
  readonly oneSidedEntryStrategy?: "intersection" | "base-aware";
  // Identity floors can preserve a narrowly reviewed one-sided addition while
  // retaining intersection semantics for every unreviewed addition and drain.
  readonly preserveOneSidedAddition?: (entry: Entry) => boolean;
  readonly truthUpOnOneSidedFastPath?: boolean;
}

export interface MergeBaselineResult {
  readonly mergedText?: string;
  readonly failures: readonly string[];
  readonly postMergeTruthUpRequired: boolean;
}

function entryMap<Entry extends BaselineEntry>(
  entries: readonly Entry[],
): ReadonlyMap<string, Entry> {
  return new Map(entries.map((entry) => [entry.key, entry]));
}

// Compare two entries ignoring their count: normalize both to the same count and
// diff the spec's formatted payload. A cap-style entry can carry non-count policy
// fields (max-lines severity/reason/lifecycle/ratchetExcluded) that feed
// enforcement, so a differing count must not silently discard the other side's
// edits to those fields.
function nonCountPayloadDiffers<Entry extends BaselineEntry>(
  spec: BaselineMetricSpec<Entry>,
  current: Entry,
  other: Entry,
): boolean {
  const normalize = (entry: Entry): string =>
    JSON.stringify(spec.formatEntry({ ...entry, count: 0 }));
  return normalize(current) !== normalize(other);
}

function mergeSharedEntry<Entry extends BaselineEntry>(
  spec: BaselineMetricSpec<Entry>,
  key: string,
  current: Entry,
  other: Entry,
): ItemMergeOutcome<Entry> {
  const currentCount = entryCount(current);
  const otherCount = entryCount(other);
  if (currentCount !== otherCount) {
    // The lower count is the stricter floor, but only take it when nothing else
    // diverged. If the sides also disagree on a non-count field, taking one
    // entry whole would silently drop the other's policy edits, so fail the
    // merge and let the driver fall back to the manual reconcile recipe.
    if (nonCountPayloadDiffers(spec, current, other)) {
      return {
        failure: `${key}: conflicting counts also disagree on non-count fields; reconcile the baseline by hand`,
      };
    }
    return { item: currentCount < otherCount ? current : other, truthUp: true };
  }
  // Equal count: the non-count payload must agree, or the sides disagree on what
  // this key means and a human must regenerate.
  if (JSON.stringify(spec.formatEntry(current)) !== JSON.stringify(spec.formatEntry(other))) {
    return { failure: `${key}: equal-count entries disagree; regenerate the baseline` };
  }
  return { item: current };
}

function mergeOneSidedEntry<Entry extends BaselineEntry>(
  spec: BaselineMetricSpec<Entry>,
  options: MergeBaselineOptions<Entry>,
  presentEntry: Entry,
  baseEntry: Entry | undefined,
): ItemMergeOutcome<Entry> {
  if ((options.oneSidedEntryStrategy ?? "intersection") === "intersection") {
    if (baseEntry === undefined && options.preserveOneSidedAddition?.(presentEntry) === true) {
      return { item: presentEntry };
    }
    // One side dropped or added this key: take the stricter (intersection)
    // floor and let the post-merge truth-up regenerate against the real tree.
    return { truthUp: true };
  }

  if (baseEntry === undefined) {
    // Configuration entry added on one side: preserve it. Unlike a floor
    // regression, its absence from the other side means that side simply
    // predates the addition.
    return { item: presentEntry };
  }
  // A removal wins over an unchanged peer. If the peer also changed the entry,
  // truth-up must decide whether the retired configuration is still needed in
  // the merged tree.
  return {
    truthUp:
      JSON.stringify(spec.formatEntry(baseEntry)) !==
      JSON.stringify(spec.formatEntry(presentEntry)),
  };
}

function entryMergePolicy<Entry extends BaselineEntry>(
  spec: BaselineMetricSpec<Entry>,
  options: MergeBaselineOptions<Entry>,
): ItemMergePolicy<Entry> {
  return {
    count: (entry) => entryCount(entry),
    mergeShared: (key, current, other) => mergeSharedEntry(spec, key, current, other),
    mergeOneSided: (_key, present, base) => mergeOneSidedEntry(spec, options, present, base),
  };
}

function parseSide<Entry extends BaselineEntry>(
  spec: BaselineMetricSpec<Entry>,
  label: string,
  text: string,
  failures: string[],
): readonly Entry[] | undefined {
  if (text.trim() === "") return [];
  const result: ParseResult<{ readonly entries: readonly Entry[] }> = parseBaseline(spec, text);
  if (result.ok) return result.value.entries;
  failures.push(`${label} ${result.error}`);
  return undefined;
}

function fastPathResult(mergedText: string, postMergeTruthUpRequired = false): MergeBaselineResult {
  return { mergedText, failures: [], postMergeTruthUpRequired };
}

export function mergeBaseline<Entry extends BaselineEntry>(
  spec: BaselineMetricSpec<Entry>,
  options: MergeBaselineOptions<Entry>,
): MergeBaselineResult {
  const parseFailures: string[] = [];
  const base = parseSide(spec, "base", options.baseText, parseFailures);
  const current = parseSide(spec, "current", options.currentText, parseFailures);
  const other = parseSide(spec, "other", options.otherText, parseFailures);
  if (base === undefined || current === undefined || other === undefined) {
    return { failures: parseFailures, postMergeTruthUpRequired: false };
  }

  const baseText = formatBaseline(spec, base);
  const currentText = formatBaseline(spec, current);
  const otherText = formatBaseline(spec, other);

  // Identical sides are already reconciled. When exactly one side changed,
  // take it verbatim. Tree-derived ledgers may request truth-up because source
  // conflict resolution can retain debt that the changed baseline drained.
  if (currentText === otherText) {
    return fastPathResult(currentText);
  }
  if (currentText === baseText) {
    return fastPathResult(otherText, options.truthUpOnOneSidedFastPath);
  }
  if (otherText === baseText) {
    return fastPathResult(currentText, options.truthUpOnOneSidedFastPath);
  }

  const result = mergeItemMaps(entryMergePolicy(spec, options), {
    base: entryMap(base),
    current: entryMap(current),
    other: entryMap(other),
    compareKeys: (left, right) => left.localeCompare(right),
  });
  if (result.failures.length > 0) {
    return { failures: result.failures, postMergeTruthUpRequired: false };
  }
  return {
    mergedText: formatBaseline(
      spec,
      result.merged.map((entry) => entry.item),
    ),
    failures: [],
    postMergeTruthUpRequired: result.truthUpRequired,
  };
}
