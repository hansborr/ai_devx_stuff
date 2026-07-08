import { describe, expect, it } from "vitest";

import {
  type BaselineEntry,
  type BaselineMetricSpec,
  formatBaseline,
  type ParseResult,
} from "./entry-baseline.js";
import { mergeBaseline, type MergeBaselineResult } from "./merge.js";

// Identity ledger: entries keyed by name, count defaulted to 1.
interface NameEntry extends BaselineEntry {
  readonly key: string;
  readonly name: string;
}

const nameSpec: BaselineMetricSpec<NameEntry> = {
  tool: "demo",
  metric: "names",
  meta: {},
  parseEntry(raw): ParseResult<NameEntry> {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return { ok: false, error: "entry must be an object" };
    }
    const name = (raw as Record<string, unknown>)["name"];
    if (typeof name !== "string") return { ok: false, error: "entry needs a string name" };
    return { ok: true, value: { key: name, name } };
  },
  formatEntry(entry) {
    return { key: entry.key, name: entry.name };
  },
  summarize(entries) {
    return { count: entries.length };
  },
};

function names(...list: readonly string[]): NameEntry[] {
  return list.map((name) => ({ key: name, name }));
}

function mergeNames(base: string, current: string, other: string): MergeBaselineResult {
  return mergeBaseline(nameSpec, { baseText: base, currentText: current, otherText: other });
}

// Cap ledger: entries carry an explicit count so min-merge is observable.
interface CapEntry extends BaselineEntry {
  readonly key: string;
  readonly count: number;
}

const capSpec: BaselineMetricSpec<CapEntry> = {
  tool: "demo",
  metric: "caps",
  meta: {},
  parseEntry(raw): ParseResult<CapEntry> {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return { ok: false, error: "entry must be an object" };
    }
    const record = raw as Record<string, unknown>;
    const { key, count } = record;
    if (typeof key !== "string" || typeof count !== "number") {
      return { ok: false, error: "entry needs string key and number count" };
    }
    return { ok: true, value: { key, count } };
  },
  formatEntry(entry) {
    return { key: entry.key, count: entry.count };
  },
  summarize(entries) {
    return { total: entries.reduce((sum, entry) => sum + entry.count, 0) };
  },
};

describe("mergeBaseline identity ledger", () => {
  it("takes the other side verbatim when current is unchanged from base", () => {
    const base = formatBaseline(nameSpec, names("a", "b"));
    const other = formatBaseline(nameSpec, names("a"));
    const result = mergeNames(base, base, other);
    expect(result.mergedText).toBe(other);
    expect(result.postMergeTruthUpRequired).toBe(false);
  });

  it("keeps only keys present on both sides and requires truth-up on divergence", () => {
    const base = formatBaseline(nameSpec, names("a", "b"));
    const current = formatBaseline(nameSpec, names("a", "c")); // dropped b, added c
    const other = formatBaseline(nameSpec, names("a", "d")); // dropped b, added d
    const result = mergeNames(base, current, other);
    expect(result.failures).toEqual([]);
    expect(result.postMergeTruthUpRequired).toBe(true);
    expect(result.mergedText).toBe(formatBaseline(nameSpec, names("a")));
  });

  it("merges cleanly with no truth-up when both sides made the same change", () => {
    const base = formatBaseline(nameSpec, names("a", "b"));
    const current = formatBaseline(nameSpec, names("a"));
    const result = mergeNames(base, current, current);
    expect(result.mergedText).toBe(current);
    expect(result.postMergeTruthUpRequired).toBe(false);
  });

  it("treats an empty base as zero entries", () => {
    const current = formatBaseline(nameSpec, names("a"));
    const other = formatBaseline(nameSpec, names("b"));
    const result = mergeNames("", current, other);
    // Both sides added a different key onto nothing: intersection is empty.
    expect(result.mergedText).toBe(formatBaseline(nameSpec, names()));
    expect(result.postMergeTruthUpRequired).toBe(true);
  });

  it("reports parse failures instead of a merged text", () => {
    const result = mergeNames("", "{ not json", formatBaseline(nameSpec, names("a")));
    expect(result.mergedText).toBeUndefined();
    expect(result.failures.some((failure) => failure.includes("current"))).toBe(true);
  });
});

describe("mergeBaseline cap ledger", () => {
  it("resolves a conflicting count to the lower floor and requires truth-up", () => {
    const base = formatBaseline(capSpec, [{ key: "f", count: 10 }]);
    const current = formatBaseline(capSpec, [{ key: "f", count: 8 }]);
    const other = formatBaseline(capSpec, [{ key: "f", count: 6 }]);
    const result = mergeBaseline(capSpec, {
      baseText: base,
      currentText: current,
      otherText: other,
    });
    expect(result.failures).toEqual([]);
    expect(result.postMergeTruthUpRequired).toBe(true);
    expect(result.mergedText).toBe(formatBaseline(capSpec, [{ key: "f", count: 6 }]));
  });
});
