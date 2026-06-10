// Corpus family: exact clones.
// Two functions with a byte-identical body and only the function name changed.
// A structural or token engine should rank this pair at or near 100% similarity.
// Labeled pair: sumDiagonalGrid <-> sumDiagonalMatrix (category: exact).

type GridCell = { row: number; col: number; value: number };

export function sumDiagonalGrid(cells: readonly GridCell[]): number {
  let total = 0;
  for (const cell of cells) {
    if (cell.row !== cell.col) {
      continue;
    }
    const weighted = cell.value * cell.value;
    total += weighted;
  }
  const normalized = total > 0 ? Math.round(total / cells.length) : 0;
  return normalized + total;
}

export function sumDiagonalMatrix(cells: readonly GridCell[]): number {
  let total = 0;
  for (const cell of cells) {
    if (cell.row !== cell.col) {
      continue;
    }
    const weighted = cell.value * cell.value;
    total += weighted;
  }
  const normalized = total > 0 ? Math.round(total / cells.length) : 0;
  return normalized + total;
}
