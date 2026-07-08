// Three-way semantic merge for item-keyed baselines, generalized from the
// lint-ratchet baseline merge driver (scripts/lint-ratchet/baseline-merge.ts).
// The floor is a maximum, so a conflicting key resolves to the LOWER count
// (the stricter floor); a key present on only one side, or a lowered count,
// flags a post-merge truth-up so the merged baseline is regenerated against the
// real tree. Identity ledgers (count defaulted to 1) collapse this to: keep the
// keys present on both sides, and require truth-up whenever the two sides'
// key sets differ.

import {
  type BaselineEntry,
  type BaselineMetricSpec,
  entryCount,
  formatBaseline,
  parseBaseline,
  type ParseResult,
} from "./entry-baseline.js";

export interface MergeBaselineOptions {
  readonly baseText: string;
  readonly currentText: string;
  readonly otherText: string;
}

export interface MergeBaselineResult {
  readonly mergedText?: string;
  readonly failures: readonly string[];
  readonly postMergeTruthUpRequired: boolean;
}

interface TruthUpState {
  required: boolean;
}

interface MergeContext<Entry extends BaselineEntry> {
  readonly spec: BaselineMetricSpec<Entry>;
  readonly truthUp: TruthUpState;
  readonly failures: string[];
}

function entryMap<Entry extends BaselineEntry>(
  entries: readonly Entry[],
): ReadonlyMap<string, Entry> {
  return new Map(entries.map((entry) => [entry.key, entry]));
}

function sortedUnionKeys<Entry extends BaselineEntry>(
  left: ReadonlyMap<string, Entry>,
  right: ReadonlyMap<string, Entry>,
): readonly string[] {
  return [...new Set([...left.keys(), ...right.keys()])].sort((a, b) => a.localeCompare(b));
}

function mergeSharedEntry<Entry extends BaselineEntry>(
  context: MergeContext<Entry>,
  key: string,
  current: Entry,
  other: Entry,
): Entry | undefined {
  const currentCount = entryCount(current);
  const otherCount = entryCount(other);
  if (currentCount !== otherCount) {
    context.truthUp.required = true;
    return currentCount < otherCount ? current : other;
  }
  // Equal count: the non-count payload must agree, or the sides disagree on what
  // this key means and a human must regenerate.
  if (
    JSON.stringify(context.spec.formatEntry(current)) !==
    JSON.stringify(context.spec.formatEntry(other))
  ) {
    context.failures.push(`${key}: equal-count entries disagree; regenerate the baseline`);
    return undefined;
  }
  return current;
}

function mergeEntries<Entry extends BaselineEntry>(
  context: MergeContext<Entry>,
  current: readonly Entry[],
  other: readonly Entry[],
): Entry[] {
  const currentMap = entryMap(current);
  const otherMap = entryMap(other);
  const merged: Entry[] = [];
  for (const key of sortedUnionKeys(currentMap, otherMap)) {
    const currentEntry = currentMap.get(key);
    const otherEntry = otherMap.get(key);
    if (currentEntry === undefined || otherEntry === undefined) {
      // One side dropped or added this key: take the stricter (intersection)
      // floor and let the post-merge truth-up regenerate against the real tree.
      context.truthUp.required = true;
      continue;
    }
    const mergedEntry = mergeSharedEntry(context, key, currentEntry, otherEntry);
    if (mergedEntry !== undefined && entryCount(mergedEntry) > 0) merged.push(mergedEntry);
  }
  return merged;
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

export function mergeBaseline<Entry extends BaselineEntry>(
  spec: BaselineMetricSpec<Entry>,
  options: MergeBaselineOptions,
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

  // One side unchanged from the base: take the other verbatim, no truth-up.
  if (currentText === baseText) {
    return { mergedText: otherText, failures: [], postMergeTruthUpRequired: false };
  }
  if (otherText === baseText || currentText === otherText) {
    return { mergedText: currentText, failures: [], postMergeTruthUpRequired: false };
  }

  const failures: string[] = [];
  const truthUp: TruthUpState = { required: false };
  const merged = mergeEntries({ spec, truthUp, failures }, current, other);
  if (failures.length > 0) return { failures, postMergeTruthUpRequired: false };
  return {
    mergedText: formatBaseline(spec, merged),
    failures: [],
    postMergeTruthUpRequired: truthUp.required,
  };
}
