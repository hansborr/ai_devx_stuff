// Corpus family: extracted-helper clones.
// inlineWeightedAverage carries the accumulation loop in its own body; the
// equivalent extractedWeightedAverage delegates that loop to the `accumulate`
// helper. The two public functions are semantically a clone pair, but their
// statement structure diverges. A function-granularity structural engine that
// buckets by statement shape is expected to MISS this pair; an engine that inlines
// callees or compares at finer granularity could recover it.
// Labeled pair: inlineWeightedAverage <-> extractedWeightedAverage (category: extracted-helper).
// `accumulate` is an intentional helper and is not part of any labeled pair.

type Reading = { celsius: number; weight: number };

export function inlineWeightedAverage(readings: readonly Reading[]): number {
  let weightedSum = 0;
  let weightTotal = 0;
  for (const reading of readings) {
    weightedSum += reading.celsius * reading.weight;
    weightTotal += reading.weight;
  }
  if (weightTotal === 0) {
    return 0;
  }
  return Math.round((weightedSum / weightTotal) * 100) / 100;
}

function accumulate(readings: readonly Reading[]): { weightedSum: number; weightTotal: number } {
  let weightedSum = 0;
  let weightTotal = 0;
  for (const reading of readings) {
    weightedSum += reading.celsius * reading.weight;
    weightTotal += reading.weight;
  }
  return { weightedSum, weightTotal };
}

export function extractedWeightedAverage(readings: readonly Reading[]): number {
  const totals = accumulate(readings);
  if (totals.weightTotal === 0) {
    return 0;
  }
  const average = totals.weightedSum / totals.weightTotal;
  const rounded = Math.round(average * 100) / 100;
  return rounded;
}
