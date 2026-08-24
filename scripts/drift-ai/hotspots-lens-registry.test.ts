import { describe, expect, it } from "vitest";

import {
  CONCRETE_HOTSPOT_LENSES,
  HOTSPOT_LENS_DEFINITIONS,
  rowKeyKindFor,
  selectionNeedsSuppressionScan,
} from "./hotspots-lens-registry.js";

describe("HOTSPOT_LENS_DEFINITIONS", () => {
  it("registers every concrete lens exactly once, in render order", () => {
    expect(HOTSPOT_LENS_DEFINITIONS.map((definition) => definition.id)).toEqual([
      "churn",
      "coupling",
      "fragmentation",
      "suppression-churn",
      "thrash",
    ]);
  });

  it("derives CONCRETE_HOTSPOT_LENSES from the definitions, so the list cannot drop a member", () => {
    expect(CONCRETE_HOTSPOT_LENSES).toEqual(
      HOTSPOT_LENS_DEFINITIONS.map((definition) => definition.id),
    );
  });
});

describe("rowKeyKindFor", () => {
  it("keys coupling by pair and every other registered lens by path", () => {
    expect(rowKeyKindFor("coupling")).toBe("pair");
    for (const definition of HOTSPOT_LENS_DEFINITIONS) {
      if (definition.id === "coupling") continue;
      expect(rowKeyKindFor(definition.id)).toBe("path");
    }
  });

  it("returns null for a lens string the registry does not know (untrusted baseline input)", () => {
    expect(rowKeyKindFor("bogus")).toBeNull();
    expect(rowKeyKindFor("")).toBeNull();
    expect(rowKeyKindFor("all")).toBeNull();
  });
});

describe("selectionNeedsSuppressionScan", () => {
  it("is true only when the selection includes a lens that declares the content scan", () => {
    expect(selectionNeedsSuppressionScan(["suppression-churn"])).toBe(true);
    expect(selectionNeedsSuppressionScan(CONCRETE_HOTSPOT_LENSES)).toBe(true);
    expect(selectionNeedsSuppressionScan(["churn", "coupling", "fragmentation", "thrash"])).toBe(
      false,
    );
    expect(selectionNeedsSuppressionScan([])).toBe(false);
  });
});
