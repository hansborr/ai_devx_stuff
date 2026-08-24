import { describe, expect, it } from "vitest";

import { makeDefaultDriftAiConfig } from "./config-defaults.js";
import {
  makeEmptyCheckConfig,
  readExcludeGlobsOrDefault,
  readPositiveIntOrDefault,
} from "./config-readers.js";
import { DriftAiError } from "./errors.js";

describe("makeEmptyCheckConfig", () => {
  it("builds the canonical empty-config metadata literal", () => {
    const meta = makeEmptyCheckConfig("import-cycles", { runByDefault: false });
    expect(meta.id).toBe("import-cycles");
    expect(meta.usage).toBe("import-cycles");
    expect(meta.defaultConfig).toEqual({});
    expect(meta.runByDefault).toBe(false);
  });

  it("defaults usage to the id and lets it be overridden", () => {
    expect(makeEmptyCheckConfig("orphan-files").usage).toBe("orphan-files");
    expect(makeEmptyCheckConfig("orphan-files", { usage: "orphans" }).usage).toBe("orphans");
  });

  it("omits runByDefault when not provided (default-on, e.g. suppressions)", () => {
    const meta = makeEmptyCheckConfig("suppressions");
    expect("runByDefault" in meta).toBe(false);
    expect(meta.runByDefault).toBeUndefined();
  });

  it("emits runByDefault only when explicitly passed", () => {
    expect("runByDefault" in makeEmptyCheckConfig("import-cycles", { runByDefault: true })).toBe(
      true,
    );
    expect(makeEmptyCheckConfig("import-cycles", { runByDefault: true }).runByDefault).toBe(true);
  });

  it("selectConfig reads the id's own slot out of the full config", () => {
    const config = makeDefaultDriftAiConfig();
    const meta = makeEmptyCheckConfig("knip-duplicates");
    // Identity, not just structural equality: confirms the lambda indexes the
    // matching `checks[id]` slot rather than any other empty `{}` slot.
    expect(meta.selectConfig(config)).toBe(config.checks["knip-duplicates"]);
    expect(meta.selectConfig(config)).not.toBe(config.checks["import-cycles"]);
  });

  it("parseConfig rejects unknown keys and accepts the empty object", () => {
    const meta = makeEmptyCheckConfig("unused-exports");
    expect(meta.parseConfig({}, "checks.unused-exports")).toEqual({});
    expect(() => meta.parseConfig({ extra: 1 }, "checks.unused-exports")).toThrow(DriftAiError);
  });
});

describe("readPositiveIntOrDefault", () => {
  it("returns the fallback when the field is absent", () => {
    expect(readPositiveIntOrDefault({}, "minKeys", 3, "checks.duplicate-schemas")).toBe(3);
  });

  it("returns the parsed positive integer when present", () => {
    expect(readPositiveIntOrDefault({ minKeys: 5 }, "minKeys", 3, "checks.duplicate-schemas")).toBe(
      5,
    );
  });

  it("rejects non-positive and non-integer values", () => {
    for (const bad of [0, -1, 2.5, "4"]) {
      expect(() =>
        readPositiveIntOrDefault({ minProps: bad }, "minProps", 3, "checks.duplicate-types"),
      ).toThrow(DriftAiError);
    }
  });
});

describe("readExcludeGlobsOrDefault", () => {
  it("returns the fallback when the field is absent", () => {
    const fallback = ["a/**"] as const;
    expect(readExcludeGlobsOrDefault({}, fallback, "checks.duplicate-schemas")).toBe(fallback);
  });

  it("trims, dedupes, and sorts provided globs", () => {
    // normalizeGlob trims surrounding whitespace; the repeated "src/x" collapses
    // (uniqSorted) and the result is ascending.
    expect(
      readExcludeGlobsOrDefault(
        { excludeGlobs: ["src/x", "  src/b  ", "src/x"] },
        [],
        "checks.duplicate-schemas",
      ),
    ).toEqual(["src/b", "src/x"]);
  });

  it("rejects a non-array excludeGlobs", () => {
    expect(() =>
      readExcludeGlobsOrDefault({ excludeGlobs: "a/**" }, [], "checks.duplicate-schemas"),
    ).toThrow(DriftAiError);
  });
});
