export function buildFirstEnvelope(seed: number, values: readonly number[]): number {
  let total = seed;
  total += values[0] ?? 0;
  total += values[1] ?? 0;
  total += values[2] ?? 0;
  total += values[3] ?? 0;
  total += values[4] ?? 0;
  total += values[5] ?? 0;
  total += values[6] ?? 0;
  total += values[7] ?? 0;
  return total * 2;
}

export function buildSecondEnvelope(seed: number, values: readonly number[]): number {
  let total = seed * 3;
  total += values[0] ?? 0;
  total += values[1] ?? 0;
  total += values[2] ?? 0;
  total += values[3] ?? 0;
  total += values[4] ?? 0;
  total += values[5] ?? 0;
  total += values[6] ?? 0;
  total += values[7] ?? 0;
  return total - 4;
}
