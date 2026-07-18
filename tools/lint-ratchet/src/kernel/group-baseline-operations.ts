import type {
  GroupedBaseline,
  GroupedBaselineGroup,
  GroupedBaselineSpec,
  MergeGroupedBaselineInput,
  MergeGroupedBaselineResult,
} from "./group-baseline.js";
import { formattedGroupedTest } from "./group-baseline-format.js";
import { mergeItemMaps } from "./item-merge.js";

interface GroupVersions<GroupMeta, Item> {
  readonly base: GroupedBaselineGroup<GroupMeta, Item> | undefined;
  readonly current: GroupedBaselineGroup<GroupMeta, Item> | undefined;
  readonly other: GroupedBaselineGroup<GroupMeta, Item> | undefined;
}

interface GroupDecision<GroupMeta, Item> {
  readonly resolved: boolean;
  readonly group: GroupedBaselineGroup<GroupMeta, Item> | undefined;
}

interface ChangedGroupResult<GroupMeta, Item> {
  readonly group?: GroupedBaselineGroup<GroupMeta, Item>;
  readonly failures: readonly string[];
  readonly truthUpRequired: boolean;
}

// "Same" means both sides canonicalize to the same formatted document, so
// differences the canonical format cannot express (list order, zero-count
// items) are not changes. Sound only while the spec's format callbacks emit
// every semantic field — a lossy formatter widens this equality silently
// (sensitivity pins: lint-ratchet/baseline-merge.test.ts).
function sameCanonicalGroup<GroupMeta, Item>(
  spec: GroupedBaselineSpec<GroupMeta, Item>,
  groupId: string,
  left: GroupedBaselineGroup<GroupMeta, Item>,
  right: GroupedBaselineGroup<GroupMeta, Item>,
): boolean {
  return (
    JSON.stringify(formattedGroupedTest(spec, groupId, left)) ===
    JSON.stringify(formattedGroupedTest(spec, groupId, right))
  );
}

function resolvedGroup<GroupMeta, Item>(
  group: GroupedBaselineGroup<GroupMeta, Item> | undefined,
): GroupDecision<GroupMeta, Item> {
  return { resolved: true, group };
}

function unresolvedGroup<GroupMeta, Item>(): GroupDecision<GroupMeta, Item> {
  return { resolved: false, group: undefined };
}

function chooseWithoutBase<GroupMeta, Item>(
  versions: GroupVersions<GroupMeta, Item>,
): GroupDecision<GroupMeta, Item> {
  if (versions.current === undefined) return resolvedGroup(versions.other);
  if (versions.other === undefined) return resolvedGroup(versions.current);
  return unresolvedGroup();
}

function chooseAgainstBase<GroupMeta, Item>(
  spec: GroupedBaselineSpec<GroupMeta, Item>,
  groupId: string,
  versions: GroupVersions<GroupMeta, Item>,
): GroupDecision<GroupMeta, Item> {
  if (versions.base === undefined) return chooseWithoutBase(versions);
  if (
    versions.current !== undefined &&
    sameCanonicalGroup(spec, groupId, versions.current, versions.base)
  ) {
    return resolvedGroup(versions.other);
  }
  if (
    versions.other !== undefined &&
    sameCanonicalGroup(spec, groupId, versions.other, versions.base)
  ) {
    return resolvedGroup(versions.current);
  }
  return unresolvedGroup();
}

function chooseSimpleGroupMerge<GroupMeta, Item>(
  spec: GroupedBaselineSpec<GroupMeta, Item>,
  groupId: string,
  versions: GroupVersions<GroupMeta, Item>,
): GroupDecision<GroupMeta, Item> {
  if (versions.current === undefined && versions.other === undefined) {
    return resolvedGroup(undefined);
  }
  if (
    versions.current !== undefined &&
    versions.other !== undefined &&
    sameCanonicalGroup(spec, groupId, versions.current, versions.other)
  ) {
    return resolvedGroup(versions.current);
  }
  return chooseAgainstBase(spec, groupId, versions);
}

function mergeChangedGroup<GroupMeta, Item>(
  spec: GroupedBaselineSpec<GroupMeta, Item>,
  groupId: string,
  versions: GroupVersions<GroupMeta, Item> & {
    readonly current: GroupedBaselineGroup<GroupMeta, Item>;
    readonly other: GroupedBaselineGroup<GroupMeta, Item>;
  },
): ChangedGroupResult<GroupMeta, Item> {
  if (!spec.sameGroupMeta(versions.current.meta, versions.other.meta)) {
    return {
      failures: [
        `${groupId}: baseline group metadata differs between sides; regenerate the baseline after resolving other conflicts`,
      ],
      truthUpRequired: false,
    };
  }
  const itemPolicy = spec.itemMergePolicy(groupId, versions.current.meta);
  const merged = mergeItemMaps(
    { count: spec.itemCount, ...itemPolicy },
    {
      base: versions.base?.items ?? new Map(),
      current: versions.current.items,
      other: versions.other.items,
      compareKeys: spec.compareItemKeys,
    },
  );
  // On item conflicts the group still returns its surviving merged items, so
  // the caller's partial baseline carries them into failure-path validation
  // and follow-on defects are reported alongside the conflict.
  return {
    group: {
      meta: versions.current.meta,
      items: new Map(merged.merged.map(({ key, item }) => [key, item])),
    },
    failures: merged.failures,
    truthUpRequired: merged.failures.length === 0 && merged.truthUpRequired,
  };
}

function groupVersions<GroupMeta, Item>(
  input: MergeGroupedBaselineInput<GroupMeta, Item>,
  groupId: string,
): GroupVersions<GroupMeta, Item> {
  return {
    base: input.base.groups.get(groupId),
    current: input.current.groups.get(groupId),
    other: input.other.groups.get(groupId),
  };
}

function allGroupIds<GroupMeta, Item>(
  spec: GroupedBaselineSpec<GroupMeta, Item>,
  input: MergeGroupedBaselineInput<GroupMeta, Item>,
): string[] {
  return [
    ...new Set([
      ...input.base.groups.keys(),
      ...input.current.groups.keys(),
      ...input.other.groups.keys(),
    ]),
  ].sort(spec.compareGroupKeys);
}

function groupedMergeOutput<GroupMeta, Item>(
  spec: GroupedBaselineSpec<GroupMeta, Item>,
  groups: ReadonlyMap<string, GroupedBaselineGroup<GroupMeta, Item>>,
): GroupedBaseline<GroupMeta, Item> {
  return {
    version: spec.writeVersion,
    ...(spec.regenerate === undefined ? {} : { regenerate: spec.regenerate }),
    groups,
  };
}

export function mergeGroupedBaselineDocuments<GroupMeta, Item>(
  spec: GroupedBaselineSpec<GroupMeta, Item>,
  input: MergeGroupedBaselineInput<GroupMeta, Item>,
): MergeGroupedBaselineResult<GroupMeta, Item> {
  const groups = new Map<string, GroupedBaselineGroup<GroupMeta, Item>>();
  const failures: string[] = [];
  let postMergeTruthUpRequired = false;
  for (const groupId of allGroupIds(spec, input)) {
    const versions = groupVersions(input, groupId);
    const simple = chooseSimpleGroupMerge(spec, groupId, versions);
    if (simple.resolved) {
      if (simple.group !== undefined) groups.set(groupId, simple.group);
      continue;
    }
    if (versions.current === undefined || versions.other === undefined) {
      failures.push(
        `${groupId}: one side removed the baseline group while the other changed it; regenerate the baseline after resolving other conflicts`,
      );
      continue;
    }
    const merged = mergeChangedGroup(spec, groupId, {
      ...versions,
      current: versions.current,
      other: versions.other,
    });
    failures.push(...merged.failures);
    if (merged.truthUpRequired) postMergeTruthUpRequired = true;
    if (merged.group !== undefined) groups.set(groupId, merged.group);
  }
  if (failures.length > 0) {
    return {
      partialBaseline: groupedMergeOutput(spec, groups),
      failures,
      postMergeTruthUpRequired: false,
    };
  }
  return {
    baseline: groupedMergeOutput(spec, groups),
    failures: [],
    postMergeTruthUpRequired,
  };
}
