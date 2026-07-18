import type { BaselineEntry, BaselineMetricSpec } from "./entry-baseline.js";
import type {
  GroupedBaseline,
  GroupedBaselineSpec,
  GroupedItemMergePolicy,
  GroupedParseResult,
  KeyedGroupedItem,
} from "./group-baseline.js";
import type { ItemMergeOutcome } from "./item-merge.js";

const SINGLE_GROUP_ID = "baseline";
export const SINGLE_GROUP_SCHEMA_VERSION = 2;

export interface SingleGroupMeta {
  readonly tool: string;
  readonly metric: string;
  readonly meta: Readonly<Record<string, string>>;
}

export interface SingleGroupMergePolicyOptions<Entry extends BaselineEntry> {
  readonly oneSidedEntryStrategy?: "intersection" | "base-aware";
  readonly preserveOneSidedAddition?: (entry: Entry) => boolean;
}

function entryCount(entry: BaselineEntry): number {
  return entry.count ?? 1;
}

function fixedMeta<Entry extends BaselineEntry>(spec: BaselineMetricSpec<Entry>): SingleGroupMeta {
  return { tool: spec.tool, metric: spec.metric, meta: spec.meta };
}

function checkHeader<Entry extends BaselineEntry>(
  spec: BaselineMetricSpec<Entry>,
  raw: Readonly<Record<string, unknown>>,
): string | undefined {
  if (raw["tool"] !== spec.tool) return `baseline tool must be '${spec.tool}'`;
  if (raw["metric"] !== spec.metric) return `baseline metric must be '${spec.metric}'`;
  for (const [key, expected] of Object.entries(spec.meta)) {
    if (raw[key] !== expected) return `baseline ${key} must be '${expected}'`;
  }
  return undefined;
}

function summaryWarning<Entry extends BaselineEntry>(
  spec: BaselineMetricSpec<Entry>,
  raw: Readonly<Record<string, unknown>>,
  items: readonly KeyedGroupedItem<Entry>[],
): string | undefined {
  const entries = items.map(({ item }) => item);
  const derivedSummary = JSON.stringify(spec.summarize(entries));
  const committedSummary = JSON.stringify(raw["summary"] ?? null);
  if (derivedSummary === committedSummary) return undefined;
  return `baseline summary does not match the entries; entries govern enforcement (derived ${derivedSummary}, committed ${committedSummary})`;
}

function parseGroupMeta<Entry extends BaselineEntry>(
  spec: BaselineMetricSpec<Entry>,
  raw: Readonly<Record<string, unknown>>,
  items: readonly KeyedGroupedItem<Entry>[],
): GroupedParseResult<SingleGroupMeta> {
  const headerError = checkHeader(spec, raw);
  if (headerError !== undefined) return { ok: false, error: headerError };
  const warning = summaryWarning(spec, raw, items);
  if (warning !== undefined) return { ok: true, value: fixedMeta(spec), warnings: [warning] };
  return { ok: true, value: fixedMeta(spec) };
}

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
    if (nonCountPayloadDiffers(spec, current, other)) {
      return {
        failure: `${key}: conflicting counts also disagree on non-count fields; reconcile the baseline by hand`,
      };
    }
    return { item: currentCount < otherCount ? current : other, truthUp: true };
  }
  if (JSON.stringify(spec.formatEntry(current)) !== JSON.stringify(spec.formatEntry(other))) {
    return { failure: `${key}: equal-count entries disagree; regenerate the baseline` };
  }
  return { item: current };
}

function mergeOneSidedEntry<Entry extends BaselineEntry>(
  spec: BaselineMetricSpec<Entry>,
  options: SingleGroupMergePolicyOptions<Entry>,
  presentEntry: Entry,
  baseEntry: Entry | undefined,
): ItemMergeOutcome<Entry> {
  if ((options.oneSidedEntryStrategy ?? "intersection") === "intersection") {
    if (baseEntry === undefined && options.preserveOneSidedAddition?.(presentEntry) === true) {
      return { item: presentEntry };
    }
    return { truthUp: true };
  }
  if (baseEntry === undefined) return { item: presentEntry };
  return {
    truthUp:
      JSON.stringify(spec.formatEntry(baseEntry)) !==
      JSON.stringify(spec.formatEntry(presentEntry)),
  };
}

function itemMergePolicy<Entry extends BaselineEntry>(
  spec: BaselineMetricSpec<Entry>,
  options: SingleGroupMergePolicyOptions<Entry>,
): GroupedItemMergePolicy<Entry> {
  return {
    mergeShared: (key, current, other) => mergeSharedEntry(spec, key, current, other),
    mergeOneSided: (_key, present, base) => mergeOneSidedEntry(spec, options, present, base),
  };
}

export function singleGroupSpec<Entry extends BaselineEntry>(
  spec: BaselineMetricSpec<Entry>,
  options: SingleGroupMergePolicyOptions<Entry> = {},
): GroupedBaselineSpec<SingleGroupMeta, Entry> {
  return {
    writeVersion: SINGLE_GROUP_SCHEMA_VERSION,
    acceptedReadVersions: [SINGLE_GROUP_SCHEMA_VERSION],
    rootKey: "entries",
    regenerate: spec.regenerate,
    conflictMarkerRemediation: spec.conflictMarkerRemediation,
    singleGroupId: SINGLE_GROUP_ID,
    compareGroupKeys: (left, right) => left.localeCompare(right),
    compareItemKeys: (left, right) => left.localeCompare(right),
    parseGroupMeta: (_groupId, raw, items) => parseGroupMeta(spec, raw, items),
    formatGroupMeta: (_groupId, meta, context) => ({
      tool: meta.tool,
      metric: meta.metric,
      ...meta.meta,
      ...(context.regenerate === undefined ? {} : { regenerate: context.regenerate }),
      summary: spec.summarize(context.items.map(({ item }) => item)),
    }),
    sameGroupMeta: (left, right) => JSON.stringify(left) === JSON.stringify(right),
    parseItem: (_groupId, _itemKey, raw) => {
      const parsed = spec.parseEntry(raw);
      if (!parsed.ok) return parsed;
      return { ok: true, value: { key: parsed.value.key, item: parsed.value } };
    },
    formatItem: (_groupId, _itemKey, entry) => spec.formatEntry(entry),
    itemCount: entryCount,
    itemMergePolicy: () => itemMergePolicy(spec, options),
  };
}

export function singleGroupBaseline<Entry extends BaselineEntry>(
  spec: BaselineMetricSpec<Entry>,
  entries: readonly Entry[],
  version: number,
): GroupedBaseline<SingleGroupMeta, Entry> {
  return {
    version,
    groups: new Map([
      [
        SINGLE_GROUP_ID,
        { meta: fixedMeta(spec), items: new Map(entries.map((entry) => [entry.key, entry])) },
      ],
    ]),
  };
}

export function singleGroupEntries<Entry extends BaselineEntry>(
  baseline: GroupedBaseline<SingleGroupMeta, Entry>,
): readonly Entry[] {
  return [...(baseline.groups.get(SINGLE_GROUP_ID)?.items.values() ?? [])];
}
