import { describe, expect, it } from "vitest";

import type { BaselineEntry } from "./entry-baseline.js";
import { gateEntries } from "./gate.js";

function ids(...keys: readonly string[]): BaselineEntry[] {
  return keys.map((key) => ({ key }));
}

function caps(entries: Readonly<Record<string, number>>): BaselineEntry[] {
  return Object.entries(entries).map(([key, count]) => ({ key, count }));
}

describe("gateEntries — identity ledger (no counts)", () => {
  it("passes when the key sets are identical", () => {
    const result = gateEntries(ids("a", "b"), ids("b", "a"));
    expect(result).toEqual({
      status: "ok",
      added: [],
      removed: [],
      increased: [],
      decreased: [],
    });
  });

  it("flags a new key as a regression", () => {
    const result = gateEntries(ids("a"), ids("a", "b"));
    expect(result.status).toBe("regressed");
    expect(result.added).toEqual(["b"]);
    expect(result.removed).toEqual([]);
  });

  it("flags a disappeared key as an improvement to be locked in", () => {
    const result = gateEntries(ids("a", "b"), ids("a"));
    expect(result.status).toBe("improved");
    expect(result.removed).toEqual(["b"]);
  });

  it("treats a same-count swap as a regression, not a pass", () => {
    const result = gateEntries(ids("a", "b"), ids("a", "c"));
    expect(result.status).toBe("regressed");
    expect(result.added).toEqual(["c"]);
    expect(result.removed).toEqual(["b"]);
  });

  it("never reports count movement when entries carry no counts", () => {
    const result = gateEntries(ids("a", "b"), ids("a", "b"));
    expect(result.increased).toEqual([]);
    expect(result.decreased).toEqual([]);
  });

  it("sorts the key lists", () => {
    const result = gateEntries(ids("a"), ids("a", "z", "b", "m"));
    expect(result.added).toEqual(["b", "m", "z"]);
  });
});

describe("gateEntries — count-bearing metric", () => {
  it("blocks a shared key whose current count rose above the baseline", () => {
    const result = gateEntries(caps({ f: 10 }), caps({ f: 12 }));
    expect(result.status).toBe("regressed");
    expect(result.increased).toEqual(["f"]);
    expect(result.added).toEqual([]);
  });

  it("requires a baseline update when a shared key's count fell", () => {
    const result = gateEntries(caps({ f: 10 }), caps({ f: 6 }));
    expect(result.status).toBe("improved");
    expect(result.decreased).toEqual(["f"]);
  });

  it("passes when counts are unchanged", () => {
    const result = gateEntries(caps({ f: 10, g: 3 }), caps({ g: 3, f: 10 }));
    expect(result.status).toBe("ok");
    expect(result.increased).toEqual([]);
    expect(result.decreased).toEqual([]);
  });

  it("prioritises a regression when one key rose and another fell", () => {
    const result = gateEntries(caps({ f: 10, g: 5 }), caps({ f: 12, g: 4 }));
    expect(result.status).toBe("regressed");
    expect(result.increased).toEqual(["f"]);
    expect(result.decreased).toEqual(["g"]);
  });

  it("treats a missing count as 1 against an explicit count", () => {
    // baseline cap of 1 vs a current identity entry (count defaults to 1): equal.
    const result = gateEntries(caps({ f: 1 }), ids("f"));
    expect(result.status).toBe("ok");
  });
});
