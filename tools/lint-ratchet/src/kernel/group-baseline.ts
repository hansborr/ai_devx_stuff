import { baselineConflictMarkerTripwire } from "./baseline-conflict-marker.js";
import { compareGroupedBaselineDocuments } from "./group-baseline-compare.js";
import { formatGroupedBaselineDocument } from "./group-baseline-format.js";
import { mergeGroupedBaselineDocuments } from "./group-baseline-operations.js";
import { parseGroupedBaselineDocument } from "./group-baseline-parse.js";
import type { ItemMergePolicy } from "./item-merge.js";

// `error` is always the first failure; `errors`, when present, carries the
// full accumulated set so structural callers can report every defect at once.
export type GroupedParseResult<T> =
  | { readonly ok: true; readonly value: T; readonly warnings?: readonly string[] }
  | { readonly ok: false; readonly error: string; readonly errors?: readonly string[] };

export interface BaselineConflictMarkerRemediation {
  readonly baselineFile: string;
  readonly installerCommand: string;
  readonly restoreOursCommand: string;
  readonly updateCommand: string;
  readonly reconcileEntries?: boolean;
}

export interface KeyedGroupedItem<Item> {
  readonly key: string;
  readonly item: Item;
}

export interface GroupedBaselineGroup<GroupMeta, Item> {
  readonly meta: GroupMeta;
  readonly items: ReadonlyMap<string, Item>;
}

export interface GroupedBaseline<GroupMeta, Item> {
  readonly version: number;
  readonly regenerate?: unknown;
  readonly groups: ReadonlyMap<string, GroupedBaselineGroup<GroupMeta, Item>>;
}

export type GroupedItemMergePolicy<Item> = Omit<ItemMergePolicy<Item>, "count">;

export interface GroupedBaselineSpec<GroupMeta, Item> {
  readonly writeVersion: number;
  readonly acceptedReadVersions: readonly number[];
  readonly rootKey: "tests" | "entries";
  readonly regenerate?: string;
  readonly preserveRegenerateOnFormat?: boolean;
  readonly conflictMarkerRemediation?: BaselineConflictMarkerRemediation;
  readonly singleGroupId?: string;
  readonly requireSortedKeysOnParse?: boolean;
  readonly compareGroupKeys: (left: string, right: string) => number;
  readonly compareItemKeys: (left: string, right: string) => number;
  readonly parseGroupMeta: (
    groupId: string,
    raw: Readonly<Record<string, unknown>>,
    items: readonly KeyedGroupedItem<Item>[],
  ) => GroupedParseResult<GroupMeta>;
  readonly formatGroupMeta: (
    groupId: string,
    meta: GroupMeta,
    context: {
      readonly items: readonly KeyedGroupedItem<Item>[];
      readonly regenerate?: string;
    },
  ) => Readonly<Record<string, unknown>>;
  readonly sameGroupMeta: (left: GroupMeta, right: GroupMeta) => boolean;
  readonly parseItem: (
    groupId: string,
    itemKey: string | undefined,
    raw: unknown,
  ) => GroupedParseResult<KeyedGroupedItem<Item>>;
  readonly formatItem: (groupId: string, itemKey: string, item: Item, meta: GroupMeta) => unknown;
  readonly itemCount: (item: Item) => number;
  readonly itemMergePolicy: (groupId: string, meta: GroupMeta) => GroupedItemMergePolicy<Item>;
}

export interface MergeGroupedBaselineInput<GroupMeta, Item> {
  readonly base: GroupedBaseline<GroupMeta, Item>;
  readonly current: GroupedBaseline<GroupMeta, Item>;
  readonly other: GroupedBaseline<GroupMeta, Item>;
}

export interface MergeGroupedBaselineResult<GroupMeta, Item> {
  readonly baseline?: GroupedBaseline<GroupMeta, Item>;
  readonly partialBaseline?: GroupedBaseline<GroupMeta, Item>;
  readonly failures: readonly string[];
  readonly postMergeTruthUpRequired: boolean;
}

export interface GroupedItemLocation {
  readonly groupId: string;
  readonly itemKey: string;
}

export interface ComparedGroupedItem<Item> extends GroupedItemLocation {
  readonly baselineItem?: Item;
  readonly currentItem?: Item;
}

export interface CompareGroupedBaselineResult<Item = never> {
  readonly status: "ok" | "regressed" | "improved";
  readonly addedGroups: readonly string[];
  readonly removedGroups: readonly string[];
  readonly metadataChanged: readonly string[];
  readonly added: readonly GroupedItemLocation[];
  readonly removed: readonly GroupedItemLocation[];
  readonly increased: readonly GroupedItemLocation[];
  readonly decreased: readonly GroupedItemLocation[];
  readonly comparedItems: readonly ComparedGroupedItem<Item>[];
}

export function conflictMarkerTripwire(
  text: string,
  remediation: BaselineConflictMarkerRemediation | undefined,
): string | undefined {
  return baselineConflictMarkerTripwire(text, remediation);
}

export function parseGroupedBaseline<GroupMeta, Item>(
  spec: GroupedBaselineSpec<GroupMeta, Item>,
  text: string,
): GroupedParseResult<GroupedBaseline<GroupMeta, Item>> {
  return parseGroupedBaselineDocument(spec, text);
}

export function formatGroupedBaseline<GroupMeta, Item>(
  spec: GroupedBaselineSpec<GroupMeta, Item>,
  baseline: GroupedBaseline<GroupMeta, Item>,
): string {
  return formatGroupedBaselineDocument(spec, baseline);
}

export function mergeGroupedBaseline<GroupMeta, Item>(
  spec: GroupedBaselineSpec<GroupMeta, Item>,
  input: MergeGroupedBaselineInput<GroupMeta, Item>,
): MergeGroupedBaselineResult<GroupMeta, Item> {
  return mergeGroupedBaselineDocuments(spec, input);
}

export function compareGroupedBaseline<GroupMeta, Item>(
  spec: GroupedBaselineSpec<GroupMeta, Item>,
  baseline: GroupedBaseline<GroupMeta, Item>,
  current: GroupedBaseline<GroupMeta, Item>,
): CompareGroupedBaselineResult<Item> {
  return compareGroupedBaselineDocuments(spec, baseline, current);
}
