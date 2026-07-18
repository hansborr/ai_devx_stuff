import type {
  GroupedBaseline,
  GroupedBaselineGroup,
  GroupedBaselineSpec,
  KeyedGroupedItem,
} from "./group-baseline.js";

const JSON_INDENT_SPACES = 2;

function sortedGroupedItems<GroupMeta, Item>(
  spec: GroupedBaselineSpec<GroupMeta, Item>,
  group: GroupedBaselineGroup<GroupMeta, Item>,
): KeyedGroupedItem<Item>[] {
  return [...group.items.entries()]
    .sort(([left], [right]) => spec.compareItemKeys(left, right))
    .map(([key, item]) => ({ key, item }));
}

export function formattedGroupedTest<GroupMeta, Item>(
  spec: GroupedBaselineSpec<GroupMeta, Item>,
  groupId: string,
  group: GroupedBaselineGroup<GroupMeta, Item>,
): Readonly<Record<string, unknown>> {
  const items = sortedGroupedItems(spec, group);
  return {
    ...spec.formatGroupMeta(groupId, group.meta, { items }),
    items: Object.fromEntries(
      items.map(({ key, item }) => [key, spec.formatItem(groupId, key, item, group.meta)]),
    ),
  };
}

function formatTestsDocument<GroupMeta, Item>(
  spec: GroupedBaselineSpec<GroupMeta, Item>,
  baseline: GroupedBaseline<GroupMeta, Item>,
): Readonly<Record<string, unknown>> {
  const groups = [...baseline.groups.entries()].sort(([left], [right]) =>
    spec.compareGroupKeys(left, right),
  );
  const regenerate =
    spec.preserveRegenerateOnFormat === true ? baseline.regenerate : spec.regenerate;
  return {
    version: baseline.version,
    ...(regenerate === undefined ? {} : { regenerate }),
    tests: Object.fromEntries(
      groups.map(([groupId, group]) => [groupId, formattedGroupedTest(spec, groupId, group)]),
    ),
  };
}

function formatEntriesDocument<GroupMeta, Item>(
  spec: GroupedBaselineSpec<GroupMeta, Item>,
  baseline: GroupedBaseline<GroupMeta, Item>,
): Readonly<Record<string, unknown>> {
  const groupId = spec.singleGroupId;
  if (groupId === undefined) throw new Error("entries-family codec requires a singleGroupId");
  const group = baseline.groups.get(groupId);
  if (group === undefined) throw new Error(`entries-family baseline requires group '${groupId}'`);
  const items = sortedGroupedItems(spec, group);
  return {
    version: baseline.version,
    ...spec.formatGroupMeta(groupId, group.meta, { items, regenerate: spec.regenerate }),
    entries: items.map(({ key, item }) => spec.formatItem(groupId, key, item, group.meta)),
  };
}

export function formatGroupedBaselineDocument<GroupMeta, Item>(
  spec: GroupedBaselineSpec<GroupMeta, Item>,
  baseline: GroupedBaseline<GroupMeta, Item>,
): string {
  const document =
    spec.rootKey === "tests"
      ? formatTestsDocument(spec, baseline)
      : formatEntriesDocument(spec, baseline);
  return `${JSON.stringify(document, null, JSON_INDENT_SPACES)}\n`;
}
