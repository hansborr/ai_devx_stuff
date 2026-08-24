import { describe, expect, it } from "vitest";

import {
  decideNearDuplicatesBudget,
  summarizeNearDuplicatesMeasurements,
} from "./benchmark-near-duplicates-core.js";

describe("near-duplicates benchmark statistics", () => {
  it("reports medians and the retain-the-slot budget decision", () => {
    const summary = summarizeNearDuplicatesMeasurements([
      { wallSeconds: 1.4, peakRssKiB: 1_400 },
      { wallSeconds: 1.2, peakRssKiB: 1_200 },
      { wallSeconds: 1.3, peakRssKiB: 1_300 },
    ]);
    expect(summary).toEqual({ medianWallSeconds: 1.3, medianPeakRssKiB: 1_300 });
    expect(
      decideNearDuplicatesBudget({
        fuzzyMedianWallSeconds: 10,
        exactMedianWallSeconds: 11.5,
        totalMedianWallSeconds: 11.5,
      }),
    ).toEqual({ incrementalSeconds: 1.5, relativeIncrease: 0.15, passes: true });
  });

  it("fails when either incremental time boundary is exceeded", () => {
    expect(
      decideNearDuplicatesBudget({
        fuzzyMedianWallSeconds: 1,
        exactMedianWallSeconds: 2.5,
        totalMedianWallSeconds: 2.5,
      }).passes,
    ).toBe(false);
    expect(
      decideNearDuplicatesBudget({
        fuzzyMedianWallSeconds: 14,
        exactMedianWallSeconds: 15.1,
        totalMedianWallSeconds: 15.1,
      }).passes,
    ).toBe(false);
  });
});
