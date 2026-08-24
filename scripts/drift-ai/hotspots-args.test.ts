import { describe, expect, it } from "vitest";

import { DriftAiHelp } from "./cli-args.js";
import { DriftAiError } from "./errors.js";
import { lensSelection, parseHotspotsArgs } from "./hotspots-args.js";
import { CONCRETE_HOTSPOT_LENSES } from "./hotspots-lens-registry.js";

describe("parseHotspotsArgs", () => {
  it("defaults to the churn lens with the default window, top, and text format", () => {
    const parsed = parseHotspotsArgs([]);
    expect(parsed.lens).toBe("churn");
    expect(parsed.top).toBe(20);
    expect(parsed.base.format).toBe("text");
  });

  it("accepts every registry lens plus all, so a registered lens cannot drop out of --lens", () => {
    for (const lens of CONCRETE_HOTSPOT_LENSES) {
      expect(parseHotspotsArgs(["--lens", lens]).lens).toBe(lens);
    }
    expect(parseHotspotsArgs(["--lens", "all"]).lens).toBe("all");
  });

  it("lists every registry lens in the unknown-lens error message", () => {
    expect(() => parseHotspotsArgs(["--lens", "bogus"])).toThrow(DriftAiError);
    expect(() => parseHotspotsArgs(["--lens", "bogus"])).toThrow(
      `--lens requires one of ${[...CONCRETE_HOTSPOT_LENSES, "all"].join("|")} (got 'bogus').`,
    );
  });

  it("derives the usage lens list from the registry", () => {
    let usage = "";
    try {
      parseHotspotsArgs(["--help"]);
    } catch (err) {
      if (!(err instanceof DriftAiHelp)) throw err;
      usage = err.message;
    }
    expect(usage).toContain(`--lens <${[...CONCRETE_HOTSPOT_LENSES, "all"].join("|")}>`);
    expect(usage).toContain(`Git-only lenses: ${CONCRETE_HOTSPOT_LENSES.join(", ")}.`);
  });
});

describe("lensSelection", () => {
  it("maps each concrete lens to itself and fans all out to every registered lens", () => {
    for (const lens of CONCRETE_HOTSPOT_LENSES) {
      expect(lensSelection(lens)).toEqual([lens]);
    }
    expect(lensSelection("all")).toEqual([...CONCRETE_HOTSPOT_LENSES]);
  });
});
