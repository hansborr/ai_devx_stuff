import { describe, expect, it } from "vitest";

import { type ItemMergePolicy, mergeItemMaps } from "./item-merge.js";

interface CountItem {
  readonly count: number;
}

function map(entries: Readonly<Record<string, number>>): ReadonlyMap<string, CountItem> {
  return new Map(Object.entries(entries).map(([key, count]) => [key, { count }]));
}

// A minimal min-floor policy: shared keys take the lower count (truth-up when
// they differ), one-sided keys are kept only when the base did not carry them.
const minFloorPolicy: ItemMergePolicy<CountItem> = {
  count: (item) => item.count,
  mergeShared: (_key, current, other) =>
    current.count === other.count
      ? { item: current }
      : { item: current.count < other.count ? current : other, truthUp: true },
  mergeOneSided: (_key, present, base) =>
    base === undefined ? { item: present } : { truthUp: true },
};

function byCodepoint(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

function merge(
  base: Readonly<Record<string, number>>,
  current: Readonly<Record<string, number>>,
  other: Readonly<Record<string, number>>,
): ReturnType<typeof mergeItemMaps<CountItem>> {
  return mergeItemMaps(minFloorPolicy, {
    base: map(base),
    current: map(current),
    other: map(other),
    compareKeys: byCodepoint,
  });
}

describe("mergeItemMaps", () => {
  it("resolves a shared key to the lower count and flags truth-up", () => {
    const result = merge({ a: 5 }, { a: 3 }, { a: 4 });
    expect(result.merged).toEqual([{ key: "a", item: { count: 3 } }]);
    expect(result.truthUpRequired).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("keeps a one-sided addition the base never carried without truth-up", () => {
    const result = merge({}, { a: 2 }, {});
    expect(result.merged).toEqual([{ key: "a", item: { count: 2 } }]);
    expect(result.truthUpRequired).toBe(false);
  });

  it("drops a one-sided key the base carried and flags truth-up", () => {
    const result = merge({ a: 2 }, {}, { a: 2 });
    expect(result.merged).toEqual([]);
    expect(result.truthUpRequired).toBe(true);
  });

  it("drops a key whose merged item drains to zero", () => {
    const zeroPolicy: ItemMergePolicy<CountItem> = {
      ...minFloorPolicy,
      mergeShared: () => ({ item: { count: 0 } }),
    };
    const result = mergeItemMaps(zeroPolicy, {
      base: map({}),
      current: map({ a: 3 }),
      other: map({ a: 4 }),
      compareKeys: byCodepoint,
    });
    expect(result.merged).toEqual([]);
  });

  it("collects a policy failure and keeps walking the remaining keys", () => {
    const failingPolicy: ItemMergePolicy<CountItem> = {
      ...minFloorPolicy,
      mergeShared: (key, current, other) =>
        key === "a"
          ? { failure: `${key}: conflict` }
          : minFloorPolicy.mergeShared(key, current, other),
    };
    const result = mergeItemMaps(failingPolicy, {
      base: map({}),
      current: map({ a: 3, b: 5 }),
      other: map({ a: 4, b: 2 }),
      compareKeys: byCodepoint,
    });
    expect(result.failures).toEqual(["a: conflict"]);
    expect(result.merged).toEqual([{ key: "b", item: { count: 2 } }]);
  });

  it("walks union keys in the injected comparator order", () => {
    const result = merge({}, { b: 1, a: 1 }, { c: 1 });
    expect(result.merged.map((entry) => entry.key)).toEqual(["a", "b", "c"]);
  });
});
