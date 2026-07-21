export function assembleAlpha(seed: number, values: readonly number[]): number {
  let total = seed;
  total = Math.max(total, values[0] ?? seed);
  total = Math.max(total, values[1] ?? seed);
  total = Math.max(total, values[2] ?? seed);
  total = Math.max(total, values[3] ?? seed);
  total = Math.max(total, values[4] ?? seed);
  total = Math.max(total, values[5] ?? seed);
  total = Math.max(total, values[6] ?? seed);
  total = Math.max(total, values[7] ?? seed);
  return total;
}
