// Three-way semantic merge facade for the flat baseline family. Whole-document
// fast paths remain here because near-duplicates deliberately truth-ups a
// one-sided textual change; the general group decision table and injected item
// policy run in the grouped kernel.

import {
  BASELINE_SCHEMA_VERSION,
  type BaselineEntry,
  type BaselineMetricSpec,
} from "./entry-baseline.js";
import {
  formatGroupedBaseline,
  type GroupedBaseline,
  type GroupedBaselineSpec,
  mergeGroupedBaseline,
  parseGroupedBaseline,
} from "./group-baseline.js";
import { singleGroupBaseline, type SingleGroupMeta, singleGroupSpec } from "./single-group-spec.js";

export interface MergeBaselineOptions<Entry extends BaselineEntry = BaselineEntry> {
  readonly baseText: string;
  readonly currentText: string;
  readonly otherText: string;
  readonly oneSidedEntryStrategy?: "intersection" | "base-aware";
  readonly preserveOneSidedAddition?: (entry: Entry) => boolean;
  readonly truthUpOnOneSidedFastPath?: boolean;
}

export interface MergeBaselineResult {
  readonly mergedText?: string;
  readonly failures: readonly string[];
  readonly postMergeTruthUpRequired: boolean;
}

interface ParseSideContext<Entry extends BaselineEntry> {
  readonly spec: BaselineMetricSpec<Entry>;
  readonly groupedSpec: GroupedBaselineSpec<SingleGroupMeta, Entry>;
  readonly failures: string[];
}

function parseSide<Entry extends BaselineEntry>(
  context: ParseSideContext<Entry>,
  label: string,
  text: string,
): GroupedBaseline<SingleGroupMeta, Entry> | undefined {
  if (text.trim() === "") {
    return singleGroupBaseline(context.spec, [], BASELINE_SCHEMA_VERSION);
  }
  const result = parseGroupedBaseline(context.groupedSpec, text);
  if (result.ok) return result.value;
  context.failures.push(`${label} ${result.error}`);
  return undefined;
}

function fastPathResult(mergedText: string, postMergeTruthUpRequired = false): MergeBaselineResult {
  return { mergedText, failures: [], postMergeTruthUpRequired };
}

export function mergeBaseline<Entry extends BaselineEntry>(
  spec: BaselineMetricSpec<Entry>,
  options: MergeBaselineOptions<Entry>,
): MergeBaselineResult {
  const groupedSpec = singleGroupSpec(spec, options);
  const parseFailures: string[] = [];
  const parseContext = { spec, groupedSpec, failures: parseFailures };
  const base = parseSide(parseContext, "base", options.baseText);
  const current = parseSide(parseContext, "current", options.currentText);
  const other = parseSide(parseContext, "other", options.otherText);
  if (base === undefined || current === undefined || other === undefined) {
    return { failures: parseFailures, postMergeTruthUpRequired: false };
  }

  const baseText = formatGroupedBaseline(groupedSpec, base);
  const currentText = formatGroupedBaseline(groupedSpec, current);
  const otherText = formatGroupedBaseline(groupedSpec, other);

  if (currentText === otherText) return fastPathResult(currentText);
  if (currentText === baseText) {
    return fastPathResult(otherText, options.truthUpOnOneSidedFastPath);
  }
  if (otherText === baseText) {
    return fastPathResult(currentText, options.truthUpOnOneSidedFastPath);
  }

  const merged = mergeGroupedBaseline(groupedSpec, { base, current, other });
  if (merged.failures.length > 0 || merged.baseline === undefined) {
    return { failures: merged.failures, postMergeTruthUpRequired: false };
  }
  return {
    mergedText: formatGroupedBaseline(groupedSpec, merged.baseline),
    failures: [],
    postMergeTruthUpRequired: merged.postMergeTruthUpRequired,
  };
}
