import { describe, expect, it } from "vitest";

import {
  compareGroupedBaseline,
  formatGroupedBaseline,
  type GroupedBaseline,
  type GroupedBaselineGroup,
  type GroupedBaselineSpec,
  mergeGroupedBaseline,
  type MergeGroupedBaselineResult,
  parseGroupedBaseline,
} from "./group-baseline.js";

interface DemoMeta {
  readonly label: string;
}

interface DemoItem {
  readonly count: number;
  readonly payload: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareKeys(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

const demoSpec: GroupedBaselineSpec<DemoMeta, DemoItem> = {
  writeVersion: 2,
  acceptedReadVersions: [1, 2],
  rootKey: "tests",
  regenerate: "bun run demo:update",
  conflictMarkerRemediation: {
    baselineFile: "demo.baseline.json",
    installerCommand: "bun run demo:install-driver",
    updateCommand: "bun run demo:update",
  },
  compareGroupKeys: compareKeys,
  compareItemKeys: compareKeys,
  parseGroupMeta(_groupId, raw) {
    if (!isRecord(raw) || typeof raw["label"] !== "string") {
      return { ok: false, error: "group label must be a string" };
    }
    return { ok: true, value: { label: raw["label"] } };
  },
  formatGroupMeta(_groupId, meta) {
    return { label: meta.label };
  },
  sameGroupMeta(left, right) {
    return left.label === right.label;
  },
  parseItem(_groupId, itemKey, raw) {
    if (itemKey === undefined || !isRecord(raw)) {
      return { ok: false, error: "item must be a keyed object" };
    }
    const { count, payload } = raw;
    if (typeof count !== "number" || typeof payload !== "string") {
      return { ok: false, error: "item needs count and payload" };
    }
    return { ok: true, value: { key: itemKey, item: { count, payload } } };
  },
  formatItem(_groupId, _itemKey, item) {
    return { count: item.count, payload: item.payload };
  },
  itemCount(item) {
    return item.count;
  },
  itemMergePolicy(groupId) {
    return {
      mergeShared(key, current, other) {
        if (current.payload !== other.payload) {
          return { failure: `${groupId}/${key}: payload differs` };
        }
        if (current.count === other.count) return { item: current };
        return { item: current.count < other.count ? current : other, truthUp: true };
      },
      mergeOneSided() {
        return { truthUp: true };
      },
    };
  },
};

function item(count: number, payload = "same"): DemoItem {
  return { count, payload };
}

function group(
  label: string,
  items: Readonly<Record<string, DemoItem>>,
): GroupedBaselineGroup<DemoMeta, DemoItem> {
  return { meta: { label }, items: new Map(Object.entries(items)) };
}

function baseline(
  groups: Readonly<Record<string, GroupedBaselineGroup<DemoMeta, DemoItem>>>,
  version = 1,
): GroupedBaseline<DemoMeta, DemoItem> {
  return { version, groups: new Map(Object.entries(groups)) };
}

function merge(
  base: GroupedBaseline<DemoMeta, DemoItem>,
  current: GroupedBaseline<DemoMeta, DemoItem>,
  other: GroupedBaseline<DemoMeta, DemoItem>,
): MergeGroupedBaselineResult<DemoMeta, DemoItem> {
  return mergeGroupedBaseline(demoSpec, { base, current, other });
}

describe("parseGroupedBaseline", () => {
  it("accepts every codec read version and format preserves the parsed version", () => {
    const text = `${JSON.stringify(
      {
        version: 1,
        regenerate: "bun run demo:update",
        tests: { alpha: { label: "A", items: { x: { count: 2, payload: "same" } } } },
      },
      null,
      2,
    )}\n`;
    const parsed = parseGroupedBaseline(demoSpec, text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(formatGroupedBaseline(demoSpec, parsed.value)).toBe(text);
  });

  it("rejects a version outside codec membership", () => {
    const parsed = parseGroupedBaseline(demoSpec, JSON.stringify({ version: 3, tests: {} }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("version must be one of 1, 2");
  });

  it("rejects a document from the other root-key family", () => {
    const parsed = parseGroupedBaseline(demoSpec, JSON.stringify({ version: 1, entries: [] }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("wrong document family");
  });

  it("accumulates structural failures across groups, items, and metadata", () => {
    const parsed = parseGroupedBaseline(
      demoSpec,
      JSON.stringify({
        version: 1,
        tests: {
          alpha: { label: "A", items: { x: { count: 2 }, y: { count: 1, payload: "same" } } },
          beta: { label: 7, items: { z: { count: 1, payload: "same" } } },
          delta: { label: 7 },
          gamma: "not a group",
        },
      }),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toBe("alpha.items.x: item needs count and payload");
      expect(parsed.errors).toEqual([
        "alpha.items.x: item needs count and payload",
        "beta: group label must be a string",
        "delta: baseline group must contain an items object",
        "delta: group label must be a string",
        "gamma: baseline group must contain an items object",
      ]);
    }
  });

  it("keeps parsing after a sorted-key violation and reports later defects", () => {
    const parsed = parseGroupedBaseline(
      demoSpec,
      JSON.stringify({
        version: 1,
        tests: {
          beta: { label: "B", items: {} },
          alpha: { label: "A", items: { x: { count: 1 } } },
        },
      }),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors).toEqual([
        "baseline tests must be sorted by key; 'alpha' follows 'beta'",
        "alpha.items.x: item needs count and payload",
      ]);
    }
  });

  it("replaces JSON syntax noise with the generated-baseline conflict recipe", () => {
    const parsed = parseGroupedBaseline(
      demoSpec,
      '<<<<<<< ours\n{"version":1,"tests":{}}\n=======\n{}\n>>>>>>> theirs\n',
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toContain("demo.baseline.json is generated");
      expect(parsed.error).toContain("bun run demo:install-driver");
    }
  });
});

describe("mergeGroupedBaseline group decision table", () => {
  it("drops a base group removed by both sides", () => {
    const result = merge(baseline({ g: group("G", { a: item(3) }) }), baseline({}), baseline({}));
    expect(result.failures).toEqual([]);
    expect(result.baseline?.groups.size).toBe(0);
  });

  it("keeps canonically equal changed sides", () => {
    const changed = group("G", { a: item(2) });
    const result = merge(
      baseline({ g: group("G", { a: item(3) }) }),
      baseline({ g: changed }),
      baseline({ g: changed }),
    );
    expect(result.failures).toEqual([]);
    expect(result.baseline?.groups.get("g")).toEqual(changed);
  });

  it.each([
    { unchanged: "current", expectedCount: 1 },
    { unchanged: "other", expectedCount: 2 },
  ])("takes the changed side when $unchanged equals base", ({ unchanged, expectedCount }) => {
    const baseGroup = group("G", { a: item(3) });
    const current = unchanged === "current" ? baseGroup : group("G", { a: item(2) });
    const other = unchanged === "other" ? baseGroup : group("G", { a: item(1) });
    const result = merge(
      baseline({ g: baseGroup }),
      baseline({ g: current }),
      baseline({ g: other }),
    );
    expect(result.failures).toEqual([]);
    expect(result.baseline?.groups.get("g")?.items.get("a")?.count).toBe(expectedCount);
  });

  it.each(["current", "other"])(
    "keeps a group added only on the %s side when the base has no group",
    (addedSide) => {
      const added = group("G", { a: item(2) });
      const current = addedSide === "current" ? baseline({ g: added }) : baseline({});
      const other = addedSide === "other" ? baseline({ g: added }) : baseline({});
      const result = merge(baseline({}), current, other);
      expect(result.failures).toEqual([]);
      expect(result.baseline?.groups.get("g")).toEqual(added);
    },
  );

  it("merges independently added groups when the base has no group", () => {
    const result = merge(
      baseline({}),
      baseline({ g: group("G", { a: item(4) }) }),
      baseline({ g: group("G", { a: item(2) }) }),
    );
    expect(result.failures).toEqual([]);
    expect(result.baseline?.groups.get("g")?.items.get("a")?.count).toBe(2);
  });

  it("takes a removal when the other side is unchanged from base", () => {
    const added = group("G", { a: item(2) });
    const result = merge(baseline({ g: added }), baseline({}), baseline({ g: added }));
    expect(result.failures).toEqual([]);
    expect(result.baseline?.groups.has("g")).toBe(false);
  });

  it("fails when one side removes a group and the other changes it", () => {
    const result = merge(
      baseline({ g: group("G", { a: item(3) }) }),
      baseline({}),
      baseline({ g: group("G", { a: item(2) }) }),
    );
    expect(result.baseline).toBeUndefined();
    expect(result.failures).toEqual([
      "g: one side removed the baseline group while the other changed it; regenerate the baseline after resolving other conflicts",
    ]);
  });

  it("rejects differing metadata when both sides changed", () => {
    const result = merge(
      baseline({ g: group("base", { a: item(3) }) }),
      baseline({ g: group("current", { a: item(2) }) }),
      baseline({ g: group("other", { a: item(1) }) }),
    );
    expect(result.baseline).toBeUndefined();
    expect(result.failures).toEqual([
      "g: baseline group metadata differs between sides; regenerate the baseline after resolving other conflicts",
    ]);
  });

  it("merges items when both sides changed under equal metadata", () => {
    const result = merge(
      baseline({ g: group("G", { a: item(5) }) }),
      baseline({ g: group("G", { a: item(4) }) }),
      baseline({ g: group("G", { a: item(2) }) }),
    );
    expect(result.failures).toEqual([]);
    expect(result.postMergeTruthUpRequired).toBe(true);
    expect(result.baseline?.groups.get("g")?.items.get("a")?.count).toBe(2);
    expect(result.baseline?.version).toBe(demoSpec.writeVersion);
    expect(result.baseline?.regenerate).toBe(demoSpec.regenerate);
  });

  it("keeps an item-conflict group's surviving items in the partial baseline", () => {
    const result = merge(
      baseline({ g: group("G", { a: item(3), b: item(3) }) }),
      baseline({ g: group("G", { a: item(2, "left"), b: item(2) }) }),
      baseline({ g: group("G", { a: item(2, "right"), b: item(1) }) }),
    );
    expect(result.baseline).toBeUndefined();
    expect(result.failures).toEqual(["g/a: payload differs"]);
    const partial = result.partialBaseline?.groups.get("g");
    expect(partial?.meta).toEqual({ label: "G" });
    expect([...(partial?.items.entries() ?? [])]).toEqual([["b", item(1)]]);
  });

  it("never drops a surviving group whose merged item map becomes empty", () => {
    const result = merge(
      baseline({ g: group("G", { a: item(3), b: item(3) }) }),
      baseline({ g: group("G", { a: item(2) }) }),
      baseline({ g: group("G", { b: item(2) }) }),
    );
    expect(result.failures).toEqual([]);
    expect(result.baseline?.groups.has("g")).toBe(true);
    expect(result.baseline?.groups.get("g")?.items.size).toBe(0);
  });
});

describe("compareGroupedBaseline", () => {
  it("reports symmetric key and count movement", () => {
    const result = compareGroupedBaseline(
      demoSpec,
      baseline({ g: group("G", { decreased: item(3), removed: item(1) }) }),
      baseline({ g: group("G", { added: item(1), decreased: item(2) }) }),
    );
    expect(result.status).toBe("regressed");
    expect(result.added).toEqual([{ groupId: "g", itemKey: "added" }]);
    expect(result.removed).toEqual([{ groupId: "g", itemKey: "removed" }]);
    expect(result.decreased).toEqual([{ groupId: "g", itemKey: "decreased" }]);
    expect(result.comparedItems).toEqual([
      {
        groupId: "g",
        itemKey: "added",
        currentItem: item(1),
      },
      {
        groupId: "g",
        itemKey: "decreased",
        baselineItem: item(3),
        currentItem: item(2),
      },
      {
        groupId: "g",
        itemKey: "removed",
        baselineItem: item(1),
      },
    ]);
  });
});
