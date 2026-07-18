import type {
  ComparedGroupedItem,
  CompareGroupedBaselineResult,
  GroupedBaseline,
  GroupedBaselineGroup,
  GroupedBaselineSpec,
  GroupedItemLocation,
} from "./group-baseline.js";

interface ComparisonChanges<Item> {
  readonly metadataChanged: string[];
  readonly added: GroupedItemLocation[];
  readonly removed: GroupedItemLocation[];
  readonly increased: GroupedItemLocation[];
  readonly decreased: GroupedItemLocation[];
  readonly comparedItems: ComparedGroupedItem<Item>[];
}

interface ItemMovement<Item> extends GroupedItemLocation {
  readonly baselineItem: Item | undefined;
  readonly currentItem: Item | undefined;
}

interface ComparedGroup<GroupMeta, Item> {
  readonly groupId: string;
  readonly baseline: GroupedBaselineGroup<GroupMeta, Item> | undefined;
  readonly current: GroupedBaselineGroup<GroupMeta, Item> | undefined;
}

function itemLocation<Item>(movement: ItemMovement<Item>): GroupedItemLocation {
  return { groupId: movement.groupId, itemKey: movement.itemKey };
}

function comparedItem<Item>(movement: ItemMovement<Item>): ComparedGroupedItem<Item> {
  return {
    ...itemLocation(movement),
    ...(movement.baselineItem === undefined ? {} : { baselineItem: movement.baselineItem }),
    ...(movement.currentItem === undefined ? {} : { currentItem: movement.currentItem }),
  };
}

function recordItemMovement<Item>(
  spec: Pick<GroupedBaselineSpec<unknown, Item>, "itemCount">,
  changes: ComparisonChanges<Item>,
  movement: ItemMovement<Item>,
): void {
  changes.comparedItems.push(comparedItem(movement));
  if (movement.baselineItem === undefined && movement.currentItem !== undefined) {
    changes.added.push(itemLocation(movement));
  } else if (movement.baselineItem !== undefined && movement.currentItem === undefined) {
    changes.removed.push(itemLocation(movement));
  } else if (movement.baselineItem !== undefined && movement.currentItem !== undefined) {
    const countMovement =
      spec.itemCount(movement.currentItem) - spec.itemCount(movement.baselineItem);
    if (countMovement > 0) {
      changes.increased.push(itemLocation(movement));
    } else if (countMovement < 0) {
      changes.decreased.push(itemLocation(movement));
    }
  }
}

function recordMetadataChange<GroupMeta, Item>(
  spec: Pick<GroupedBaselineSpec<GroupMeta, Item>, "sameGroupMeta">,
  group: ComparedGroup<GroupMeta, Item>,
  changes: ComparisonChanges<Item>,
): void {
  if (group.baseline === undefined || group.current === undefined) return;
  if (!spec.sameGroupMeta(group.baseline.meta, group.current.meta)) {
    changes.metadataChanged.push(group.groupId);
  }
}

function compareGroupItems<GroupMeta, Item>(
  spec: GroupedBaselineSpec<GroupMeta, Item>,
  group: ComparedGroup<GroupMeta, Item>,
  changes: ComparisonChanges<Item>,
): void {
  recordMetadataChange(spec, group, changes);
  const itemKeys = [
    ...new Set([...(group.baseline?.items.keys() ?? []), ...(group.current?.items.keys() ?? [])]),
  ].sort(spec.compareItemKeys);
  for (const itemKey of itemKeys) {
    recordItemMovement(spec, changes, {
      groupId: group.groupId,
      itemKey,
      baselineItem: group.baseline?.items.get(itemKey),
      currentItem: group.current?.items.get(itemKey),
    });
  }
}

function sortedLocations<GroupMeta, Item>(
  spec: GroupedBaselineSpec<GroupMeta, Item>,
  locations: readonly GroupedItemLocation[],
): GroupedItemLocation[] {
  return [...locations].sort((left, right) => {
    const groupOrder = spec.compareGroupKeys(left.groupId, right.groupId);
    return groupOrder === 0 ? spec.compareItemKeys(left.itemKey, right.itemKey) : groupOrder;
  });
}

function comparisonStatus<Item>(
  result: Omit<CompareGroupedBaselineResult<Item>, "status">,
): CompareGroupedBaselineResult<Item>["status"] {
  if (
    result.addedGroups.length > 0 ||
    result.metadataChanged.length > 0 ||
    result.added.length > 0 ||
    result.increased.length > 0
  ) {
    return "regressed";
  }
  if (result.removedGroups.length > 0 || result.removed.length > 0 || result.decreased.length > 0) {
    return "improved";
  }
  return "ok";
}

export function compareGroupedBaselineDocuments<GroupMeta, Item>(
  spec: GroupedBaselineSpec<GroupMeta, Item>,
  baseline: GroupedBaseline<GroupMeta, Item>,
  current: GroupedBaseline<GroupMeta, Item>,
): CompareGroupedBaselineResult<Item> {
  const changes: ComparisonChanges<Item> = {
    metadataChanged: [],
    added: [],
    removed: [],
    increased: [],
    decreased: [],
    comparedItems: [],
  };
  const groupIds = [...new Set([...baseline.groups.keys(), ...current.groups.keys()])].sort(
    spec.compareGroupKeys,
  );
  for (const groupId of groupIds) {
    compareGroupItems(
      spec,
      {
        groupId,
        baseline: baseline.groups.get(groupId),
        current: current.groups.get(groupId),
      },
      changes,
    );
  }
  const result = {
    addedGroups: [...current.groups.keys()]
      .filter((key) => !baseline.groups.has(key))
      .sort(spec.compareGroupKeys),
    removedGroups: [...baseline.groups.keys()]
      .filter((key) => !current.groups.has(key))
      .sort(spec.compareGroupKeys),
    metadataChanged: changes.metadataChanged.sort(spec.compareGroupKeys),
    added: sortedLocations(spec, changes.added),
    removed: sortedLocations(spec, changes.removed),
    increased: sortedLocations(spec, changes.increased),
    decreased: sortedLocations(spec, changes.decreased),
    comparedItems: changes.comparedItems,
  };
  return { status: comparisonStatus(result), ...result };
}
