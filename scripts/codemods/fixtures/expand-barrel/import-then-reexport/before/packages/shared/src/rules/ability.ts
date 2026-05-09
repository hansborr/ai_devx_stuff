export function normalizeScore(score: number): number {
  return Math.max(1, Math.min(score, 30));
}
