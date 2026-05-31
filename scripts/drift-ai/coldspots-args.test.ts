import { describe, expect, it } from "vitest";

import { COLDSPOT_LENS_SELECTIONS, parseColdspotsArgs } from "./coldspots-args.js";
import { DriftAiError } from "./errors.js";

describe("parseColdspotsArgs", () => {
  it("defaults to the coldspot lens, the widened window, and text format", () => {
    const parsed = parseColdspotsArgs([]);
    expect(parsed.lens).toBe("coldspot");
    expect(parsed.windowDays).toBe(180);
    expect(parsed.top).toBe(20);
    expect(parsed.base.format).toBe("text");
  });

  it("parses --lens coldspot, --lens stale-markers, and --lens all", () => {
    expect(parseColdspotsArgs(["--lens", "coldspot"]).lens).toBe("coldspot");
    expect(parseColdspotsArgs(["--lens", "stale-markers"]).lens).toBe("stale-markers");
    expect(parseColdspotsArgs(["--lens", "all"]).lens).toBe("all");
  });

  it("rejects an unknown lens with a DriftAiError", () => {
    expect(() => parseColdspotsArgs(["--lens", "bogus"])).toThrow(DriftAiError);
    expect(() => parseColdspotsArgs(["--lens", "bogus"])).toThrow(/--lens requires one of/u);
  });

  it("parses --marker-age-threshold for the stale-markers lens", () => {
    expect(parseColdspotsArgs(["--marker-age-threshold", "365"]).markerAgeThresholdDays).toBe(365);
    expect(parseColdspotsArgs([]).markerAgeThresholdDays).toBeNull();
    expect(() => parseColdspotsArgs(["--marker-age-threshold", "0"])).toThrow(
      /--marker-age-threshold requires/u,
    );
  });

  it("parses --window in days with or without the d suffix", () => {
    expect(parseColdspotsArgs(["--window", "90"]).windowDays).toBe(90);
    expect(parseColdspotsArgs(["--window", "90d"]).windowDays).toBe(90);
  });

  it("rejects a non-positive --window", () => {
    expect(() => parseColdspotsArgs(["--window", "0"])).toThrow(/--window requires/u);
    expect(() => parseColdspotsArgs(["--window", "soon"])).toThrow(/--window requires/u);
  });

  it("parses the amplifier threshold overrides", () => {
    const parsed = parseColdspotsArgs([
      "--age-threshold",
      "45",
      "--revision-floor",
      "1",
      "--neighborhood-ratio",
      "6",
      "--birth-burst-files",
      "10",
      "--birth-burst-lines",
      "300",
      "--gone-silent-days",
      "90",
      "--large-file-lines",
      "800",
    ]);
    expect(parsed.ageThresholdDays).toBe(45);
    expect(parsed.revisionFloor).toBe(1);
    expect(parsed.neighborhoodChurnRatio).toBe(6);
    expect(parsed.birthBurstFiles).toBe(10);
    expect(parsed.birthBurstLines).toBe(300);
    expect(parsed.goneSilentDays).toBe(90);
    expect(parsed.largeFileChurnLines).toBe(800);
  });

  it("leaves threshold overrides null when not provided (reducer defaults win)", () => {
    const parsed = parseColdspotsArgs([]);
    expect(parsed.ageThresholdDays).toBeNull();
    expect(parsed.revisionFloor).toBeNull();
    expect(parsed.neighborhoodChurnRatio).toBeNull();
  });

  it("rejects a non-positive threshold override", () => {
    expect(() => parseColdspotsArgs(["--top", "0"])).toThrow(/--top requires/u);
    expect(() => parseColdspotsArgs(["--neighborhood-ratio", "-1"])).toThrow(
      /--neighborhood-ratio requires/u,
    );
  });

  it("accepts --config, --format, --output, and --baseline", () => {
    const parsed = parseColdspotsArgs([
      "--format",
      "json",
      "--output",
      "out.json",
      "--config",
      "cfg.json",
      "--baseline",
      "prev.json",
    ]);
    expect(parsed.base.format).toBe("json");
    expect(parsed.base.outputPath).toBe("out.json");
    expect(parsed.base.configPath).toBe("cfg.json");
    expect(parsed.baselinePath).toBe("prev.json");
  });

  it("exposes a lens-selection map that fans `all` out to every concrete lens", () => {
    expect(COLDSPOT_LENS_SELECTIONS.coldspot).toEqual(["coldspot"]);
    expect(COLDSPOT_LENS_SELECTIONS["stale-markers"]).toEqual(["stale-markers"]);
    expect(COLDSPOT_LENS_SELECTIONS.all).toEqual(["coldspot", "stale-markers"]);
  });
});
