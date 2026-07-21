const MAX_INCREMENTAL_SECONDS = 2;
const MAX_RELATIVE_INCREASE = 0.2;
const MAX_TOTAL_SECONDS = 15;
const EVEN_DIVISOR = 2;

export type NearDuplicatesMeasurement = {
  readonly wallSeconds: number;
  readonly peakRssKiB: number;
};

type MeasurementSummary = {
  readonly medianWallSeconds: number;
  readonly medianPeakRssKiB: number;
};

type BudgetInput = {
  readonly fuzzyMedianWallSeconds: number;
  readonly exactMedianWallSeconds: number;
  readonly totalMedianWallSeconds: number;
};

type BudgetDecision = {
  readonly incrementalSeconds: number;
  readonly relativeIncrease: number;
  readonly passes: boolean;
};

export function summarizeNearDuplicatesMeasurements(
  measurements: readonly NearDuplicatesMeasurement[],
): MeasurementSummary {
  if (measurements.length === 0) throw new Error("benchmark needs at least one measurement");
  return {
    medianWallSeconds: median(measurements.map((item) => item.wallSeconds)),
    medianPeakRssKiB: median(measurements.map((item) => item.peakRssKiB)),
  };
}

export function decideNearDuplicatesBudget(input: BudgetInput): BudgetDecision {
  const incrementalSeconds = input.exactMedianWallSeconds - input.fuzzyMedianWallSeconds;
  const relativeIncrease = incrementalSeconds / input.fuzzyMedianWallSeconds;
  return {
    incrementalSeconds,
    relativeIncrease,
    passes:
      incrementalSeconds <= MAX_INCREMENTAL_SECONDS &&
      relativeIncrease <= MAX_RELATIVE_INCREASE &&
      input.totalMedianWallSeconds <= MAX_TOTAL_SECONDS,
  };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / EVEN_DIVISOR);
  const upper = sorted[midpoint];
  if (upper === undefined) throw new Error("median needs at least one value");
  if (sorted.length % EVEN_DIVISOR === 1) return upper;
  const lower = sorted[midpoint - 1];
  if (lower === undefined) throw new Error("median needs a lower midpoint");
  return (lower + upper) / EVEN_DIVISOR;
}
