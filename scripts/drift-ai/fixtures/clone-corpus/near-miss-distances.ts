// Corpus family: structural near-miss non-clones.
// manhattanDistance and chebyshevDistance share most of their shape but combine the
// per-axis deltas differently (sum vs. max), so they compute different metrics and
// are NOT a clone. This is the precision trap: a detector that ignores the one
// distinguishing statement would wrongly pair them.
// Labeled non-pair: manhattanDistance <-> chebyshevDistance (category: near-miss).

type Vec = { x: number; y: number };

export function manhattanDistance(a: Vec, b: Vec): number {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  const total = dx + dy;
  if (total === 0) {
    return 0;
  }
  const scaled = total * 2;
  return Math.round(scaled);
}

export function chebyshevDistance(a: Vec, b: Vec): number {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  const total = Math.max(dx, dy);
  if (total === 0) {
    return 0;
  }
  const scaled = total * 2;
  return Math.round(scaled);
}
