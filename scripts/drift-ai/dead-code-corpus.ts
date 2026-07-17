// Public loader surface for the labeled dead-code false-positive trap corpus.
// The corpus is prototype calibration infrastructure only: it does not run a
// dead-code engine or feed drift reports.

import { loadDeadCodeCorpusLabels } from "./dead-code-corpus-labels.js";
import { extractDeadCodeCorpusSymbols } from "./dead-code-corpus-symbols.js";
import {
  type DeadCodeCorpusLabel,
  type DeadCodeCorpusLabels,
  deadCodeCorpusSymbolId,
  type DeadCodeCorpusSymbolRef,
  type DeadCodeCorpusValidation,
} from "./dead-code-corpus-types.js";

export { loadDeadCodeCorpusLabels } from "./dead-code-corpus-labels.js";
export { extractDeadCodeCorpusSymbols } from "./dead-code-corpus-symbols.js";
export {
  type DeadCodeCorpusLabel,
  type DeadCodeCorpusLabels,
  deadCodeCorpusSymbolId,
  type DeadCodeCorpusSymbolRef,
  type DeadCodeCorpusValidation,
  DEFAULT_DEAD_CODE_CORPUS_DIR,
} from "./dead-code-corpus-types.js";

export function validateDeadCodeCorpusLabels(corpusDir?: string): DeadCodeCorpusValidation {
  const labels = loadDeadCodeCorpusLabels(corpusDir);
  const symbols = extractDeadCodeCorpusSymbols(corpusDir);
  const known = new Set(symbols.map((symbol) => symbol.id));
  return {
    labels,
    symbols,
    unknownSymbolRefs: labels.labels
      .map((label) => label.id)
      .filter((id) => !known.has(id))
      .sort((left, right) => left.localeCompare(right, "en")),
  };
}

export function findDeadCodeCorpusLabel(
  labels: DeadCodeCorpusLabels,
  ref: DeadCodeCorpusSymbolRef,
): DeadCodeCorpusLabel | undefined {
  const id = deadCodeCorpusSymbolId(ref.filePath, ref.symbol);
  return labels.labels.find((label) => label.id === id);
}
