import { describe, expect, it } from "vitest";

import { DEFAULT_DRIFT_AI_CONFIG, makeDefaultDriftAiConfig } from "./config-defaults.js";

// Every nested object/array reachable from `value` (including `value` itself).
// Used to prove two configs share no mutable nested state without enumerating the
// config shape — so a future shallow clone anywhere (ignore arrays, per-check
// config arrays like duplicates.excludeGlobs) is caught, not just the top level.
function collectReferences(value: unknown, refs: Set<object> = new Set()): Set<object> {
  if (value !== null && typeof value === "object") {
    refs.add(value);
    for (const nested of Object.values(value)) {
      collectReferences(nested, refs);
    }
  }
  return refs;
}

describe("default drift:ai config", () => {
  it("exposes checks as plain data, not an accessor", () => {
    const descriptor = Object.getOwnPropertyDescriptor(DEFAULT_DRIFT_AI_CONFIG, "checks");
    expect(descriptor).toBeDefined();
    if (!descriptor) throw new Error("expected a property descriptor for checks");
    expect("value" in descriptor).toBe(true);
    expect("get" in descriptor).toBe(false);
    expect("set" in descriptor).toBe(false);
  });

  it("matches a freshly built factory config", () => {
    expect(DEFAULT_DRIFT_AI_CONFIG).toEqual(makeDefaultDriftAiConfig());
  });

  it("returns a distinct object on every factory call", () => {
    const a = makeDefaultDriftAiConfig();
    const b = makeDefaultDriftAiConfig();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it("shares no nested object or array reference between factory instances", () => {
    const a = makeDefaultDriftAiConfig();
    const b = makeDefaultDriftAiConfig();

    // The walk must actually reach the deep arrays — otherwise disjointness below
    // would be vacuously true for exactly the spots a shallow clone would leak.
    const refsA = collectReferences(a);
    expect(refsA.has(a.ignore.prefixes)).toBe(true);
    expect(refsA.has(a.ignore.globs)).toBe(true);
    expect(refsA.has(a.checks.duplicates.excludeGlobs)).toBe(true);
    expect(refsA.has(a.checks.comments.excludePrefixes)).toBe(true);
    expect(refsA.has(a.checks["ghost-files"].currentAllowedPairs)).toBe(true);

    const refsB = collectReferences(b);
    for (const ref of refsB) {
      expect(refsA.has(ref), "factory instances must not share nested references").toBe(false);
    }
  });

  it("shares no nested reference between the shared snapshot and a factory copy", () => {
    const snapshotRefs = collectReferences(DEFAULT_DRIFT_AI_CONFIG);
    const copyRefs = collectReferences(makeDefaultDriftAiConfig());
    for (const ref of copyRefs) {
      expect(snapshotRefs.has(ref), "a factory copy must not alias the shared snapshot").toBe(
        false,
      );
    }
  });
});
